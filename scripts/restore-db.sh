#!/usr/bin/env bash
# 从加密备份恢复销售数据分析数据库（在服务器上执行）
# 用法：sudo bash scripts/restore-db.sh <备份文件路径>         例：.../sales-analytics-20260915-023012.db.gz.enc
#      sudo bash scripts/restore-db.sh <备份文件路径> --yes     跳过确认
set -euo pipefail
[ -f /etc/sales-analytics-backup.env ] && set -a && . /etc/sales-analytics-backup.env && set +a
DB="${DB_PATH:-/opt/sales-analytics/server/data/sales-analytics.db}"
FILE="${1:-}"
YES="${2:-}"
[ -n "$FILE" ] || { echo "用法：restore-db.sh <备份文件路径> [--yes]"; exit 1; }
[ -f "$FILE" ] || { echo "备份文件不存在：$FILE"; exit 1; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "未配置 BACKUP_PASSPHRASE，无法解密备份"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
WORK="$TMP/restore.db"

echo "== 1/4 解密/解压备份 =="
case "$FILE" in
  *.enc) BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP/x" -pass env:BACKUP_PASSPHRASE
         if file "$TMP/x" | grep -q gzip; then gunzip -c "$TMP/x" > "$WORK"; else mv "$TMP/x" "$WORK"; fi ;;
  *.gz)  gunzip -c "$FILE" > "$WORK" ;;
  *)     cp "$FILE" "$WORK" ;;
esac
python3 - "$WORK" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print('  备份校验：', c.execute('pragma integrity_check').fetchone()[0],
      '| 询价', c.execute('select count(*) from inquiries').fetchone()[0],
      '| 订单', c.execute('select count(*) from orders').fetchone()[0],
      '| 账号', c.execute('select count(*) from users').fetchone()[0])
PY

if [ "$YES" != "--yes" ]; then
  echo
  echo "即将用上面的备份覆盖当前数据库：$DB"
  read -r -p "确认恢复请输入 yes：" ans
  [ "$ans" = "yes" ] || { echo "已取消"; exit 0; }
fi

echo "== 2/4 停服务 + 备份当前库 =="
sudo systemctl stop sales-analytics
SAFE="${DB}.before-restore-$(date +%Y%m%d-%H%M%S)"
[ -f "$DB" ] && sudo cp -a "$DB" "$SAFE" && echo "  当前库已另存：$SAFE"

echo "== 3/4 覆盖数据库 =="
sudo rm -f "$DB" "$DB-wal" "$DB-shm"
sudo cp "$WORK" "$DB"
sudo chown ubuntu:ubuntu "$DB"; sudo chmod 600 "$DB"

echo "== 4/4 启动服务并自检 =="
sudo systemctl start sales-analytics && sleep 5
systemctl is-active sales-analytics
curl -s -o /dev/null -w "  /sales/ -> %{http_code}\n" http://127.0.0.1/sales/ -H 'Host: 1.15.91.150'
echo "恢复完成。"
