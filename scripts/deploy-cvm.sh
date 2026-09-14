#!/usr/bin/env bash
# 一键部署到腾讯云 CVM（1.15.91.150），访问地址 http://1.15.91.150/sales/
# 用法：bash scripts/deploy-cvm.sh
#
# 铁律（确保本地开发数据与线上生产数据互不干扰）：
#   1) 部署包只含程序代码：server/src、client/dist、scripts/*.sh、package.json、tsconfig.json
#   2) 数据（server/data）、备份（*.db*）、配置（.env）一律不打包；解包时再排除一次
#   3) 部署前后比对线上数据库指纹（实例 / 实例ID / inode / 各表行数 / sha256），数据被动过立即中止
#   4) 线上 .env 必须声明 SA_INSTANCE=production；缺失或写错会被应用实例守卫拒绝启动
set -euo pipefail
HOST=ubuntu@1.15.91.150
KEY=${KEY:-/Users/monk/Downloads/cbs069791292101.pem}
REMOTE=/opt/sales-analytics
DB=$REMOTE/server/data/sales-analytics.db
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=$(mktemp -d); TMPD=$(mktemp -d); TARBALL=$TMPD/app.tgz
LOGDIR="$ROOT/scripts/logs"; mkdir -p "$LOGDIR"
EXTRACT_LOG="$LOGDIR/deploy-extract-$(date +%Y%m%d-%H%M%S).log"
trap 'rm -rf "$STAGE" "$TMPD"' EXIT
rsh() { ssh -i "$KEY" "$HOST" "$@"; }
fp() { rsh "bash $REMOTE/scripts/db-fingerprint.sh $DB"; }
field() { printf '%s\n' "$1" | awk -v k="$2" '$1 == k { print $2; exit }'; }

echo "== 1/8 构建前端（base=/sales/） =="
( cd "$ROOT/client" && VITE_BASE=/sales/ "$ROOT/node_modules/.bin/vite" build --outDir "$STAGE/client/dist" --emptyOutDir )

echo "== 2/8 打包（只含代码） =="
mkdir -p "$STAGE/server"
cp -R "$ROOT/server/src" "$STAGE/server/"
cp "$ROOT/server/package.json" "$ROOT/server/tsconfig.json" "$STAGE/server/"
mkdir -p "$STAGE/scripts"
cp "$ROOT"/scripts/*.sh "$STAGE/scripts/"
# 刻意不打包 server/.env：线上有线上自己的配置，本地配置绝不外传
tar czf "$TARBALL" -C "$STAGE" .

echo "== 3/8 部署包安全校验（出现数据/配置文件立即中止） =="
LIST="$(tar tzf "$TARBALL")"
BAD="$(printf '%s\n' "$LIST" | grep -E '(^|/)\.env(\.|$)|\.(db|db-wal|db-shm|sqlite|sqlite3)(\.|$)|^\./server/(data|backup|uploads)/' || true)"
if [ -n "$BAD" ]; then
  echo "✖ 部署包里出现了数据或配置文件，这次部署已中止："
  printf '%s\n' "$BAD" | sed 's/^/   /'
  exit 1
fi
echo "   包内 $(printf '%s\n' "$LIST" | wc -l | tr -d ' ') 个条目，不含 .db / .env / data 目录 ✓"

echo "== 4/8 上传 =="
scp -q -i "$KEY" "$TARBALL" "$HOST:/tmp/app.tgz"

echo "== 5/8 先同步脚本并记录线上数据指纹（只读） =="
rsh "cd $REMOTE && tar xzf /tmp/app.tgz ./scripts && chmod +x scripts/*.sh"
BEFORE="$(fp)"
echo "$BEFORE" | sed 's/^/   /'

echo "== 6/8 解包代码（明确排除数据与配置） =="
rsh "cd $REMOTE && tar xzf /tmp/app.tgz -v --exclude='./scripts' --exclude='./server/data' --exclude='./server/data/*' --exclude='server/data' --exclude='./server/.env' --exclude='server/.env'" > "$EXTRACT_LOG"
TOUCHED="$(grep -E '(^|/)\.env|\.(db|db-wal|db-shm)|server/data' "$EXTRACT_LOG" || true)"
if [ -n "$TOUCHED" ]; then
  echo "⚠ 解包过程涉及了数据/配置文件（已被 exclude 跳过，但仍请核对）："
  printf '%s\n' "$TOUCHED" | sed 's/^/   /'
fi
echo "   解包 $(wc -l < "$EXTRACT_LOG" | tr -d ' ') 个文件，日志：$EXTRACT_LOG"

AFTER="$(fp)"
for k in instance instanceId inode users inquiries orders people; do
  b="$(field "$BEFORE" "$k")"; a="$(field "$AFTER" "$k")"
  if [ "$b" != "$a" ]; then
    echo "✖ 线上数据在部署过程中发生了变化（${k}：$b → ${a}），已中止，服务保持原样未重启"
    exit 1
  fi
done
b="$(field "$BEFORE" sha256)"; a="$(field "$AFTER" sha256)"
[ "$b" = "$a" ] || echo "   提示：数据库文件 sha256 有变化（$b → ${a}），行数与实例均未变（通常是 WAL 检查点落盘，属正常）"
echo "   线上数据指纹未变 ✓（实例 $(field "$AFTER" instance) / 实例ID $(field "$AFTER" instanceId)）"

echo "== 7/8 保证线上实例标识 = production，并安装依赖 =="
rsh "grep -q '^SA_INSTANCE=' $REMOTE/server/.env || { echo 'SA_INSTANCE=production' >> $REMOTE/server/.env; echo '   已补充 SA_INSTANCE=production'; }
     grep '^SA_INSTANCE=' $REMOTE/server/.env | sed 's/^/   线上 .env：/'
     chmod 600 $REMOTE/server/.env"
rsh "cd $REMOTE/server && npm install --no-audit --no-fund --silent"

echo "== 8/8 重启并自检 =="
rsh "sudo systemctl restart sales-analytics && sleep 5 && systemctl is-active sales-analytics"
HEALTH="$(rsh "curl -s --max-time 5 http://127.0.0.1:3218/api/health")"
echo "   /api/health -> $HEALTH"
case "$HEALTH" in
  *'"instance":"production"'*) echo "   线上实例标识正确（production）✓" ;;
  *) echo "✖ 线上实例标识不是 production（或健康检查失败），请检查 server/.env 与日志"; exit 1 ;;
esac
rsh "curl -s -o /dev/null -w '   本机 /sales/ -> %{http_code}\n' http://127.0.0.1/sales/ -H 'Host: 1.15.91.150'"
FINAL="$(fp)"
for k in inode users inquiries orders people; do
  a="$(field "$AFTER" "$k")"; f="$(field "$FINAL" "$k")"
  if [ "$a" != "$f" ]; then echo "✖ 重启后数据又发生变化（${k}：$a → ${f}），请检查"; exit 1; fi
done
echo "   重启后数据仍然一致 ✓"
echo "完成：http://1.15.91.150/sales/（本地数据未受影响）"
