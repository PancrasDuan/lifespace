# 天气接口使用情况核对

核对日期：2026-10-27（Asia/Shanghai）；代码基准：`main`，提交 `8a80f3f650787a3c161991fbe265235b396eac8e`。本次为飞书文档、仓库源码与 Git 历史的静态核对，没有查询生产访问日志。

后续处理：用户确认只有本项目使用并同意下线；[Issue #77](https://github.com/PancrasDuan/lifespace/issues/77) 跟踪移除工作。以下为下线前的调查快照。

## 结论

此前的发现属实：当前仓库前端没有调用 `GET /api/weather`。它仍有前端请求封装、服务端路由、实现及接口测试，不能据此推断线上没有调用，也不能排除仓库之外的客户端在使用。

[飞书接口索引](https://my.feishu.cn/wiki/LJtWwLAkPiJNRdkKbxbc5BQynGg)中该接口整行带删除线；[接口详情](https://my.feishu.cn/wiki/GTOWwVk5mif6X7keJrfcuxYRnbe)明确写着每日首页当前调用 `/api/weather/detail`。这是文档的标记和描述，删除线本身不能证明服务端路由已被移除。

## 代码证据

- 前端在 [`api.weather`](../src/home/api.ts#L39) 中仍定义摘要请求；搜索仓库源码未发现该方法的调用。[`Home`](../src/home/Home.tsx#L41)调用 `api.weatherDetail`，并将同一个 `weatherQuery` 分别传给首页天气卡片和二级详情。详情响应的 schema [包含摘要 schema](../src/shared/weather-contracts.ts#L6)，因此该查询也提供首页所需的摘要字段。
- 服务端仍在[鉴权中间件](../worker/index.ts#L46)之后[注册原路由](../worker/index.ts#L63)，[`readWeather`](../worker/weather.ts#L29)会请求 Open-Meteo 的一天预报。[接口测试](../tests/api/weather.test.ts#L6)直接请求此路由；测试调用不代表产品前端或生产流量调用。
- [提交 `18e732e`](https://github.com/PancrasDuan/lifespace/commit/18e732e6f3e2a1c7e8d764d918858e4749dd3189)（天气二级卡片与独立天气城市，#28）将首页查询从 `api.weather` 改为 `api.weatherDetail`。当前[需求文档](requirements.md#L48)也要求摘要与预报共用同一查询快照。
- 其他天气接口有前端调用：`/api/weather/detail` 用于首页共享查询；`/api/weather/air-quality` 由[天气详情](../src/home/WeatherDetail.tsx#L45)独立查询；`/api/weather/locations` 由[天气城市选择器](../src/home/WeatherCityPicker.tsx#L11)和[首页设置](../src/home/SettingsDialog.tsx#L22)使用。对应请求封装见 [api.ts](../src/home/api.ts#L40)。

## 处理建议与边界

如果目标是清理不再使用的代码，可以先移除前端未调用的 `api.weather` 封装。服务端接口是否下线还需要确认外部消费者和生产流量，以及兼容性要求；在此之前保留路由更稳妥。若未来决定下线，应同步调整服务端实现、接口测试、[README](../README.md#L113)和飞书接口文档。此次只调查并记录，没有修改业务代码，也没有运行测试。
