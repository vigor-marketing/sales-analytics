#!/usr/bin/env bash
# 销售数据分析（sales-analytics）每日备份：在线一致快照 → 压缩 → （可选）加密 → 本地保留 14 天 → （可选）同步对象存储
# 配置见 /etc/sales-analytics-backup.env；日志见 /var/log/sales-analytics-backup.log
set -euo pipefail
[ -f /etc/sales-analytics-backup.env ] && set -a && . /etc/sales-analytics-backup.env && set +a

DB="${DB_PATH:-/opt/sales-analytics/server/data/sales-analytics.db}"
DIR="${BACKUP_DIR:-/opt/sales-analytics/server/data/backup}"
UPLOADS="${UPLOADS_DIR:-/opt/sales-analytics/server/data/uploads}"
KEEP="${BACKUP_KEEP:-14}"
TS="$(date +%Y%m%d-%H%M%S)"
log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$DIR"
SNAP="$DIR/sales-analytics-$TS.db"

# 1) 一致性快照（SQLite 在线备份 API：不锁库、不停服，WAL 也能拿到完整一致的数据）
python3 - "$DB" "$SNAP" <<'PY'
import sqlite3, sys, os
src, dst = sys.argv[1], sys.argv[2]
if not os.path.exists(src):
    raise SystemExit(f'数据库不存在：{src}')
s = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
d = sqlite3.connect(dst)
with d:
    s.backup(d)
d.close(); s.close()
PY
gzip -f "$SNAP"
FILE="$SNAP.gz"
log "快照完成：$(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

# 2) 附件目录（有内容才打包）
UPFILE=""
if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null || true)" ]; then
  UPFILE="$DIR/uploads-$TS.tar.gz"
  tar czf "$UPFILE" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  log "附件备份：$(basename "$UPFILE") ($(du -h "$UPFILE" | cut -f1))"
fi

# 3) 加密（配了 BACKUP_PASSPHRASE 就加密：本地与云上都是密文，泄露也无法读取）
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "$FILE"; FILE="$FILE.enc"
  log "已加密：$(basename "$FILE")"
  if [ -n "$UPFILE" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$UPFILE" -out "$UPFILE.enc" -pass env:BACKUP_PASSPHRASE
    rm -f "$UPFILE"; UPFILE="$UPFILE.enc"
    log "已加密：$(basename "$UPFILE")"
  fi
else
  log "警告：未配置 BACKUP_PASSPHRASE，备份为明文（建议尽快配置加密口令）"
fi

# 4) 本地保留最近 KEEP 份（数据库快照为准，附件随同批清理）
mapfile -t LIST < <(ls -1t "$DIR"/sales-analytics-*.db* 2>/dev/null || true)
if [ "${#LIST[@]}" -gt "$KEEP" ]; then
  for old in "${LIST[@]:$KEEP}"; do
    base="$(basename "$old")"; stamp="${base#sales-analytics-}"; stamp="${stamp%%.db*}"
    rm -f "$old" "$DIR/uploads-$stamp.tar.gz" "$DIR/uploads-$stamp.tar.gz.enc"
    log "清理过期备份：$base"
  done
fi
log "本地备份份数：$(ls -1 "$DIR"/sales-analytics-*.db* 2>/dev/null | wc -l) / 上限 $KEEP"

# 5) 同步到对象存储（rclone；未配置则跳过）
if [ -n "${RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    log "开始同步到 ${RCLONE_REMOTE} …"
    rclone copy "$DIR" "$RCLONE_REMOTE" --include "sales-analytics-*.db*" --include "uploads-*.tar.gz*" --no-traverse --stats-one-line --log-level ERROR
    # 远端同样只保留最近 KEEP 天（默认清理 15 天前的备份），与本地保留策略一致
    rclone delete "$RCLONE_REMOTE" --include "sales-analytics-*.db*" --include "uploads-*.tar.gz*" --min-age "${KEEP}d" --log-level ERROR || true
    log "对象存储同步完成（远端保留最近 ${KEEP} 天）"
  else
    log "警告：未安装 rclone，跳过对象存储同步"
  fi
else
  log "未配置对象存储（RCLONE_REMOTE），跳过同步"
fi
