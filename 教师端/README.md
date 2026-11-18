# 知序教师端

v4.0 的便携入口在同级 `桌面版/知序教师桌面版/知序教师端.exe`。演示前在本机打开便携目录附带的空白 `.env.classroom.local`，包含 `CLASSROOM_ANYTHINGLLM_BASE_URL` 和 `CLASSROOM_ANYTHINGLLM_API_KEY`，再重新打开 exe。密钥由现有班级服务读取，不要提交配置文件或传播真实密钥。

真实班级和班级学情页面使用 `/api/classroom/*`。独立看板的 `/api/teacher/*` HTTP 模式预留未接入，桌面界面没有该入口。班级学情包含错因、学科、难度分布及下钻筛选，进度页支持历史和 CSV 导出。正式交付只用桌面版。

构建并更新 v4.0 便携副本：运行本目录的「更新便携桌面版.cmd」。
