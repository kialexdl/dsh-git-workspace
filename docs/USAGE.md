# 使用说明

## 1. 安装

```bash
pnpm install
pnpm build
dsh plugin --profile web add ./
```

安装输入是仓库根目录。DSH 读取 `package.json` 的 `dsh.bundle.patch`，把 `cordis.patch.yml` 中的 `git-workspace` 行加入当前 profile，并自动发现 `./client` 浏览器入口。

官方 DSH CLI 要求明确 `--profile`；`dsh plugin add ./` 只有在外部 wrapper 自行提供默认 profile 时才可用。

## 2. 打开工作台

左侧导航顺序：

```text
新建会话
任务看板（若安装）
Git 工作台
WORKSPACE
```

点击 Git 工作台后，左侧 DSH 导航保留，中间会话区域切换到工作台。DSH 保留当前会话身份，页面挂载生命周期由原生 main slot 管理。

## 3. 发现仓库

打开后默认选中最近保存的 DSH workspace，否则选中列表第一项。每次打开工作台都会立即重新读取 DSH workspace 注册表，打开期间每 5 秒同步一次，因此 workspace 不需要先创建会话。点击“刷新工作区并扫描”可立即同时更新 workspace 列表和当前仓库注册表。

每个仓库显示：

- 相对 workspace 的目录。
- 当前分支或 Detached HEAD。
- staged、unstaged 和冲突数量。
- ahead/behind。
- Remote 数量。

批量范围可通过顶部“全选”和“反选”一次调整，也可继续使用每个仓库前的 checkbox 精确选择。

扫描结果只保存在 Host 内存；路径移动后，旧 `repoId` 会失败并要求重新扫描。

## 4. 修改与 Diff

在“修改”页：

- “修改”区是 worktree 修改。
- “已暂存”区是 index 修改。
- 点击文件名查看相应 Diff。
- Diff 以新旧行号、hunk、上下文、绿色新增行和红色删除行展示，不再直接堆放原始 patch 文本。
- 未跟踪的新文件会按“全部为新增行”展示实际文件内容；二进制文件只显示二进制差异提示。
- `+` 暂存单个文件，`−` 取消暂存。
- “全部暂存”和“全部取消”只作用于当前显示集合。

文件状态在 Host 再次验证。若文件已被外部工具改变，旧操作会被拒绝，刷新后再选。

## 5. 提交

提交按钮只有在以下条件满足时启用：

- 提交信息非空。
- 至少一个文件 staged。
- 当前没有其他操作。

确认框会再次显示 staged 文件数，并明确说明 unstaged 文件不会进入提交。

## 6. 分支

点击“分支”加载本地和 Remote 分支：

- 下拉框按“本地分支”和“远程分支”分组；当前本地分支带 `●` 且不能重复切换。
- 选择 Remote 分支时，确认框会说明即将创建的同名本地分支；确认后使用 `git switch -c <local> --track <remote>/<branch>` 创建并切换。
- “+ 新分支”使用 `git switch -c` 创建并切换。
- `×` 使用 `git branch -d` 安全删除非当前、已合并分支。

`origin/HEAD` 等 Remote 符号引用不会作为可切换分支展示。插件不提供 `-D` 强制删除，也不在 Remote 分支已存在同名本地分支时猜测覆盖方式。

## 7. 提交记录

在“提交记录”页点击任一提交，可以在右侧查看：

- 完整提交消息、作者和时间。
- 完整 commit hash 与父提交。
- 该提交新增、修改、删除、重命名或复制的文件。
- 点击任一变更文件查看该文件在该提交中的 Diff；点击“返回提交”回到元数据和文件列表。

## 8. Remotes

“Remotes”页展示：

- Fetch URL 及其代理决策。
- 每个 Push URL 及其独立代理决策。
- 命中规则的原因。

可以添加、删除 Remote 或修改 Fetch URL。Remote 删除和修改都需要显式操作；不会自动重写其他 Remote。

