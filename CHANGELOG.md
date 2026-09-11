# Changelog

## 0.2.1 — 2026-09-11

- 修复打开工作台时报 `connection: invalid RPC target`：DSH channel 仅允许一级路径，改用 `/api` channel 和 `git-workspace/<endpoint>` method。
- Host 同步校验完整 namespaced method，再分派到原业务 endpoint；最终 HTTP URL 保持 `/api/git-workspace/<endpoint>`。
- 新增真实 DSH 浏览器 Connection 发布包回归测试：复现旧错误，验证工作区、提交 Diff 及全部 22 个端点。
- 69 项测试、类型检查和构建通过。

## 0.2.0 — 2026-09-10

- 适配 DSH `0.1.5-rc.1`，开发依赖固定到该发布版本；提高最低宿主版本。
- 删除已移除的 `dsh-client-runtime` / `dsh-host-apiproxy` 引用，使用当前 Cordis、Connection、Settings 与 UI 接口。
- Host 改用 `ctx.settings.register()`；保留原 namespace 和 live 配置；切换到 DSH 的 schemastery 包。
- RPC 改用 Connection 精确 Fetch 路由 `/api/git-workspace/<endpoint>`，规避 rc.1 独立 handle 的运行时注入错误，复用认证、Origin 检查与请求体限制。
- UI 改用 `sidebar.panellist` + `main` + `layout.selectPanel(null)`，移除 DOM 选择器、全局 MutationObserver 和隐藏宿主会话的 CSS。
- 主题变量在插件表面解析并继承 DSH body 的实际颜色变量，补齐深色 Diff、状态提示和弹窗。
- 安全 Pull 允许本地修改；拒绝未解决冲突，固定 fast-forward、禁止隐式 rebase/autostash。
- 新增本地修改与远端覆盖保护集成测试，更新升级说明和接口变更分析。

## 0.1.4

- 批量 Fetch 和 Pull 改为最多 4 个独立仓库并行执行，继续逐行实时显示状态；Push 保持顺序执行。
- 提交详情中的变更文件可打开该提交对应的可读 Diff，并可返回提交详情。
- 新增 `commit/diff` RPC；Host 同时校验可见历史 hash 和该提交变更文件白名单，不接受任意 revision/path 组合。
- 工作台每次打开时立即刷新 DSH `workspaceRegistry`，打开期间每 5 秒同步一次；无会话的新 workspace 也会出现。
- “重新扫描”升级为“刷新工作区并扫描”，同时刷新 workspace 列表与当前仓库注册表。
- 新增 Fetch/Pull 并发、提交文件 Diff 和无会话 workspace 刷新回归测试；测试总数增至 33。

## 0.1.3

- 批量 Fetch/Pull/Push 改为客户端逐仓库顺序执行，弹窗内逐行实时显示等待、执行中、成功、失败和阻止状态；失败项可单独重试。
- 删除常驻“操作中心”，右侧详情栏仅在查看 Diff 或提交详情时出现。
- 仓库栏和 Diff/提交详情栏增加可拖拽、可键盘操作的分隔条，宽度偏好保存在浏览器本地。
- 分支选择器分组展示本地与 Remote 分支；选择 Remote 分支时显式创建本地跟踪分支，并过滤 `origin/HEAD` 等符号引用。
- 修复第二条及后续提交记录 hash 前残留换行，导致详情查询被误判为“提交哈希不合法”的问题。
- 新增实时批量状态、分栏调整、Remote 分支跟踪切换和非首条提交详情回归测试；测试总数增至 29。

## 0.1.2

- 修复批量 Pull 在 Host dispatch 阶段错误要求单仓库 `repoId`。
- 修复 `for-each-ref` 分隔符和记录换行解析，已有分支名称、当前分支与切换恢复正常；分支面板增加明确的已有分支选择器。
- Remotes URL、代理动作和 Settings 提示改为可随内容宽度换行的响应式布局。
- 原始 Diff 改为带新旧行号、hunk、增删颜色和上下文的可读视图。
- 未跟踪新文件可直接查看完整新增内容；符号链接只展示链接目标，不跟随读取仓库外文件。
- 提交记录支持打开详情，展示完整消息、作者、时间、哈希、父提交和变更文件。
- 仓库批量范围增加一键全选和反选。
- 新增批量 dispatch、分支切换、新文件 Diff、提交详情和 Diff 解析回归测试。

## 0.1.1

- 修复 DSH 启动时 `shared RPC channel "/api" already has an interceptor`。
- Host/Client 改用插件独占的 `/git-workspace` Connection RPC channel，不再拦截 API Gateway 的共享 `/api` channel。
- 增加传输契约回归测试和真实 profile 启动冒烟验证流程。

## 0.1.0

- 首个完整版本。
- 单 DSH workspace 多 Git 仓库发现与可信 `repoId` 注册表。
- 修改、暂存、staged-only commit、历史、分支、Remote 和网络操作。
- 批量 Fetch/Pull/Push 预检与逐仓库报告。
- DSH Settings 中的 Remote 主机代理/直连/阻止配置。
- dsh-web“任务看板”同层级左侧入口和保持会话挂载的工作台宿主。
