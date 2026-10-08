# DSH 0.2.1-alpha.1 兼容性迁移说明

基线：DeepSeek Harness `v0.2.1-alpha.1`，官方源码提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。本分支仅执行宿主/浏览器接口迁移，不重写 Git 业务操作。

## 主要改动

- 插件最低运行版本调整为 `>=0.2.1-alpha.1 <0.3.0`，对应 Cordis 更新到 4.0.5-alpha.1。
- 移除已废止的 `ctx.settings.register`，由 Loader 的 `Config` 和 `.volatile()` 负责即时配置。每次操作通过 `.get()` 读取最新值。
- 客户端从 `ctx.settingsScope` 改为 `ctx.configForms.get('git-workspace')`。此处必须使用 profile 插件条目 id，而非 npm 包名。
- 网络配置卡片从旧 `settings.plugin.item` 迁移至 `plugins.bundle.config`，key 为 npm 包名 `dsh-git-workspace`。
- 网络配置保存使用一个 `mutate(ops, revision)`，保证多项字段一起提交；失败不会提示成功。
- 保持 `/api/git-workspace/...` 的 exact Fetch 路由及浏览器 Connection RPC 调用不变。

## 旧版本配置迁移（必要）

0.1.5 时代使用单独命名空间 `dsh-git-workspace` 的设置值。新版设置系统以配置条目 id `git-workspace` 为唯一配置来源，并仅将 `volatile` 字段开放给表单。**不要假设旧 settings 数据自动迁移成功。**

建议升级前备份 profile 的 `cordis.yml`、`cordis.patch.yml` 以及 `settings.yaml`（如果存在），然后在升级后的插件配置页核对以下字段：

- `enabled`
- `scanDepth`
- `ignoredDirectories`
- `proxyUrl`（机密字段，前端不会回显）
- `proxyHosts`、`directHosts`、`blockHosts`
- `defaultAction`

若原数据没有出现在新的 Git 工作台插件配置页，手工转录旧值到插件条目 `git-workspace` 的 `config` 字段或新的配置表单中；不要把 `settings.yaml` 无判断地覆盖成新版 `cordis.patch.yml`。

**明确未自动迁移旧密钥。** 这是为了避免首次启动时在错误的 profile 写入秘密值，或覆盖新版本用户已修改的配置。旧文件保留供人工核对。

## 使用源码安装

```bash
pnpm install
pnpm check
dsh plugin --profile web add ./
```

升级后重启宿主并强制刷新浏览器。

## 建议验收

1. 启动后无 `ctx.settings.register is not a function`，左侧 Git 工作台仍能打开。
2. 插件详情页能看到网络配置卡片，设置修改能即时影响下一次 Fetch / Pull / Push。
3. 代理地址未被回显。重启后其他设置保留，代理依然有效。
4. 扫描空工作区、已有多仓库工作区，以及新增但没有会话的工作区。
5. 检查全部 RPC 请求，特别是 `workspaces`、`commit/diff`。
6. 测试 Fetch / Pull / Push，以及批量 Fetch/Pull 进度与错误隔离。
7. 复核旧用户 profile 配置和跨版本卸载/重装。

本分支尚未在实际 0.2.1-alpha.1 宿主上完成端到端验证；不可把静态检查当作运行通过。
