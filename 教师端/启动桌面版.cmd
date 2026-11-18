@echo off
setlocal
chcp 65001 >nul
title 知序 - 教师端桌面版
pushd "%~dp0" || exit /b 1
where node.exe >nul 2>&1
if errorlevel 1 goto node_missing
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_missing

if not exist "node_modules\vite\bin\vite.js" (
 call npm.cmd install --include=dev --no-audit --no-fund
 if errorlevel 1 goto failed
)
echo 正在构建教师端桌面版。
call npm.cmd run build
if errorlevel 1 goto failed
echo 首次启动时可能需要下载 Electron。
call npm.cmd run desktop:install
if errorlevel 1 goto failed
call npm.cmd run desktop:open
if errorlevel 1 goto failed
popd
exit /b 0

:node_missing
echo 找不到 Node.js 或 npm。请安装 Node.js 后再双击启动。
goto wait_failed

:failed
echo 教师端桌面版启动失败，请查看上方报错。
:wait_failed
pause
popd
exit /b 1
