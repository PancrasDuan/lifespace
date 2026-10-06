# DNSHE 本地安全验收

日期：2026 年 10 月 6 日。范围：公开接口、静态资源、开发服务、应用日志与 Git 凭据隔离。

## 已完成

- DNSHE 仅提供固定地址的只读查询，使用服务端凭据和请求头认证，响应只保留已确认的域名展示字段。
- 成功数据缓存 5 分钟；凭据轮换隔离旧缓存，查询参数不能强制绕过缓存。
- 缓存未命中时使用 Workers 读取限流，目标为每个边缘节点每 60 秒一次；缺少限流绑定时停止读取，超限返回 `429` 与 `Retry-After: 60`。
- 读取采用 12 秒网络超时与分页起点预算检查，最多 10 页、每页 100 条；失败不返回或缓存部分列表。
- 第三方请求不自动跟随重定向；上游原始错误及异常消息不进入公开响应或应用错误日志。
- 原始与生成的发布配置均只使用 `dist/client` 作为静态资源目录；开发服务器显式阻止 `.dev.vars`、环境文件、运行日志和 Worker 构建目录的文件访问。

## 验证

`npm run test:security` 创建隔离副本，用虚构凭据重新构建，不读取真实 `.dev.vars`，不调用真实 DNSHE 或 Supabase。副本使用本项目安装的 Vite 与 Miniflare，验证后删除。

| 检查 | 结果 |
|---|---|
| 前端所有构建文件及发布目录 | 未出现虚构凭据，静态目录为 `dist/client` |
| 本地生产运行时的公开文件路径及域名接口 | 未返回虚构凭据，两次域名访问只调用模拟上游一次 |
| 开发服务普通路径与 `/@fs` 凭据文件访问 | 未返回虚构凭据 |
| 隔离构建、开发与运行时输出 | 未出现虚构凭据 |
| Git 已跟踪文件 | 未跟踪凭据文件，未发现检查规则覆盖的常见密钥格式 |
| API 自动测试 | 27 项通过，覆盖限流、缓存、凭据轮换、重定向、异常日志、分页超时及实际 `Registered` 状态 |
| 临时目录跨平台回归 | 模拟 Linux 不存在 `/private/tmp`，完整安全检查通过；使用系统临时目录并规范化软链接路径 |
| 浏览器回归 | 14 项通过 |
| 构建及 `git diff --check` | 通过 |

最近一次机器检查结果保存于 `.cache/security-report.json`。真实读取初核结果保存于 `.cache/dnshe-live-check.json`：本地凭据权限为 `600` 且被 Git 忽略，接口返回 1 个域名，展示字段与 DNSHE 原始只读查询一致。生产发布核验结果保存于 `.cache/production-release-check.json`：线上页面、静态资源、接口与凭据文件访问隔离检查通过；响应与公开资源未检出本地配置的密钥。页面已核对名称、已注册状态及到期日期。复验命令：

```bash
npm run build
npm run test:api
npm run test:security
npm run test:security:portable
npm run test:browser
git diff --check
```

## 验收边界

已完成本地实现检查、Workers Builds 云端构建与生产站点核验。公开仓库的全历史和 GitHub 文本复核见 [公开安全复核](public-repository-audit.md)。持续密钥门禁覆盖历史及当前 Git 文件，但不能识别所有未知格式或敏感内容。

最终页返回前未再次检查总耗时，同步解析或字段处理可能跨过 12 秒预算。该 P3 边界已获用户接受，本期保留现有实现。

边缘缓存与限流按 Cloudflare 节点生效，限流具有最终一致性，不能作为严格的全球总请求配额。依据：[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

来源核对使用 DNSHE 原始 API 响应，尚未逐项核对控制台 UI。本次生产公开资源、响应及云端构建结果已核验；日后密钥或发布配置变化时重新执行对应检查。
