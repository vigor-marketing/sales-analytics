#!/usr/bin/env bash
# 一键部署到腾讯云 CVM（1.15.91.150），挂载在 http://1.15.91.150/sales/
# 用法：bash scripts/deploy-cvm.sh
# 说明：本机仍以根路径 / 运行；此处用 VITE_BASE=/sales/ 单独构建一份前端再上传。
set -euo pipefail
HOST=ubuntu@1.15.91.150
KEY=${KEY:-/Users/monk/Downloads/cbs069791292101.pem}
REMOTE=/opt/sales-analytics
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=$(mktemp -d)
TARBALL=$(mktemp -d)/app.tgz

echo "== 1/6 构建前端（base=/sales/） =="
( cd "$ROOT/client" && VITE_BASE=/sales/ "$ROOT/node_modules/.bin/vite" build --outDir "$STAGE/client/dist" --emptyOutDir )

echo "== 2/6 打包后端与前端 =="
mkdir -p "$STAGE/server"
cp -R "$ROOT/server/src" "$STAGE/server/"
cp "$ROOT/server/package.json" "$ROOT/server/tsconfig.json" "$STAGE/server/"
[ -f "$ROOT/server/.env" ] && cp "$ROOT/server/.env" "$STAGE/server/.env"
tar czf "$TARBALL" -C "$STAGE" .   # 打包到 STAGE 之外，避免把压缩包自己打进去

echo "== 3/6 上传 =="
scp -q -i "$KEY" "$TARBALL" "$HOST:/tmp/app.tgz"

echo "== 4/6 解包（保留服务器上的 data/ 数据库与 .env） =="
ssh -i "$KEY" "$HOST" "cd $REMOTE && tar xzf /tmp/app.tgz --exclude='./server/data' --exclude='./server/.env' && chmod 600 server/.env 2>/dev/null || true"

echo "== 5/6 安装依赖（如有变化） =="
ssh -i "$KEY" "$HOST" "cd $REMOTE/server && npm install --no-audit --no-fund --silent"

echo "== 6/6 重启服务并自检 =="
ssh -i "$KEY" "$HOST" "sudo systemctl restart sales-analytics && sleep 5 && systemctl is-active sales-analytics && curl -s -o /dev/null -w '本机 /sales/ -> %{http_code}\n' http://127.0.0.1/sales/ -H 'Host: 1.15.91.150'"
rm -rf "$STAGE"
echo "完成：http://1.15.91.150/sales/"
