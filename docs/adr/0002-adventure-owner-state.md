# 人生冒险使用账户隔离聚合和版本提交

人生冒险是个人可写任务与成长数据，复用既有 Auth 在线验证身份。旧首页共享 tasks/schedules 不迁移、不改写。

Worker 以 verified identity UUID 访问 Supabase 独立 `adventure_states`；浏览器对该表无直接读写权限。每个账户保存一个 JSON 状态、版本和命令 journal，服务端严格领域命令计算后以 owner_id 和预期 version 条件更新。journal 与奖励来源在同一次 CAS 提交；同 key 重试返回稳定结果和最新状态，普通版本冲突要求刷新确认，结算刷新允许有限次数重算。

账户规划日期固定 Asia/Shanghai，由服务端时钟决定，与天气地区和客户端日期独立。页面 GET 仅初始化缺失账户；次日业务结算使用显式 refresh 命令。初始化用 ignore-duplicates，不能覆盖已有数据。记录和历史不自动裁剪；超出资源限制需另行设计迁移，不静默丢弃。

本期不引入关系表事务 RPC、新存储服务或客户端整包写入。service_role 绕过 RLS，因此强制 owner 条件与在线身份检查不可省略；新表无 auth.users 外键不改变授权规则。
