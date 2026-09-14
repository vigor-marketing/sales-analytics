#!/usr/bin/env bash
# 从加密备份恢复销售数据分析数据库（在服务器上执行）
# 用法：bash scripts/restore-db.sh <备份文件路径> [--yes] [--force]
#   例：bash scripts/restore-db.sh /opt/sales-analytics/server/data/backup/sales-analytics-production-20260915-023012.db.gz.enc
#   --yes    跳过交互确认      --force  备份实例与当前环境不一致时也强行恢复（默认拒绝）
#
# 数据隔离：备份文件名与备份内容里都记录了实例标识；若拿「本地开发」的备份去恢复「线上生产」，
#           或反之，脚本会先给出明确警告并要求 --force，避免两套数据互相顶替。
set -euo pipefail
[ -f /etc/sales-analytics-backup.env ] && set -a && . /etc/sales-analytics-backup.env && set +a
DB="${DB_PATH:-/opt/sales-analytics/server/data/sales-analytics.db}"
FILE=""; YES=""; FORCE=""
for a in "$@"; do
  case "$a" in
    --yes) YES="--yes" ;;
    --force) FORCE="--force" ;;
    *) FILE="$a" ;;
  esac
done
[ -n "$FILE" ] || { echo "用法：restore-db.sh <备份文件路径> [--yes] [--force]"; exit 1; }
[ -f "$FILE" ] || { echo "备份文件不存在：$FILE"; exit 1; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "未配置 BACKUP_PASSPHRASE，无法解密备份"; exit 1; }

