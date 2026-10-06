# DNSHE 发布验收

日期：2026 年 10 月 6 日。站点：[LifeSpace](https://lifespace.onepeace.cc.cd/)。功能验收代码基准：`99d141f`。

## 自动发布

Workers Builds 已连接 `PancrasDuan/lifespace` 的 `main` 分支。构建命令为 `npm run build:ci`，部署命令为 `npm run deploy`，根目录为 `/`，Node.js 固定为 `24.18.0`。非生产分支预览关闭。

`main` 推送已自动触发构建，接口测试 27 项、跨平台安全回归及构建、部署全部通过。部署使用构建系统保存的 token；三项业务密钥保存在 Worker 加密 secrets 中。

## 线上结果

| 检查 | 结果 |
|---|---|
| 页面与静态资源 | 正常加载，公开内容未检出配置的密钥 |
| DNSHE | `onepeace.cc.cd`，已注册，到期日期 `2027-08-31` |
| 登录入口 | 卡片与详情指向 `https://my.dnshe.com/clientarea.php`，新标签页打开 |
| 缓存 | 重复读取复用成功结果，来源更新时间保持一致 |
| 今日待办 | 原有 Supabase 来源正常，验收时共 6 项 |
| 天气 | Open-Meteo 来源正常 |
| 凭据文件路径 | `.dev.vars`、`.env`、Worker 构建凭据与 `.git/config` 访问未返回密钥 |

机器结果保存在 `.cache/production-release-check.json`，截图保存在 `.cache/dnshe-production.jpg`。

## 验收边界

仅验证当前网络和本次配置，未逐项核对 DNSHE 控制台 UI。P3 最终页耗时边界按用户决定保留，详见 [安全验收](security-audit.md)。
