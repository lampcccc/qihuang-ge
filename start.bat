@echo off
chcp 65001 >nul
set BUN=C:\Users\one\.bun\bun.exe
set MARIA=C:\Users\one\.mariadb
set SITE=C:\Users\one\Desktop\zysjmssqlbak\tcm-site

REM 1) MariaDB
tasklist | findstr /I mariadbd.exe >nul
if errorlevel 1 (
  echo 启动 MariaDB ...
  start "" "%MARIA%\mariadb-10.6.28-winx64\bin\mariadbd.exe" --datadir="%MARIA%\data" --basedir="%MARIA%\mariadb-10.6.28-winx64" --port=3307 --bind-address=127.0.0.1 --skip-grant-tables
) else (
  echo MariaDB 已在运行
)
timeout /t 4 >nul

REM 2) Bun 全栈后端
netstat -ano 2>nul | findstr ":3801" >nul
if errorlevel 1 (
  echo 启动 Bun 后端 ...
  cd /d "%SITE%"
  start "" "%BUN%" run server/index.ts
) else (
  echo Bun 后端已在运行
)
timeout /t 3 >nul

echo.
echo =============================================
echo  中医查询网站已就绪
echo  浏览器打开: http://127.0.0.1:3801/
echo =============================================
start "" http://127.0.0.1:3801/
