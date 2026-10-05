# lifeSpace 首页原型

比较三种首页结构，验证搜索、信息卡片、只读详情及本机设置的体验。

运行：`npm run prototype`，打开 `http://localhost:5173/prototype/home?variant=A`。

| 方案 | 结构 |
|---|---|
| A 晨光玻璃 | 居中搜索，四类信息组成宽松的玻璃卡片网格 |
| B 纸页日记 | 纸页式分栏，以今日待办为主，时间与天气作为页眉摘要 |
| C 横向信息台 | 四条横向信息带，集中展示摘要并按需展开详情 |

预览截图：[A 桌面](previews/a-desktop.jpg)、[B 桌面](previews/b-desktop.jpg)、[C 桌面](previews/c-desktop.jpg)、[A 手机](previews/a-mobile.jpg)。

通过底部箭头或键盘左右键切换；输入框内的左右键保持正常输入行为。`variant` 参数可分享并在刷新后保留。

天气和任务使用示例数据；时间及黄历在浏览器生成。设置保存在 `lifespace.PROTOTYPE.settings.v1`，仅用于验证原型设置体验。

底部“原型状态”展示当前方案、设置、卡片及数据状态；可切换任务的空态和失败态。原型代码位于 `src/prototype/`，保留在 `prototype/lifespace-home` 分支。

已核对 TypeScript 与构建、三种桌面与 390px 手机布局、方案及键盘切换、Google 搜索、设置刷新保留、只读详情和空态／失败态。
