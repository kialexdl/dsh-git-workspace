# DSH 最新发布适配分析与交付说明

日期：2026-09-10；修订：2026-09-11  
插件：`dsh-git-workspace 0.1.4 → 0.2.1`  
目标：DSH `0.1.5-rc.1`，tag `dsh-v0.1.5-rc.1`  
源码 commit：`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`

## 0.2.1 修正：真实客户端拒绝多段 channel

0.2.0 把 `/api/git-workspace` 作为 channel 传给客户端，违反 DSH 的一级 channel 约束，导致所有请求在发出前失败。此前组件测试 mock 了 rpc.call，真实 HTTP 测试手工组装请求，因此遗漏了客户端的地址校验。这个遗漏已在 0.2.1 修复。

现在 channel 固定为 `/api`，method 为 `git-workspace/<endpoint>`。实际 URL 不变；Host 对完整 method 校验后，向业务层传入去除 namespace 的 endpoint。

新增测试直接执行已安装 DSH 发布包的 client bundle，而非复制其正则或 mock rpc.call。测试复现旧 channel 报错，并验证全部 22 个 endpoint 往返调用。更新后必须重启 DSH 并刷新浏览器，让 Host 与 Client 同时生效。

修复后还通过真实联调：GitWorkspaceApi → 官方 Connection client bundle → 本地实际 DSH Host → 插件路由，工作区列表请求成功；未认证 401 和跨来源 403 仍有效。

## 结论

已完成针对最新发布候选版的代码适配，保留多仓库管理、并行 Fetch/Pull、逐行批量进度、文件 Diff、可调分栏和代理设置。主要工作是迁移已删除的依赖与设置接口、使用原生面板，以及处理真实宿主启动时暴露的 RPC 注册问题。

本次基线是项目现存的 0.1.4 源码包，其开发依赖仍固定在 DSH 0.1.1-rc.2。源码中没有此前讨论的主题同步与 dirty worktree Pull 修复，因此本次同时补齐。这里的“最新”指 2026-09-10 发布页最新的 `0.1.5-rc.1`，不是对未来 main 分支或后续候选版本的兼容承诺。

[官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)

## 与插件相关的变更

| 范围 | 0.1.4 使用方式 | 最新代码与本次处理 |
| --- | --- | --- |
| 客户端上下文 | 从已删除的 `dsh-client-runtime/client` 导入 | 改为 Cordis `Context`；分别导入 renderer、settings、layout 等接口 |
| RPC 类型 | `dsh-host-apiproxy/api` | 改为 Connection 的 `ConnectionRpcResult` 和标准请求 schema |
| Host 设置 | `installSettingsSection`、`settingsNamespace` | 改为 `ctx.settings.register(namespace, schema, {base, applies:'live'})`，每次操作从 scope 读取最新值 |
| Schema | `schemastery` | 使用 DSH 当前的 `@deepseek-ai/schemastery` |
| 设置卡片 | 自行重复声明 slot | 导入 `dsh-client-ui-settings-plugins/client` 的官方 slot 声明；namespace 仍为 `dsh-git-workspace` |
| 导航入口 | 查询 New Session DOM、手工插入按钮 | 注册 `sidebar.panellist`，由 DSH 渲染入口、选中状态、折叠图标和标签 |
| 工作台宿主 | 向 center column 插入 React root 并隐藏会话 | 注册 root-scoped `main` key；关闭调用 `layout.selectPanel(null)`，不要求存在当前 Session |
| 主题 | 在 `:root` 解析不存在的 page/surface/text 变量 | 在插件表面继承 body 的真实 bg/label/border token；针对 `data-ds-dark-theme` 补齐状态色 |
| 工作区 | `workspaceRegistry.list/get` | 最新接口仍适用；删除强制类型转换，让编译器直接校验真实接口，继续显示无会话 workspace |
| Git 进程与代理 | `node:child_process.spawn` 和每进程代理规则 | 保留；本来就有 `windowsHide:true`，不依赖 DSH subprocess handle 或 pid |

代码依据：

- [Layout 接口与 main slot](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-layout/src/client/index.ts)
- [Sidebar 全局面板契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-sidebar/src/client/contract/slots.ts)
- [Settings 注册接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/settings/settings/src/index.ts)
- [主题 presenter](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-layout/src/client/theme-presenter.ts)
- [实际主题 token](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-theme/src/styles/design-platform.css)
- [Workspace registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/workspace/workspace/src/index.ts)

