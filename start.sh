#!/usr/bin/env bash
# 一键启动中医查询网站（MariaDB + Bun 全栈后端 + 内置静态前端）
set -u
BUN="/c/Users/one/.bun/bun.exe"
MARIA="/c/Users/one/.mariadb"
SITE="/c/Users/one/Desktop/zysjmssqlbak/tcm-site"

# 1) 启动 MariaDB（承载真实中医数据）
if (exec 3<>/dev/tcp/127.0.0.1/3307) 2>/dev/null; then
  echo "MariaDB 已在运行 (3307)"
  exec 3>&-
else
  echo "启动 MariaDB ..."
  nohup "$MARIA/mariadb-10.6.28-winx64/bin/mariadbd.exe" \
    --datadir="$MARIA/data" --basedir="$MARIA/mariadb-10.6.28-winx64" \
    --port=3307 --bind-address=127.0.0.1 --skip-grant-tables \
    >/tmp/mariadb.log 2>&1 &
  sleep 5
fi

# 2) 启动 Bun 全栈后端（端口 3801，同时托管已构建的前端 dist/）
if curl -s -o /dev/null http://127.0.0.1:3801/api/health 2>/dev/null; then
  echo "Bun 后端已在运行 (3801)"
else
  echo "启动 Bun 后端 ..."
  cd "$SITE"
  nohup "$BUN" run server/index.ts >/tmp/bun-server.log 2>&1 &
  sleep 3
fi

echo ""
echo "============================================="
echo " 中医查询网站已就绪"
echo " 浏览器打开: http://127.0.0.1:3801/"
echo "============================================="
