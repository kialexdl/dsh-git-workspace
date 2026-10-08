# dsh-git-workspace

> DSH 0.2.1-alpha.1 兼容性适配分支（插件源码版本 0.3.0）。升级前必须核对旧设置数据；详情见 [0.2.1 迁移说明](docs/DSH-0.2.1-ADAPTATION.md)。

## DSH 0.2.1 启动依赖修复

DSH 0.2.1 的 `Config` 字段使用 `.volatile()`，必须搭配支持该接口的 `@deepseek-ai/schemastery`。插件将此直接依赖固定为 `3.18.5-alpha.1`，与官方 DSH 0.2.1-alpha.1 源码保持一致。此前仓库中的 `pnpm-lock.yaml` 仍锁定旧版 `3.18.2` 和 DSH 0.1.5 的依赖，已从适配分支移除；本地执行安装命令会重新生成与新版依赖一致的锁文件。

已有源码目录升级时，建议执行：

```powershell
git fetch origin
git switch compat/dsh-0.2.1-alpha.1
git pull --ff-only origin compat/dsh-0.2.1-alpha.1
pnpm install --no-frozen-lockfile
node -e "import('@deepseek-ai/schemastery').then(({default:z}) => console.log('volatile:', typeof z.boolean().default(true).volatile))"
pnpm check
```

预期输出包含 `volatile: function`。如果不是，检查当前目录是否正确、依赖版本是否已更新。构建流程本身也包含运行时 API 自检，可以在 DSH 启动前阻止旧依赖进入构建产物。

## 当前兼容基线

- 宿主版本：DSH `>=0.2.1-alpha.1 <0.3.0`（静态接口基线：`5badb15`）。
- 网络设置入口：插件管理 → `dsh-git-workspace` 详情页；新版设置编辑绑定 `git-workspace` profile 条目。
- 旧版 `ctx.settings.register` / `settings.plugin.item` 已移除；网络设置使用 `volatile` 配置与 `plugins.bundle.config`。
- 本分支尚未完成实际 DSH 宿主集成测试，不能视为已验收的稳定发布。


面向 DeepSeek Harness（DSH）Web UI 的单 workspace 多 Git 仓库工作台。

一个 DSH workspace 下可以同时发现和维护多个彼此独立的 Git 仓库，并在同一界面完成状态查看、暂存、提交、历史查看、分支与 Remote 维护、Fetch、Pull、Push 和批量网络操作。Remote 可按实际目标主机选择代理、直连、继承 Host 环境或阻止访问。

## 历史版本 0.2.1 修复

修复 0.2.0 打开工作台时报 `connection: invalid RPC target`。RPC 使用 `/api` channel + `git-workspace/<endpoint>` method；请同时更新 Host 与 Client，重启 DSH 后按 Ctrl+F5 刷新浏览器。原本同目录 link 安装无需重新注册。

## 能力

- 在当前 DSH workspace 内有限深度扫描多个独立 Git 仓库。
- 仓库总览：分支、ahead/behind、staged/unstaged、冲突和 Remote 数量。
- 文件级 Diff、Stage、Unstage、Stage All、Unstage All。
- Diff 使用带新旧行号、hunk 和增删颜色的可读视图；未跟踪新文件直接展示新增内容。
- Commit 只提交 staged 内容，绝不隐式执行 `git add -A`。
- 最近 100 条提交记录，并可查看完整消息、作者、时间、父提交、变更文件及每个文件在该提交中的 Diff。
- 本地与 Remote 分支分组展示；选择 Remote 分支时明确创建同名本地跟踪分支。支持分支创建和安全删除（`git branch -d`）。
- Remote 添加、删除和 Fetch URL 修改。
- Fetch、Pull、Push 独立操作；Pull 使用 `--ff-only --no-rebase --no-autostash`，允许不冲突的本地修改。
- 工作台、Diff、批量弹窗和网络设置跟随 DSH 亮色/深色主题及其颜色变量。
- 批量 Fetch/Pull 最多 4 个仓库并行，Push 顺序执行；弹窗内实时显示等待、执行中、成功、失败和阻止状态，并可仅重试失败项。
- 仓库批量范围支持全选、反选和逐项选择。
- 仓库栏、主操作区和 Diff/提交详情栏之间可拖拽调整宽度；详情栏未使用时不占空间。
- DSH Settings 内的简化代理配置：走代理、强制直连、禁止访问三组主机列表。
- Fetch URL 与 Push URL 分别决策；代理失败不会静默回退直连。
- Windows、macOS 和 Linux 的 Node.js 原生子进程调用，不经 shell 拼接用户输入。

## 旧版环境要求（历史记录，当前请参照上方兼容基线）

