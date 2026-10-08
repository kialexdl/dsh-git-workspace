# DSH 0.2.1-alpha.1 兼容性复查

复查时间：2026-10-08。宿主依据 `deepseek-ai/deepseek-harness@5badb15009ae1756c3afe0ae0cef1faafc290ccc`（发布标签 `dsh-v0.2.1-alpha.1`）。
插件依据分支 `compat/dsh-0.2.1-alpha.1`。

## 已逐项核对的接口

| 范围 | DSH 0.2.1 行为 | 插件处理 | 结论 |
| --- | --- | --- | --- |
| Schema | `@deepseek-ai/schemastery@3.18.5-alpha.1` 含 `.volatile()` | 固定直连依赖、构建前运行时检查、移除旧锁文件 | 静态一致；待宿主启动 |
| Loader Config | Loader 将 volatile 字段包装为 `Volatile<T>` | 使用 `Config` schema，运行时通过 `.get()` 读取，数组拷贝 | 静态一致 |
| Settings | `ctx.settings.register()` 已删除，按 profile entry id 寻址 | 使用 `ctx.configForms.get('git-workspace')` | 静态一致 |
| 设置页 | 社区包通过 `plugins.bundle.config` keyed slot 注册 | key 为 npm 包名 `dsh-git-workspace` | 静态一致；待 UI 测试 |
| 设置写入 | `ConfigForm.mutate(ops, revision)` 支持原子修改 | 一次提交主机列表与默认策略，错误不会提示成功 | 静态一致 |
| RPC（Remote Procedure Call） | Connection 采用 `/api` + 端点路径，处理器含 operator Peer（调用方身份） | `connection.fetch.register` 精确路由，传递 `connection.operator` | 静态一致；待通信实测 |
| 工作区 | `workspaceRegistry.list/get` 仍可用 | 保留注册表发现与路径验证 | 静态一致 |
| Sidebar（侧栏）及 main（主面板） | `sidebar.panellist`、`main` slot 保留 | 保留原生工作台面板 | 静态一致 |
| 主题 | 使用 `body[data-ds-dark-theme]` 和变量 | 现有样式选择器一致 | 静态一致 |
| 浏览器模块 | lazy-CJS（按需 CommonJS 兼容模块）工厂由 `window.__ModuleLoader__.load` 注册 | `build.mjs` 保留此构建模型 | 静态一致 |

## 本轮复查中修复的残留

1. `tests/native-panel.spec.tsx` 仍测试已删除的 `settings.plugin.item` 和 `settingsScope`，现迁移到 `plugins.bundle.config`、`configForms` 测试桩。
2. `tests/real-connection.spec.ts` 假设 Fetch 目标是 URL 对象；当前 Connection 发送的是文档相对路径字符串，测试改为规范化 URL。
3. `pnpm-workspace.yaml` 仍列出 0.1.5-rc.1 的 `minimumReleaseAgeExclude`，现统一到 0.2.1-alpha.1 和 Schemastery 3.18.5-alpha.1。
4. 宿主导出的 `SETTINGS_NAMESPACE` 仍为旧名；现修正为 `git-workspace` 并保留 `LEGACY_SETTINGS_NAMESPACE` 供旧设置辨识。
5. 新增配置 schema 的真实运行时默认值测试，以及旧版本名单残留检查。

## 尚未完全解决或无法仅凭静态源码确认的风险

### A. 旧设置自动迁移：需要人工核对

旧插件以 `dsh-git-workspace` 保存代理设置，新版以 profile entry id `git-workspace` 管理配置。官方的 `settings.yaml` 一次性迁移没有针对这个插件的额外映射，因此不能假定旧版机密值已恢复。

升级前备份 profile 的 `cordis.yml`、`cordis.patch.yml`、`settings.yaml`（若存在）；升级后确认 `proxyHosts`、`directHosts`、`blockHosts`、`defaultAction` 和不回显的 `proxyUrl`。如需恢复，按新表单手动重填。不要删除旧设置备份。

### B. 配置 UI 的本机权限限制

DSH 0.2.1 的 `configForms` 在非 loopback（非本机环回页面）连接下可能只提供 memory（内存）模式，无法持久写入 Host 设置；本插件展示「不可编辑」状态。请在 DSH 本机页面测试保存行为，不要把远程浏览器的写入受限误判为插件缺陷。

### C. 仍需运行以下门禁

```powershell
pnpm install --no-frozen-lockfile
node -e "import('@deepseek-ai/schemastery').then(({default:z}) => console.log('volatile:', typeof z.boolean().default(true).volatile))"
pnpm check
```

启动测试 profile 后验证：插件导入、工作台导航、无 Session 的新工作区发现、主题切换、Settings 的保存/重启后读取、代理策略、Fetch/Pull/Push、批量进度、提交详情 Diff，以及动态启停插件后的路由释放。

**验证状态：仅完成源码级接口审查、提交测试修正，未在本地 0.2.1-alpha.1 Host/Browser 上执行 `pnpm check` 或运行期端到端验证。**

## 参考

- DSH `packages/client/connection/src/rpc-host.ts`
- DSH `packages/settings/settings/src/index.ts`
- DSH `packages/client/ui-settings/src/client/config-form.ts`
- DSH `packages/client/ui-plugin-manager/src/client/slot-contract.ts`
- DSH `packages/client/ui-layout/src/client/theme-presenter.ts`
- DSH `packages/workspace/workspace/src/index.ts`
