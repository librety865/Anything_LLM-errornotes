@echo off
setlocal
chcp 65001 >nul
title 知序 - 前端开发服务
pushd "%~dp0"
if errorlevel 1 goto path_error
where node.exe >nul 2>&1
if errorlevel 1 goto node_missing
if not exist "package.json" goto project_missing
node.exe --input-type=module -e "await import('vite'); await import('react'); await import('react-dom'); await import('@vitejs/plugin-react'); await import('tailwindcss')" >nul 2>&1
if errorlevel 1 (
 echo 首次使用或复制目录后，需要检查并补齐依赖。
 echo 安装期间请保持网络连接，不要关闭窗口；完成后会自动打开页面。
 echo 下方将显示下载状态；如果出现 npm error，请保留窗口并截图。
 call npm.cmd install --install-strategy=hoisted --no-progress --loglevel=http --no-audit --no-fund --fetch-retries=2 --fetch-timeout=60000
 if errorlevel 1 goto deps_missing
)
if not exist ".env.local" (
 copy /Y ".env.example" ".env.local" >nul
 echo 已创建本机配置，默认演示模式。真实识别需自行填写连接配置。
)
echo 正在启动知序前端，浏览器将自动打开。
echo 优先使用 5173。若端口被占用，将自动使用下一个可用端口。
echo 如需查看原来保存在 5173 的错题，请释放该端口后重新启动。
echo 请保持此窗口打开；停止服务请按 Ctrl+C。
echo 如需真实加工，请同时打开 AnythingLLM 桌面版。
echo.
node.exe "node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 5173 --open
set "zhixu_exit=%errorlevel%"
echo.
if not "%zhixu_exit%"=="0" echo 启动失败，请查看上方错误信息。
echo 前端服务已停止。按任意键关闭窗口。
pause >nul
popd
exit /b %zhixu_exit%
:node_missing
echo 未找到 Node.js。请安装 Node.js 22.12 或更高版本后重新双击此文件。
echo 安装时保留添加 PATH 的选项。
goto wait_exit
:deps_missing
echo 当前目录依赖安装失败；复制目录时请勿依赖其他目录的 node_modules 链接。
echo 请截图上方 npm error 或网络错误，不必自行输入命令。
echo 检查网络后，可重新双击启动前端重试。
goto wait_exit
:project_missing
echo 未找到 package.json。请将启动文件放在 mistake-workbench 项目根目录。
goto wait_exit
:path_error
echo 无法进入启动文件所在目录，请检查文件路径。
pause
exit /b 1
:wait_exit
echo.
pause
popd
exit /b 1
