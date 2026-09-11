# Contributing

## 开发环境

```bash
pnpm install
pnpm check
```

提交前必须保证 typecheck、测试和双端 bundle 全部通过。

## 约束

- 不允许把浏览器传来的 `cwd` 用作 Git 工作目录。
- 新 mutation 必须在 Host 重新读取相关 Git 状态。
- 不允许通过 shell 字符串拼接用户输入。
- 新网络操作必须经过 `proxy-policy.ts`。
- 不增加隐式 stage、merge、rebase、force 或 destructive fallback。
- Host/Client 新字段先更新 `src/shared/protocol.ts`。
- UI 新高风险操作需要明确确认和可读失败原因。

## 测试

纯解析和策略放在单元测试；Git 语义放在临时仓库集成测试。测试不得依赖开发者全局 Git 用户配置。

涉及 Host 注入、Cordis patch 或通信层的修改，还必须在全新临时 DSH Web profile 中执行一次实际启动冒烟测试。仅运行 `--dump-config` 不能发现插件 apply 阶段的服务注册冲突。启动成功的判据是输出 `dsh web: http://...` 且没有 plugin tree load failure。
