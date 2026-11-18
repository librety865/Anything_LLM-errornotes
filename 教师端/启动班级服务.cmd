@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
if not exist "node_modules\vite\bin\vite.js" (
 call npm.cmd install --no-audit --no-fund
 if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
echo 正在启动班级服务。请保留此窗口，关闭窗口会停止服务。
node.exe classroom-server.mjs --open
if errorlevel 1 goto failed
pause
popd
exit /b 0

:failed
pause
popd
exit /b 1