- DSH `0.1.5-rc.1`（本次验证版本，2026-09-10，commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`）；最低接口要求 `>=0.1.5-rc.1 <0.2.0`。旧 DSH 请继续使用插件 0.1.4。
- Node.js `^22.19.0` 或 `>= 24`
- pnpm（仓库声明 `pnpm@11.21.0`）
- Git CLI；建议 Git `>= 2.31`，代理注入依赖 `git --config-env`

## 历史版本升级到 0.2.1

本版本迁移到 DSH 新插件接口，不兼容 0.1.1 系列宿主。先升级 DSH 至 `0.1.5-rc.1`，然后停止 DSH、将 0.2.1 源码覆盖到原插件目录并执行：

```powershell
pnpm install
pnpm build
```

若原来使用本地 link 安装且目录没有变化，重启 DSH 并刷新浏览器即可。若使用安装包或改变目录，重新执行 `dsh plugin --profile web add <插件目录或tgz路径>`。升级保留 `dsh-git-workspace` 包名、插件 ID和 settings namespace，不需要重建工作区或修改已有代理规则。

详细变更分析与验证记录见 [docs/DSH-0.1.5-ADAPTATION.md](docs/DSH-0.1.5-ADAPTATION.md)。

## 安装

在本仓库根目录执行：

```bash
pnpm install
pnpm build
dsh plugin --profile web add ./
```

不需要复制构建产物、不需要手工修改 DSH profile，也不需要写全局 Git 配置。`cordis.patch.yml` 和 `dsh.client` 清单已经随包提供。

> DSH 官方 CLI（已核对 `0.1.5-rc.1`）把 `--profile` 定义为 `plugin` 子命令的必填参数，因此官方发行版会拒绝字面命令 `dsh plugin add ./`。插件包在被安装前无法改变 CLI 的参数解析。若你的 DSH 发行版或本地 wrapper 已把默认 profile 固定为 `web`，可使用该简写；官方 CLI 的零额外配置命令是上面的 `dsh plugin --profile web add ./`。

构建后应出现：

```text
lib/index.js   # DSH Host 插件
lib/client.js  # DSH Web 客户端插件
```

## 使用

插件加载后，DSH 左侧原生全局面板列表中出现“Git 工作台”入口，折叠侧栏时显示图标。入口排序由 DSH 管理，不再依赖其他插件的 DOM 结构。

1. 点击“Git 工作台”。
2. 选择 DSH workspace；插件会扫描其中的 Git 仓库。
3. 在左栏选择仓库，在中栏查看修改、历史或 Remotes；批量范围可使用全选和反选。
4. 修改文件时，先明确 Stage，再填写提交信息并确认 Commit。
5. Fetch、Pull、Push 都有独立入口；批量操作在同一弹窗完成预检、实时进度和失败重试。
6. 点击“关闭并返回会话”返回 DSH 当前会话。导航由 DSH 原生 layout 管理，不改变当前 Session 身份；页面挂载与卸载遵循 DSH 原生 main slot 生命周期。

工作台每次打开都会重新读取 DSH 的 workspace 注册表，因此刚新增但尚未创建会话的 workspace 也会出现在选择器中；打开期间列表每 5 秒同步一次。

更完整的操作说明见 [docs/USAGE.md](docs/USAGE.md)。

## Remote 代理设置

进入：

```text
DSH Settings → 插件配置 → Git 工作台网络
```

配置项：

| 配置 | 作用 |
| --- | --- |
| 代理地址 | HTTP(S) 代理，例如 `http://127.0.0.1:7890`；按 secret 处理，保存后不回显 |
| 走代理的主机 | 命中后为本次 HTTP(S) Git 子进程注入代理 |
| 强制直连的主机 | 清除本次子进程继承的代理环境并覆盖 Git HTTP proxy |
| 禁止访问的主机 | 在启动 Git 网络命令前阻止 |
| 未命中时 | `inherit`、`direct` 或 `block` |

每行一个主机，也可用逗号分隔。支持 `*` 通配符：

```text
github.com
*.githubusercontent.com
git.company.local
```

决策优先级固定为：

```text
禁止访问 → 强制直连 → 走代理 → 默认动作
```

示例：

- `github.com` 放入“走代理的主机”。
- `git.company.local` 放入“强制直连的主机”。
- 默认动作选择“阻止访问”，使未知目标失败关闭。

代理只作用于当前一次 Git 子进程，不写 `git config --global`，也不修改仓库配置。当前版本只为 HTTP(S) Remote 注入 HTTP 代理；SSH Remote 可继承、直连或阻止，但不会把 HTTP 代理错误套到 SSH 上。

## 安全语义

