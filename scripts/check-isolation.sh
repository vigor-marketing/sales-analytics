#!/usr/bin/env bash
# 数据隔离自检（只读）：一次性核对「本地开发数据」与「线上生产数据」是否完全分开、互不干扰
# 用法：bash scripts/check-isolation.sh
# 检查项：实例标识是否互不相同、部署包是否零数据文件、git 是否跟踪了数据库、监听地址是否只在本机等
set -uo pipefail
HOST=${HOST:-ubuntu@1.15.91.150}
KEY=${KEY:-/Users/monk/Downloads/cbs069791292101.pem}
REMOTE=/opt/sales-analytics
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DB="$ROOT/server/data/sales-analytics.db"
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✖\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
fld() { printf '%s\n' "$1" | awk -v k="$2" '$1 == k { print $2; exit }'; }

echo "=== 1) 本地开发数据 ==="
if [ -f "$LOCAL_DB" ]; then
  LFP="$(bash "$ROOT/scripts/db-fingerprint.sh" "$LOCAL_DB")"
  printf '%s\n' "$LFP" | sed 's/^/  /'
else
  bad "本地数据库不存在：$LOCAL_DB"
  LFP=""
fi

echo "=== 2) 线上生产数据 ==="
RFP="$(ssh -o StrictHostKeyChecking=no -i "$KEY" "$HOST" "bash $REMOTE/scripts/db-fingerprint.sh $REMOTE/server/data/sales-analytics.db" 2>/dev/null)" || true
if [ -z "$RFP" ]; then
  bad "无法读取线上指纹（检查网络 / SSH 密钥）"
else
  printf '%s\n' "$RFP" | sed 's/^/  /'
fi

echo "=== 3) 两台数据是否互相独立 ==="
if [ -n "$LFP" ] && [ -n "$RFP" ]; then
  LI=$(fld "$LFP" instance); RI=$(fld "$RFP" instance)
  LID=$(fld "$LFP" instanceId); RID=$(fld "$RFP" instanceId)
  [ "$LI" = "local" ] || warn "本地库实例标识是「$LI」（通常应为 local）"
  [ "$RI" = "production" ] || bad "线上库实例标识是「$RI」（应为 production）"
  [ "$LI" != "$RI" ] && ok "实例标识不同：本地=$LI / 线上=$RI" || bad "实例标识相同（$LI）：两份数据可能是同一份或互为拷贝"
  [ "$LID" != "$RID" ] && ok "实例ID不同：本地=$LID / 线上=$RID" || bad "实例ID相同（$LID）：说明两份库同源，请确认是否需要各自独立"
  LS=$(fld "$LFP" sha256); RS=$(fld "$RFP" sha256)
  [ "$LS" != "$RS" ] && ok "数据库文件内容不同（本地 $(echo "$LS" | cut -c1-12)… / 线上 $(echo "$RS" | cut -c1-12)…）" || warn "两份库文件内容完全相同，注意区分使用"
  echo "  数据量对比：询价 本地 $(fld "$LFP" inquiries) / 线上 $(fld "$RFP" inquiries)　订单 本地 $(fld "$LFP" orders) / 线上 $(fld "$RFP" orders)　账号 本地 $(fld "$LFP" users) / 线上 $(fld "$RFP" users)"
fi

