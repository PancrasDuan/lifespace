# LifeSpace

个人每日首页：Google 搜索、本地与海外时间、Open-Meteo 当天天气、Supabase 今日待办及本地黄历。采用已确认的浅色 A 布局，卡片与详情均为只读。

## 本地运行

使用 Node.js 22.12、24 或 26 及更新版本。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5174/`。城市与海外时区设置保存在当前浏览器；默认上海天气、纽约和伦敦时间。任务来源尚未配置时显示明确提示，其他卡片正常使用。

## 接入任务来源

项目已配置 `personal_os` 的 Supabase URL。运行以下命令，在终端隐藏输入已有服务端 secret key；也兼容 legacy service_role。

```bash
npm run setup:supabase
```

密钥保存于本地 `.dev.vars`，由 Git 忽略；重新启动开发服务器使配置生效。模板见 [.dev.vars.example](.dev.vars.example)。

今日待办筛选设备本地当天 `planned_at`、`status=todo`、`is_deleted=false`，按计划时间排序。首页最多显示三条，详情展示全部。时间字段使用 Unix 秒，接口仅执行读取。

## 验证与发布

```bash
npm run types
npm run build
npm run test:api
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/lifespace-playwright npx playwright install chromium
npm run test:browser
```

部署到当前 Cloudflare 账户，使用 Workers Static Assets 与同项目 Worker：

```bash
npx wrangler login
npm run build
npm run deploy -- --secrets-file .dev.vars
```

发布前完成真实任务读取与常用网络验收。Worker 兼容日期采用当前安装的本地运行时支持的 `2026-10-01`。

## 接口与原型

- `GET /api/tasks/today?timeZone=<IANA 时区>`：今日待办。
- `GET /api/weather/locations?q=<城市关键词>`：城市搜索。
- `GET /api/weather?latitude=<纬度>&longitude=<经度>`：城市当地当天天气。
- 天气来源：[Open-Meteo](https://open-meteo.com/)；日期与黄历使用 `tyme4ts` 本地生成。
- `npm run prototype`：在 `http://127.0.0.1:5173/prototype/home?variant=A` 查看原型。原型的示例数据与方案切换仅用于视觉比较。

本期范围与验收标准见 [本期需求](docs/requirements.md)。