## 实际启动发现的 RPC 问题

最新 `rpc.handle(channel, handler)` 已不接收 `authority` 第三个参数。删除旧参数后可以通过类型检查，但真实插件启动仍报 `cannot get property "webServer" without inject`。在插件自身声明 `webServer` 依赖也不能消除问题：该版本的 Connection 注册路径通过其 provider shadow context 读取 `webServer`。

最终使用当前公开的 `ctx.connection.fetch.register()`，为每个插件 endpoint 注册独立的精确 POST 路由：

```text
/api/git-workspace/workspaces
/api/git-workspace/scan
/api/git-workspace/commit/detail
...
```

不占用 Gateway 的 interceptor，不修改 DSH 源码。客户端使用 `connection.rpc.call('/api', 'git-workspace/<endpoint>', payload)`；Host 使用官方 `clientRequestSchema`，校验 content-type、JSON、请求信封及 URL/body method 一致性，响应携带同一 rpcId。路由复用 Connection 的 Host/Origin 检查、浏览器会话认证和 buffered 请求体上限。

旧 `/git-workspace/*` 地址不再由 0.2.0 提供。随包客户端已同步迁移；如果另有自编 RPC 调用方，也须更新地址。升级后请重启 DSH 并刷新浏览器，避免新旧客户端与 Host 混用。

[Connection 路由实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/connection/src/rpc-host.ts)

## 安全 Pull 的具体语义

使用 `git pull --ff-only --no-rebase --no-autostash <remote> <branch>`：

- 本地未暂存、已暂存或未跟踪文件，只要不妨碍 Git 快进，就允许拉取。
- 已有未解决冲突、远端更新会覆盖本地文件、或提交历史分叉时拒绝执行。
- 不根据文件名简单推断“无冲突”，最终以 Git 的快进与工作树保护检查为准。
- 显式禁止 rebase 和 autostash，避免用户全局或仓库配置改变操作语义。
- 失败前 fetch 可能已经更新远端跟踪引用；这不等于本地分支已更新。测试验证了覆盖风险和分叉失败时 HEAD 与本地工作不变。

这继续保留原先的 ff-only 范围：即使分叉可以无冲突 merge，也不会自动合并。

## 本次无需迁移的 DSH 变更

Session V3、SessionHandle、异步 agentLoop.create、移除 ctx.agent、Inbox 接口、新模型与子代理队列均不被该 Git 插件直接调用。插件只依赖 workspace registry 获取身份和根目录，不读取 Session 日志，因此无须新增日志迁移或 Agent 适配层。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm check` | 通过：Host/Client 与测试类型检查、69 项测试、双端构建 |
| Git 回归 | 临时真实 Git 仓库验证独立修改、覆盖风险、分叉、分支、提交和 Diff |
| 真实客户端契约 | 已安装的官方 Connection client bundle：复现旧错误，验证 22 个端点及工作区、提交 Diff 调用 |
| 原生 slot | 使用最新 SlotCore 与 React/jsdom 验证注册、无会话打开、关闭返回、卸载清理 |
| 最新发行包启动 | 安装官方 `@deepseek-ai/dsh@0.1.5-rc.1`，临时 Web profile 加载本插件后出现 `dsh web: http://...` |
| 真实 HTTP | 已认证插件请求 200；未认证请求 401；跨来源请求 403 |
| Windows / 浏览器视觉 | 未在用户 Windows 环境实测；本环境 Chromium 下载失败，没有把 jsdom 测试算作完整视觉验收 |

原生 main slot 按 DSH 导航规则挂载与卸载。宽度和上次 workspace 选择仍保存；临时详情、未提交的输入和批量弹窗不持久化。切换面板不表示撤销已经发出的 Git 请求；重新打开后可以刷新仓库状态，但不会恢复上一轮批量进度弹窗。

## 升级方式

先将 DSH 升级到 `0.1.5-rc.1`。停止 DSH，将 0.2.1 源码覆盖到原插件目录后执行：

```powershell
pnpm install
pnpm build
```

原本是 link 安装且目录不变：重启 DSH、刷新浏览器即可。若更换目录或使用 tgz 安装包：

```powershell
dsh plugin --profile web add ./dsh-git-workspace-0.2.1.tgz
```

源码安装仍可用 `dsh plugin --profile web add ./`。包名、Host entry、Settings namespace 均保留，不需重建 workspace 或代理规则。0.2.0 不兼容旧 DSH；回退时需同时恢复旧宿主和旧插件版本。