## 9. Fetch、Pull、Push

- Fetch：逐 Remote 运行，以便每个 Remote 使用自己的网络决策。
- Pull：允许不冲突的本地修改，固定 `git pull --ff-only --no-rebase --no-autostash`；由 Git 检查是否会覆盖本地内容，失败后不自动 stash、合并或变基。
- Push：使用当前分支和已解析 Remote；无 upstream 时，单仓库操作会询问是否发布到首个 Remote。
- Publish：使用 `git push -u <remote> <branch>`。

所有网络操作禁用终端提示。凭据应提前配置在 Git credential helper 或 SSH agent 中。

## 10. 批量操作

1. 在左侧仓库列表勾选范围。
2. 点击批量 Fetch、Pull 或 Push。
3. 检查预检清单。
4. 点击“执行可执行项”。
5. Fetch/Pull 最多同时执行 4 个仓库，Push 按仓库顺序执行；每个完成项都会立即在该行右侧显示“成功”或“失败”。
6. 全部结束后关闭弹窗；若有失败，可点击“重试失败项”，成功和阻止项不会重复执行。

执行期间弹窗保持打开，并显示已完成数量。插件不再使用独立操作中心；批量操作的计划、进度和结果都在同一上下文内。

常见预检阻止：

| 动作 | 阻止条件 |
| --- | --- |
| Fetch | 没有 Remote |
| Pull | 没有 Remote、未解决 conflict、Detached HEAD |
| Push | 没有 Remote、Detached HEAD、没有 upstream |

运行时认证、网络、代理或远端拒绝仍可能让可执行项失败。

## 11. 代理设置

在 DSH 左侧 Plugins（插件管理）中打开 `dsh-git-workspace` 详情页的“Git 工作台网络”。仅本机页面可持久修改配置；建议从最小配置开始：

```text
代理地址：http://127.0.0.1:7890
走代理：github.com
强制直连：git.company.local
禁止访问：（留空）
未命中：继承 Host 环境
```

高约束环境可把“未命中”改成“阻止访问”。

代理地址是只写 secret：

- 留空保存不会删除已有地址。
- “清除代理地址”才会显式删除。
- 页面刷新后不会回显代理 URL 或其中的凭据。

## 12. 故障排查

### 启动时报 `/api already has an interceptor`

这是旧版通信层缺陷：早期版本错误地尝试拦截 DSH API Gateway 已占用的共享 `/api` 通道。DSH 0.2.1 请使用插件 0.3.0 适配分支并重新执行 `pnpm install --no-frozen-lockfile`、`pnpm check`；新版继续使用 `/api/git-workspace/<endpoint>` 精确路由。

### 未发现仓库

- 确认目录具有 `.git` 目录或 `.git` 文件。
- 仓库是否超出默认 4 层扫描深度。
- 目录是否在默认或自定义忽略列表中。
- 符号链接目录不会递归跟随。

### Git 工作台入口未出现

- 确认 `pnpm build` 已生成 `lib/client.js`。
- 确认 `dsh plugin --profile web add ./` 成功写入当前 profile。
- 检查 DSH Web 控制台中是否有 `dsh-git-workspace` 加载错误。

### Push/Pull 报认证错误

插件不会弹出终端凭据输入。先在同一 Host 用户环境中配置 Git credential helper、SSH key 或 SSH agent。

### 主机应直连但仍走代理

- 把主机加入“强制直连”。
- 检查更高优先级的“禁止访问”是否命中。
- Remote 页显示的是最终 URL 的决定，可在那里核对主机。

### SSH Remote 命中代理后被阻止

当前代理字段是 HTTP(S) 代理。将 SSH 主机改为继承/直连，或把 Remote 改成 HTTPS URL。插件不会把 HTTP proxy 当作 SSH ProxyCommand。

### Pull 报分叉

`--ff-only` 拒绝分叉是预期行为。请在终端或后续明确的冲突工作流中由用户选择 merge 或 rebase；插件不替用户做这个决定。
