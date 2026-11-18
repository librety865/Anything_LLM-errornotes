@echo off
setlocal
chcp 65001 >nul
title 知序错题本 - 桌面版
pushd "%~dp0" || exit /b 1
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_missing
node.exe --input-type=module -e "await import('vite'); await import('typescript'); await import('@vitejs/plugin-react'); await import('tailwindcss')" >nul 2>&1
if errorlevel 1 (
 call npm.cmd install --no-audit --no-fund --no-progress
 if errorlevel 1 goto failed
)
echo 正在构建桌面版。
call npm.cmd run build -- --mode desktop
if errorlevel 1 goto failed
echo 正在检查 Electron，首次运行需要下载。
call npm.cmd run desktop:install
if errorlevel 1 (
 echo 当前下载渠道失败，正在改用 npmmirror 重试。
 set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
 set "ELECTRON_CUSTOM_DIR={{ version }}"
 call npm.cmd run desktop:install
 if errorlevel 1 goto download_failed
)
call npm.cmd run desktop:open
if errorlevel 1 goto failed
popd
exit /b 0

:node_missing
echo 找不到 npm，请安装 Node.js 后重试。
goto wait_failed

:download_failed
echo Electron 下载失败。请检查网络或代理后重新双击此文件。
goto wait_failed

:failed
echo 桌面版启动失败，请查看上方具体错误。
:wait_failed
pause
popd
exit /b 1
