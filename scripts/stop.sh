#!/usr/bin/env bash
for p in 3218 5178; do pid=$(lsof -ti tcp:$p 2>/dev/null); [ -n "$pid" ] && kill $pid && echo "已停止 $p"; done