case "$DB" in /opt/sales-analytics/*) EXPECT=production ;; *) EXPECT=local ;; esac
EXPECT="${SA_INSTANCE:-$EXPECT}"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
WORK="$TMP/restore.db"

echo "== 1/5 解密/解压备份 =="
case "$FILE" in
  *.enc) BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP/x" -pass env:BACKUP_PASSPHRASE
         if file "$TMP/x" | grep -q gzip; then gunzip -c "$TMP/x" > "$WORK"; else mv "$TMP/x" "$WORK"; fi ;;
  *.gz)  gunzip -c "$FILE" > "$WORK" ;;
  *)     cp "$FILE" "$WORK" ;;
esac

echo "== 2/5 校验备份内容与实例归属 =="
CAND="$(python3 - "$WORK" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print('integrity=%s' % c.execute('pragma integrity_check').fetchone()[0])
print('instance=%s' % (lambda r: r[0] if r else 'unknown')(c.execute("select v from settings where k='instanceName'").fetchone()))
print('instanceId=%s' % (lambda r: r[0] if r else '-')(c.execute("select v from settings where k='instanceId'").fetchone()))
print('counts: 询价=%s 订单=%s 跟进=%s 账号=%s 人员=%s' % (
    c.execute('select count(*) from inquiries').fetchone()[0],
    c.execute('select count(*) from orders').fetchone()[0],
    c.execute('select count(*) from followups').fetchone()[0],
    c.execute('select count(*) from users').fetchone()[0],
    c.execute('select count(*) from people').fetchone()[0]))
PY
)"
printf '%s\n' "$CAND" | sed 's/^/   /'
CAND_INSTANCE="$(printf '%s\n' "$CAND" | awk -F= '/^instance=/{print $2}')"
case "$(basename "$FILE")" in
  *sales-analytics-production-*) NAME_INSTANCE=production ;;
  *sales-analytics-local-*) NAME_INSTANCE=local ;;
  *) NAME_INSTANCE=unknown ;;
esac
# 三道核对：文件名标注、库内登记、目标环境——任何一处对不上都先拦下来（除非显式 --force）
REFUSE=0
if [ "${NAME_INSTANCE}" != "unknown" ] && [ "${NAME_INSTANCE}" != "${EXPECT}" ]; then
  echo "   ⚠ 备份文件名标注的实例是「${NAME_INSTANCE}」，而当前目标环境是「${EXPECT}」"
  REFUSE=1
fi
if [ "${CAND_INSTANCE}" = "unknown" ]; then
  echo "   ⚠ 这份备份内部没有实例标识（早期备份），无法自动核对它属于哪套数据"
  REFUSE=1
elif [ "${CAND_INSTANCE}" != "${EXPECT}" ]; then
  echo "   ⚠ 实例不一致：备份属于「${CAND_INSTANCE}」，而当前目标环境是「${EXPECT}」（${DB}）"
  REFUSE=1
elif [ "${NAME_INSTANCE}" != "unknown" ] && [ "${NAME_INSTANCE}" != "${CAND_INSTANCE}" ]; then
  echo "   ⚠ 备份文件名标注（${NAME_INSTANCE}）与库内登记（${CAND_INSTANCE}）不一致，请人工确认备份来源"
  REFUSE=1
fi
if [ "${REFUSE}" = "1" ]; then
  echo "     继续恢复会用另一套数据覆盖当前数据！"
  [ "${FORCE}" = "--force" ] || { echo "     已中止（确认无误后再加 --force）。"; exit 1; }
  echo "     已按 --force 继续。"
fi
grep -q '^integrity=ok' <<< "$CAND" || { echo "   ✖ 备份完整性检查未通过，已中止"; exit 1; }

if [ "$YES" != "--yes" ]; then
  echo
  echo "即将用上面的备份覆盖当前数据库：${DB}（目标实例：${EXPECT}）"
  read -r -p "确认恢复请输入 yes：" ans
  [ "$ans" = "yes" ] || { echo "已取消"; exit 0; }
fi

echo "== 3/5 停服务 + 备份当前库 =="
sudo systemctl stop sales-analytics
SAFE="${DB}.before-restore-$(date +%Y%m%d-%H%M%S)"
if [ -f "$DB" ]; then
  # 用 SQLite 在线备份 API 另存（含 WAL 里尚未落盘的事务；直接 cp 主文件可能丢掉最近的写入）
  sudo python3 - "$DB" "$SAFE" <<'SQLBAK'
import sqlite3, sys, os
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect('file:%s?mode=ro' % src, uri=True)
d = sqlite3.connect(dst)
with d:
    s.backup(d)
d.close(); s.close()
os.chmod(dst, 0o600)
SQLBAK
  sudo rm -f "$SAFE-wal" "$SAFE-shm"
  sudo chown --reference="$DB" "$SAFE" 2>/dev/null || true
  # 只保留最近 3 份安全副本，避免长期堆积明文库文件
  ls -1t "${DB}".before-restore-* 2>/dev/null | tail -n +4 | while IFS= read -r f; do sudo rm -f "$f"; done
  echo "  当前库已另存（含 WAL 未落盘内容）：$SAFE"
fi

echo "== 4/5 覆盖数据库 =="
sudo rm -f "$DB" "$DB-wal" "$DB-shm"
sudo cp "$WORK" "$DB"
sudo chown ubuntu:ubuntu "$DB"; sudo chmod 600 "$DB"

echo "== 5/5 启动服务并自检（实例标识必须与目标一致，否则服务会被实例守门拦住） =="
sudo systemctl start sales-analytics && sleep 5
systemctl is-active sales-analytics
HEALTH="$(curl -s --max-time 5 http://127.0.0.1:3218/api/health || true)"
echo "  /api/health -> $HEALTH"
case "$HEALTH" in
  *"\"instance\":\"$EXPECT\""*) echo "  实例标识正确（${EXPECT}）✓" ;;
  *) echo "  ✖ 实例标识不是 ${EXPECT}，请检查 server/.env 的 SA_INSTANCE 与 /var/log/sales-analytics.log"; exit 1 ;;
esac
curl -s -o /dev/null -w "  /sales/ -> %{http_code}\n" http://127.0.0.1/sales/ -H 'Host: 1.15.91.150'
echo "恢复完成（恢复前的那份库仍保留在 ${SAFE}）。"
