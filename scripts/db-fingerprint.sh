#!/usr/bin/env bash
# 打印一个数据库的「身份指纹」：实例标识 + 文件指纹 + 各表行数（只读，不修改任何数据）
# 用法：bash scripts/db-fingerprint.sh [数据库路径]
#   线上：bash scripts/db-fingerprint.sh /opt/sales-analytics/server/data/sales-analytics.db
#   本地：bash scripts/db-fingerprint.sh server/data/sales-analytics.db
# 部署脚本与隔离自检脚本都用它做「部署前后 / 本地与线上」的比对
set -euo pipefail
DB="${1:-${DB_PATH:-/opt/sales-analytics/server/data/sales-analytics.db}}"
[ -f "$DB" ] || { echo "database 不存在：$DB" >&2; exit 1; }
ABS="$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")"
echo "db $ABS"
if stat -c '%s %i' "$DB" >/dev/null 2>&1; then
  set -- $(stat -c '%s %i' "$DB"); echo "size $1"; echo "inode $2"
  echo "mtime $(stat -c '%y' "$DB" | cut -d. -f1)"
else
  set -- $(stat -f '%z %i' "$DB"); echo "size $1"; echo "inode $2"
  echo "mtime $(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$DB")"
fi
python3 - "$DB" <<'PY'
import sqlite3, sys, hashlib
src = sys.argv[1]
print('sha256', hashlib.sha256(open(src, 'rb').read()).hexdigest())
c = sqlite3.connect('file:%s?mode=ro' % src, uri=True)
def one(sql, default='-'):
    try:
        r = c.execute(sql).fetchone()
        return r[0] if r else default
    except Exception:
        return default
print('instance', one("select value from settings where k='instanceName'", '未登记'))
print('instanceId', one("select value from settings where k='instanceId'", '-'))
for t in ('inquiries', 'orders', 'followups', 'inquiry_items', 'users', 'people', 'settings'):
    print(t, one('select count(*) from ' + t))
PY