- 浏览器 RPC 只传 `workspaceId` 和 `repoId`，不传可执行绝对 `cwd`。
- Host 通过 DSH `workspaceRegistry` 解析 workspace，并用 canonical path 验证仓库仍位于 workspace 内。
- 文件操作只接受当前 `git status` 中实际出现的路径。
- Git 通过 `spawn('git', args, { shell: false })` 执行，分支、路径、URL 和提交信息不进入 shell 字符串。
- Commit 不会自动暂存。
- Pull 允许不妨碍快进的本地修改，使用 `--ff-only --no-rebase --no-autostash`；覆盖风险、已有冲突或分叉时停止。失败时 fetch 可能已更新远端跟踪引用，本地内容和 HEAD 由 Git 原生保护，不自动 stash、merge 或 rebase。
- 代理凭据使用 DSH settings secret 字段；浏览器读取不到保存值。
- 代理或认证失败不会自动尝试直连。
- 插件 RPC 使用 `/api/git-workspace/<endpoint>` 精确路由，不会与 DSH API Gateway 的共享 `/api` interceptor 冲突。

详细边界见 [docs/SECURITY.md](docs/SECURITY.md)。

## 扫描规则

默认从 workspace 根目录扫描 4 层，识别 `.git` 目录和 worktree/submodule 使用的 `.git` 文件。以下目录默认跳过：

```text
.git node_modules .pnpm-store .cache .next .nuxt .turbo
dist build coverage target vendor .venv venv __pycache__
```

Host 会对候选目录运行 `git rev-parse --show-toplevel`，canonical path 去重后再生成稳定 `repoId`。符号链接目录不会被递归跟随。

扫描深度和额外忽略目录属于插件 settings schema，默认安装无需配置。

## 批量操作

批量操作分为两段：

1. 客户端预检：无 Remote、存在未解决冲突的 Pull、Detached HEAD、未发布 Push 等会被标为“阻止”。
2. 客户端发起单仓库操作：Fetch/Pull 使用最多 4 个 worker 并行，Push 保持顺序执行；当前行显示“执行中”，完成后立即在列表右侧显示“成功”或“失败”，阻止项不会发送请求。

弹窗在执行期间保持打开且不能误关闭；完成后可关闭，失败项可单独重试。工作台不再提供独立“操作中心”。

Git 不提供跨多个独立仓库的原子事务，本插件不会在部分成功后尝试危险的自动回滚。

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

一次执行全部门禁：

```bash
pnpm check
```

测试包含：

- Porcelain v2 状态解析。
- Remote URL 与代理策略匹配。
- 临时 Git 仓库集成测试：多仓库发现、staged-only commit、unborn branch unstage、过期路径拒绝、Remote 分支跟踪切换、非首条提交详情和提交文件 Diff。
- Host/Client 独立 RPC channel 契约，防止回退到共享 `/api` interceptor。
- Fetch/Pull 并发与批量实时进度、workspace 重新同步、可调整栏宽、本地/Remote 分支切换、工作区/历史提交文件 Diff 和可读 Diff 行号。

## 源码结构

```text
src/
├── index.ts                  Host 插件入口、Settings 与 RPC
├── host/
│   ├── repository-service.ts 仓库注册表和 Git 业务语义
│   ├── git-process.ts        无 shell 的 Git 子进程封装
│   ├── proxy-policy.ts       Remote 主机决策和单进程代理注入
│   └── status-parser.ts      porcelain v2 -z 解析
├── client/
│   ├── index.tsx             Web 客户端入口
│   ├── Workbench.tsx         多仓库工作台
│   ├── DiffViewer.tsx        带行号和增删语义的 Diff 视图
│   ├── CommitDetailView.tsx  提交详情与变更文件
│   ├── NetworkSettingsCard.tsx DSH Settings 卡片
│   ├── native-panel.tsx      原生面板图标与 main slot 内容
│   └── panel-controller.ts   工作台显示生命周期
└── shared/protocol.ts        Host/Client 共享协议
```

完整架构和 UCD 见 [docs/DESIGN.md](docs/DESIGN.md)。

## 已知边界

- 不提供交互式凭据输入；凭据由 Git credential helper、SSH agent 或系统凭据管理器处理。
- HTTP 代理不转换 SSH Remote；结构化 `ProxyJump` 不在当前版本范围内。
- 不自动执行 merge、rebase、force push、hard reset、clean 或冲突解决。
- Diff 主要面向文本差异；未跟踪普通文件会生成 new-file patch，二进制文件只展示 Git 可提供的元数据。
- 左侧主入口使用与 dsh-web“任务看板”相同的宿主适配方式；当 DSH 提供正式 workspace 级导航 slot 后，只需替换该适配层。

## 设计参考

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [mojiexuan/dsh-git](https://github.com/mojiexuan/dsh-git)
- [luoyu-xingu/dsh-multi-root](https://github.com/luoyu-xingu/dsh-multi-root)
- [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web)
- [Git status porcelain v2](https://git-scm.com/docs/git-status)
- [Git config](https://git-scm.com/docs/git-config)

## License

Apache-2.0。第三方实现模式的来源说明见 [NOTICE](NOTICE)。
