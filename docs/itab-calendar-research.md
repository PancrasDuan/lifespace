# iTab 二级日历核对

核对日期：2026-10-09（Asia/Shanghai）。目标是本地复现 iTab 日历页的数据与交互，视觉沿用 LifeSpace；工具页不在范围内。

## 来源与可复现证据

- [iTab 官网](https://itab.link/)链接到[公开网页版](https://go.itab.link/)。本次从公开 HTML 的模块引用追到[日历入口](https://go.itab.link/assets/index-BCl8p3lh.js)、[日历内容](https://go.itab.link/assets/Content-CBpgU_xB.js)、[日期辅助](https://go.itab.link/assets/dateHelpers-2XVc9Xy-.js)和[公开 Tyme 模块](https://go.itab.link/assets/vendor-tyme4ts-D81ry8hI.js)。这些是部署产物；文件名会随升级变化。
- 本项目已经安装 `tyme4ts@1.5.3`，许可为 MIT，来源见[作者仓库](https://github.com/6tail/tyme4ts)、本地 `node_modules/tyme4ts/package.json` 和 `LICENSE`。iTab 的公开模块没有可确认的版本号；不能据内容相同宣称其包版本就是 1.5.3。
- [对照脚本](evidence/itab-calendar/compare-public-tyme.mjs)读取公开数据模块，注册 iTab 使用的母亲节和父亲节事件，逐日比较 2026 年 365 天。农历、干支、月相、物候、宜忌、五神位、星座、节日、节气、数九、三伏、两种周起始日及休班数据均无差异。`LegalHoliday`、`SolarFestival`、`LunarFestival`、`EventManager` 原始 `DATA`/`NAMES` 也相同。[结果与模块 SHA-256](evidence/itab-calendar/2026-comparison.json)可复查。结论限于该公开部署快照和对照范围。

## 日历页行为

源码使用同一个 `nowDate` 驱动月份、选中日期和详情。实测年份面板为四列十年网格，可按十年翻页；月份面板为四列十二个月网格，可切换面板年份。点击输入控件只展开面板，翻页或取消都不改变当前日期。明确选中另一个年份后重置到该年 1 月 1 日，明确选中另一个月份后重置到该月 1 日；跨月日期点击也修改它，因此同时切换月份和详情。前后月按钮切换至对应月的 1 日；“今”返回当前日期。月历滚轮向上前月、向下后月，源码使用 150 毫秒节流。一周开始日开关在周一和周日之间切换，并参与周数计算。年月选择器未设显式最小或最大年份。[日历内容](https://go.itab.link/assets/Content-CBpgU_xB.js)

父代理实际页面探索补充：今天保持蓝色高亮，非今天选中日期仅增加边框；非今天详情显示与今天相距天数；绿色标题按钮展开至视口，再点恢复，红色按钮关闭。工具页按用户要求排除。

## 数据映射

| 信息 | iTab 的计算口径 |
| --- | --- |
| 公历与星期 | `SolarDay.fromYmd`；`getWeek().getName()` |
| 农历文字 | 中文数字的**公历年**＋`lunar.getLunarMonth().getName()`＋`lunar.getName()` |
| 干支生肖年 | `lunar.getYearSixtyCycle()` 及其地支生肖 |
| 星座 | `solar.getConstellation().getName()`，UI 补“座”和符号 |
| 宜／忌 | `lunar.getRecommends()`／`getAvoids()`，完整顺序 |
| 月相 | `lunar.getPhase().getName()`，去末尾“月”，新→朔、满→望，UI 再补“月” |
| 物候 | `solar.getPhenology().getName()` |
| 喜神、阳贵神、阴贵神、福神、财神 | 日干 `lunar.getSixtyCycle().getHeavenStem()` 的 `getJoyDirection()`、`getYangDirection()`、`getYinDirection()`、`getMascotDirection()`、`getWealthDirection()` |
| 详情年内周数 | `solar.getSolarWeek(weekStart).getIndexInYear() + 1` |
| 年内天数 | Day.js `dayOfYear()`，1582 年改革后扣 10 天 |

以上映射来自[日历内容](https://go.itab.link/assets/Content-CBpgU_xB.js)及[日期辅助](https://go.itab.link/assets/dateHelpers-2XVc9Xy-.js)。首页摘要源码直接使用 `getIndexInYear()`，因此 2026-10-09 摘要为 40 周而详情为 41 周；这是 iTab 自身口径差异，复刻详情须保留 `+1`。

月历标签按顺序覆盖：农历日（初一显示农历月）→当日节气→公历节日→无公历节日时首个 `Event`→10 月 31 日“万圣夜”、11 月 1 日“万圣节”→农历节日。最后一项优先级最高。母亲节为 5 月第二个星期日，父亲节为 6 月第三个星期日；源码仅额外注册这两项事件。

详情节日行按顺序收集农历节日、公历节日、全部 `Event`、当日节气、数九、三伏，不去重。源码中万圣节的两个手工标签只用于月历，不自动加入详情节日行。[日历内容](https://go.itab.link/assets/Content-CBpgU_xB.js)

## 休班来源与边界

iTab [休班加载模块](https://go.itab.link/assets/getHoliday-DjKfZJ5V.js)优先读取 IndexedDB，缓存有效期 10 天，通过[请求模块](https://go.itab.link/assets/xiayigejiaqi-Cef0n_DM.js)请求 `/calendar/getHoliday?year=...`；无有效数据或请求失败时逐日读取 `LegalHoliday.fromYmd()`。本次直接请求公开 API 路径返回 HTTP 404，没有确认其在线业务响应。已确认其 Tyme 回退表与本地表相同，表包含至 2026 年的数据；不能宣称未验证的远端 API 对所有年份都与回退表相同。未知年份不生成休班安排。

`SolarYear.validate` 允许 1–9999 年，但完整黄历需要前后年份，实测 1 年、2 年部分日期和 9999-12-31 会因内部越界抛错；1582-10-05 至 14 日属于 Tyme 的历法缺日。年月控件可接受库的公历范围，但计算失败须显示明确的不可用状态，不能伪造黄历或把全部范围视为已验证。

当前可确认：参考截图的 2026-10-09 所有详情字段可由现有依赖离线生成，2026 年全部日期的公开模块数据与本地依赖对照一致。跨所有年份的完整数据一致性、未验证远端假期响应仍为未知。

## 本地实现边界

完整黄历的年份入口限定为 3–9998 年，边界月份不提供范围外日期，避免库的内部越界。1582 年月历按真实连续日期跳过 10 月 5–14 日；当库无法生成改革月后段的周次时，按年内真实天数与年初星期计算。上述极端年份处理是本地可靠性修正，不能宣称与 iTab 的报错行为完全一致。休班采用已核对相同的本地回退表，不连接未验证的在线假期 API。因此数据结果对照通过，不等于获取流程完全一致：iTab 的休班是在线接口与缓存优先，本地版是离线表。年月控件打开、翻页、取消或重选当前值均不改变日期，只有明确切换到新值才更新。

## 验证结果

- 2026 年全年 365 天公开数据模块对照：0 差异；原始节日与休班数据表相同。
- 接口测试 87 项通过；当前年月修复的日历与首页浏览器回归 13 项通过，包含离线日期选择、年月与周起始日切换、桌面／手机宽度、窗口展开、午夜同步、历法缺日和年份边界。
- 密钥扫描、安全回归、类型检查与构建通过。规范与需求双轴评审发现的宽度覆盖和历法边界问题均已修复并复核。
- 年月选择器修复后，13 项日历与首页浏览器回归、类型检查与构建通过；包含打开、翻页、取消、重复选择不改变日期，以及键盘选择与手机面板边界。
- 本地预览：`http://127.0.0.1:5174/`，分支 `codex/23-calendar`；点击首页日历卡片进入二级日历框。用户验收与 PR 合并确认尚待完成。