echo "=== 4) 部署包不含任何数据/配置文件 ==="
TMPD="$(mktemp -d)"; STAGE="$TMPD/stage"; mkdir -p "$STAGE/server" "$STAGE/scripts"
cp -R "$ROOT/server/src" "$STAGE/server/"; cp "$ROOT/server/package.json" "$ROOT/server/tsconfig.json" "$STAGE/server/"
cp "$ROOT"/scripts/*.sh "$STAGE/scripts/"; [ -d "$ROOT/client/dist" ] && cp -R "$ROOT/client/dist" "$STAGE/client-dist"
tar czf "$TMPD/app.tgz" -C "$STAGE" .
BADP="$(tar tzf "$TMPD/app.tgz" | grep -E '(^|/)\.env(\.|$)|\.(db|db-wal|db-shm|sqlite|sqlite3)(\.|$)|^\./server/(data|backup|uploads)/' || true)"
[ -z "$BADP" ] && ok "部署包内无 .db / .env / data 目录（$(tar tzf "$TMPD/app.tgz" | wc -l | tr -d ' ') 个条目）" || { bad "部署包内含数据或配置文件："; printf '%s\n' "$BADP" | sed 's/^/     /'; }
rm -rf "$TMPD"

echo "=== 5) 仓库不会带走数据 ==="
TRACKED="$(cd "$ROOT" && git ls-files | grep -E '\.(db|db-wal|db-shm)$|(^|/)\.env$' || true)"
[ -z "$TRACKED" ] && ok "git 未跟踪任何数据库 / .env 文件" || { bad "git 跟踪了敏感文件："; printf '%s\n' "$TRACKED" | sed 's/^/     /'; }
if (cd "$ROOT" && git check-ignore -q server/data/sales-analytics.db); then ok "server/data 已被 .gitignore 忽略"; else bad "server/data 未被 .gitignore 忽略"; fi

echo "=== 6) 本地配置不指向线上数据 ==="
if grep -rIl --exclude-dir=node_modules --exclude-dir=.git -e '/opt/sales-analytics' "$ROOT/server/src" "$ROOT/scripts" 2>/dev/null | grep -v 'scripts/\(backup-db\|restore-db\|deploy-cvm\|check-isolation\|db-fingerprint\)\.sh$' | grep -q .; then
  bad "本地代码/脚本里出现了线上路径（除脚本默认值外不应出现）"
else
  ok "本地源码中没有写死线上数据库路径（脚本默认值除外）"
fi
if [ -f "$ROOT/server/.env" ] && grep -qE '^DB_PATH=.*/opt/sales-analytics' "$ROOT/server/.env"; then
  bad "本地 server/.env 把 DB_PATH 指向了线上数据库"
else
  ok "本地 server/.env 未指向线上数据库"
fi

echo "=== 7) 线上配置与监听 ==="
REM="$(ssh -o StrictHostKeyChecking=no -i "$KEY" "$HOST" "grep -E '^SA_INSTANCE=' $REMOTE/server/.env || echo 'SA_INSTANCE 未配置'; grep -E '^(HOST|PORT)=' $REMOTE/server/.env; ss -ltnp 2>/dev/null | grep 3218 | sed 's/^/   /'" 2>/dev/null)"
printf '%s\n' "$REM" | sed 's/^/  /'
case "$REM" in *'SA_INSTANCE=production'*) ok "线上 .env 声明 SA_INSTANCE=production" ;; *) bad "线上 .env 缺少 SA_INSTANCE=production（应用会按路径自动判定，但建议显式声明）" ;; esac
case "$REM" in *'127.0.0.1:3218'*) ok "线上应用只监听 127.0.0.1:3218（未直接对公网开放）" ;; *) warn "未确认线上 3218 只监听本机，请自行核对 ss 输出" ;; esac

echo "=== 8) 本地服务监听范围 ==="
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3218 -sTCP:LISTEN >/dev/null 2>&1; then
  if lsof -nP -iTCP:3218 -sTCP:LISTEN | grep -q '127.0.0.1:3218'; then ok "本地开发服务只监听 127.0.0.1:3218"; else bad "本地开发服务监听范围超过本机，请检查 HOST 配置"; fi
else
  warn "本地 3218 未在监听（开发服务未启动，跳过）"
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "结论：本地开发数据与线上生产数据完全隔离，互不干扰 ✓"; else echo "结论：发现 $FAIL 项问题，请按上面提示处理 ✖"; fi
exit "$FAIL"
