# 安全说明

## 信任边界

浏览器是非权威调用方。它可选择已展示的 workspace、repo、文件、分支和 Remote，但 Host 必须重新解析和验证。

Host 的信任根：

1. DSH `workspaceRegistry`。
2. `realpath` 后仍位于 workspace 内的 Git top-level。
3. 当前 Git status/branch/remote 的重新读取。

## 路径安全

- RPC 不接受 `cwd`。
- 扫描候选必须通过 `git rev-parse --show-toplevel`。
- repo canonical path 必须在 workspace canonical path 内。
- 符号链接目录不递归扫描。
- Stage/Unstage/Diff 路径必须存在于最新 status。
- 历史提交文件 Diff 的 hash 必须属于当前可见的最近 100 条历史，路径必须属于该提交重新解析出的变更文件列表。
- 未跟踪文件 Diff 先通过最新 status 和仓库边界校验；普通文件限制为 4 MiB，符号链接只读取链接目标字符串，不跟随读取目标文件。
- 路径作为 argv 传给 Git，前面带 `--`，不参与 shell 解释。

## 命令安全

所有 Git 命令均通过 `spawn` 和数组参数运行，`shell: false`。插件不提供任意 Git 参数、任意环境变量或 `GIT_SSH_COMMAND` 输入。

危险操作有意缺席：

- `reset --hard`
- `clean -fd`
- force push
- `branch -D`
- 自动 merge/rebase
- 自动冲突解决

## 网络与代理

- 代理 URL 是 DSH settings `role('secret')` 字段。
- Client 不能读回代理值。
- 返回 UI 的 endpoint 会移除 userinfo。
- 代理通过 `--config-env` 和单个子进程环境注入。
- Direct 同时覆盖 Git config 并清除继承的代理环境变量。
- Block 在进程启动前执行。
- 代理失败不回退直连。
- HTTP 代理不用于 SSH。

注意：Git credential helper、SSH agent 和系统证书存储仍由运行 DSH Host 的操作系统用户控制。本插件不会复制、展示或持久化它们。

## RPC

插件通过 `ctx.connection.fetch.register()` 注册 `/api/git-workspace/<endpoint>` 精确 POST 路由。它们复用 Connection 的 Host/Origin 检查、浏览器认证和 buffered 请求体限制，不拦截 Gateway。Client 使用 `connection.rpc.call('/api', 'git-workspace/<endpoint>', payload)`；Host 校验标准请求信封及 URL/body method 一致性，并返回带同一 rpcId 的响应。选用精确路由是因为 DSH 0.1.5-rc.1 的独立 rpc.handle 路径在实际插件上下文中触发 webServer 注入错误；无需修改 DSH 源码。 这些传输层检查不替代 handler 的 workspace、repoId 和参数校验。

错误响应不会包含代理 URL、环境变量或完整命令行。Git stderr 可能包含远端服务返回的文本；插件不会主动记录凭据，但用户仍不应把令牌放在 Remote URL 中。若确需代理认证，把凭据放在 secret proxy URL，而非主机列表。

## 输出与资源限制

- 通用 Git 输出上限 8 MiB。
- Diff 与 History 上限 4 MiB。
- 批量仓库上限 100。
- 单次文件列表上限 1000。
- 扫描深度限制 0–12，默认 4。
- 历史默认最多 100 条。

## 报告问题

报告安全问题时请附：

- DSH、Node、Git 和插件版本。
- 操作系统。
- 脱敏后的 Remote 协议与 host。
- `pluginCode` 和 Git 错误文本。

请移除 token、密码、用户名、私钥内容、代理 URL userinfo 和公司仓库路径。
