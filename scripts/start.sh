#!/usr/bin/env bash
BASE="$(cd "$(dirname "$0")/.." && pwd)"; mkdir -p "$BASE/scripts/logs"
[ -n "$(lsof -ti tcp:3218)" ] && echo "后端已在 3218" || (nohup env PORT=3218 npm --prefix "$BASE" run start -w server > "$BASE/scripts/logs/server.log" 2>&1 & echo "后端 → logs/server.log")
[ -n "$(lsof -ti tcp:5178)" ] && echo "前端已在 5178" || (nohup npm --prefix "$BASE" run dev -w client > "$BASE/scripts/logs/client.log" 2>&1 & echo "前端 → logs/client.log")
echo "入口 http://localhost:5178"
