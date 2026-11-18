# 知序学生端

v4.0 的便携入口在同级 `桌面版/知序桌面版/知序错题本.exe`。演示前在本机打开便携目录附带的空白 `.env.local`，设置 `VITE_USE_MOCK=false`、AnythingLLM 地址和 Developer API Key，再重新打开 exe。模型地址默认是 `http://127.0.0.1:3001`。没有选中已连接的错题本时，到「偏好设置」连接工作区，或选用已配置的工作区。

图片识别成功后自动提交加工，目前没有识别编辑确认或手写置信度提示。

正式交付只用桌面版。Developer API Key 由学生 Electron 主进程持有。网页模式仅供开发调试，使用 `VITE_` 配置的 Key 会暴露在浏览器。不要把本机密钥文件纳入版本控制、截图或演示资料。

构建并更新 v4.0 便携副本：运行本目录的「更新便携桌面版.cmd」。普通网页构建用 `npm.cmd run build`，桌面构建用 `npm.cmd run build -- --mode desktop`。
