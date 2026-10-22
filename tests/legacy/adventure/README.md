# 历史单表验证

此目录保留旧 JSON 单表、周期与次日结算引擎及其测试，仅用于历史参考；不属于当前五表 RPC 实现，也不作为本期通过证据。当前应用与 Worker 不导入这里的代码。未删除或修改旧数据库、初始化 SQL 及任何远端数据。

可通过仓库根目录的独立配置复跑：

```sh
npx vitest run --config vitest.legacy.config.ts
```

当时的验证范围见 `docs/adventure/domain-validation.md` 和 `docs/adventure/qa-backend.md`。
