# 阶段04截图索引

基准来自父工作区最终 `copy-refinement`：`reference/desktop.png`（1440px）与 `reference/mobile.png`（390px）。两者原样复制，原工作区及5193服务保持不变。正式页面使用同一套测试样本和北京时间2026-11-15，总量51,938,778；fixture只在tests，正常运行查询真实API。

当前正式页面：`desktop.png`（1440×1000 viewport）、`width-1024.png`（1024×1000）、`width-768.png`（768×1000）、`mobile.png`（390×844）、`width-320.png`（320×844），均返回文档顶部后采集完整页；PNG高度是文档高度，不冒称viewport高度。

交互画面使用真实viewport：`daily-expanded.png`（1440×1000）、`calendar-hint.png`（952×1000）、`touch-calendar.png`（390×520，hasTouch=true）、`device-disable.png`（320×844，停用后果及确认/取消）、`device-rebind.png`（320×844，重绑勾选后批准可用）。`device-confirmation.png` 为952×954的勾选前正式确认页。

`real-chain.png` 为1440×1000的真实本地PG/PostgREST/TLS/Worker/SQLite/Tokscale/React DOM链路viewport，`real-chain-full.png` 为显式回到顶部后的完整页。同范围实际查询到780 Token，浏览器批准/停用与终端领取/上传、历史保留分别由真实测试断言。它不代表托管网关或用户真实双设备。

每张正式截图的同名 `.png.json` 记录viewport、fullPage、scrollY、触屏/指针、焦点元素与源码SHA-256；最后提交对应的固定SHA、独立评审和CI写在阶段报告与PR。旧提交的截图／评审不覆盖新提交。没有第二轮detector；首轮25项均为继承原型样式的文档注册advisory，由独立视觉reviewer核对。

已批准的正式差异：去掉演示标记、真实账户菜单与共享图标、必要的设备码/停用动作、真实费用覆盖标签；320px按实际宽度使用三日期刻度、设备状态/动作另起一行。保持原有世界、信息顺序和字号。
