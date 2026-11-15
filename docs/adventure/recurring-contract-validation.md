# #198 契约验证与评审记录

工作区 `/home/lighthouse/orca/workspaces/lifespace/198-recurring-contract`，分支 `codex/198-recurring-contract`，基线／目标提交及 merge-base 均为 `7730a2f17ebe5fa6e191637c02429c24692ab84b`。需求固定提交 `3a45dab02e59cf1ac486b86a313463acbcbfe2e4`，范围为共享契约、纯API入口和设计；属于需确认变更，无合并、生产迁移或部署授权。首轮候选提交为 `cbe7eddff3c71b4e55e2702e94567927fefe1ebf`；下表保存该轮验证，后续修复与复测另列。修复候选的精确 SHA 随 Orca 协调回执报告；独立评审必须记录其实际待审 SHA。

所有 Node/npm 命令均显式使用 `PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH`。没有执行生产数据库操作，没有提交本地私有配置、原型代码或截图包。

| 验证 | 实际结果 |
| --- | --- |
| npm ci | 沙箱内 esbuild spawnSync EPERM，退出1；沙箱外重跑退出0，133包、0漏洞 |
| npm run typecheck | 最终退出0；首次发现旧生命周期组件无法收窄新preview联合类型，添加操作名判断后修复；测试fixture的literal类型用satisfies修复 |
| npm run test:api -- tests/api/adventure-recurring-contract.test.ts tests/api/adventure-planning.test.ts tests/api/adventure-client-version.test.ts tests/api/adventure-cutover-handshake.test.ts tests/api/adventure-category-growth.test.ts tests/api/adventure-goal-console.test.ts | 退出0，6文件／41项通过，无跳过 |
| npm run test:api | 最终退出0，25文件／376项通过，33文件／208项跳过；跳过部分依赖隔离数据库配置，不计为真实DB验证通过 |
| npm run build | 退出0，Worker与客户端均构建完成；产物仅留在忽略目录，不作部署交付 |
| npm run check:secrets | 退出0，206个可达历史提交和当前Git范围扫描均未发现泄漏；后续提交仍由钩子扫描暂存差异 |
| git diff --cached --check | 退出0 |
| 共享文档相对链接检查 | 无缺失的本地链接；原型依据保持固定远端链接 |

`npm run test:security:portable` 首次沙箱内两个测试进程失败（退出1）；沙箱外重跑明确暴露未暂存新文件未被 `git ls-files` 复制，临时副本无法解析 `adventure-recurring` 导入。将新增契约文件正常暂存后重跑，不修改测试或测试预期；最终重跑退出0，4项通过、0失败／0跳过，主安全报告7项检查全部通过；两条故意失败的嵌套负例维持预期非零，并由外层断言通过。

## 范围自检（不等于独立评审）

规范轴：基于 main 现行四表、目标分类、owner隔离、共享Zod、PlanningError及成功回执约定，未恢复主线／historical_lock，未添加SQL业务或生产测试入口。保留main的ADR0012，周期来源ADR只重编号；CONTEXT仅补充周期必需术语。唯一tsx改动为现有生命周期preview的类型收窄，无新增产品UI行为。

需求轴：R01–R54及approved-v1作为范围依据，冻结六个周期命令、五个只读方法、父子快照／能力／分页、计奖统计和跨天错误，当前期计数差量与历史冻结见契约／ADR0014。独立父规则表、子复用任务与事件使每行动有独立taskId，未增加暂停、每日周期、RRULE、逐期快照、子备注或整期奖励。旧一次性封套、历史大额冻结奖励、五表时期只读接续均有回归覆盖。

独立规范／需求双轴评审：#56协调者对固定范围 `7730a2f17ebe5fa6e191637c02429c24692ab84b` → `cbe7eddff3c71b4e55e2702e94567927fefe1ebf` 组织了独立评审，规范轴0硬性问题／0 Fowler建议，需求轴1项P2阻塞，反馈由Orca消息 `msg_adebaf48316f` 转达。问题为新六字段探针和recurring-1回执头无法被基线旧客户端的严格恢复解析器接受；初轮评审未通过，不能放行下游。worker未创建helper worker；修复后须交协调者复审，下面只记录实施与验证，不能自称独立复审通过。

## 后续验证责任

#199：正式Worker路由／RPC和SQL、客户端版本门禁同步切换、新库／非空四表升级等价、事务回滚、owner／授权、并发上限、真实日界锁等待、计数与奖励完整性。#200／#201：原型26状态、桌面／手机／键盘和外围范围对照、pending及toast、真实前后端／隔离数据库联通、必需CI与统一PR。上述真实DB、浏览器、用户验收和生产验收在本票均未执行；本票契约通过不能替代这些验收。

modern-web-guidance：查询了fetch错误和请求主题，没有适用于本次纯契约请求代码的新增平台指南，未强行加入无关特性。

## P2 旧页面恢复兼容修复

修复相对 `cbe7eddff3c71b4e55e2702e94567927fefe1ebf`：`adventure-client-version.ts` 定义固定四字段 `planningCompatibility`／schema 和独立 `adventureReceiptModel=goal-categories-1`，删除六字段探针分支；`planningApi.lookupReceipt` 不再根据写版本协商回执头。现有Worker探针与lookup头仅改接共享冻结值，使 #199 将写门禁切到recurring-1时不改变旧页面恢复协议，没有新增业务路由、RPC、SQL或产品UI。契约中新增 #199 必须保留旧只读协议且不放开旧写入的实施门禁。

新增 `tests/api/adventure-recurring-receipt-compatibility.test.ts` 在现有模块seam模拟将写门禁切到recurring-1，经正式HTTP入口验证：基线旧严格四字段探针／头判定可读取合法旧回执fixture；新客户端读取旧及周期pending；旧目标终态／计奖写与legacy-retry依然拒绝且不调用RPC；查无、异摘要、重放不可用及未知错误保持未知、不改封套、不落到command。RPC为本地fixture，不代表真实DB回放已验证。既有纯客户端测试还覆盖加字段探针或误用recurring-1回执头保持未知、不自动写入。

受影响验证：

- `npm run typecheck`：退出0。
- `npm run test:api -- tests/api/adventure-recurring-contract.test.ts tests/api/adventure-recurring-receipt-compatibility.test.ts tests/api/adventure-cutover-handshake.test.ts tests/api/adventure-client-version.test.ts tests/api/adventure-planning.test.ts tests/api/adventure-category-growth.test.ts tests/api/adventure-goal-console.test.ts`：退出0，7文件／48项通过，无跳过。
- `npm run test:api`：退出0，26文件／383项通过，33文件／208项数据库相关测试跳过；跳过不计通过。
- `npm run build`：退出0，含类型检查、Worker与客户端构建。
- 文档相对链接与暂存diff检查：无缺失／无空白错误。

workers-best-practices：按现有安装类型核对两处Worker的JSON／响应头接线，没有新增平台API或改变runtime配置。本轮 `npm run check:secrets` 退出0，207个可达历史提交及当前Git范围均无泄漏；`npm run test:security:portable` 退出0，4项通过、0失败／0跳过，主报告7项检查通过，预期失败的嵌套负例仍保持非零。独立复审待协调者返回，不计作完成。
