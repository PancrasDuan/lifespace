---
name: "Token 正式界面"
description: "仅适用于正式 Token 路由；继承已确认 LifeSpace 绿色世界与共享源码。"
colors:
  page: "#f2f6ef"
  surface: "#ffffff"
  ink: "#263f34"
  muted: "#65766b"
  line: "#e3e9df"
  nav: "#ebf3e7"
  nav-text: "#65766b"
  accent: "#365d45"
  comparison: "#7a8971"
  accent-light: "#e7efe1"
  copper: "#a77543"
  positive: "#377553"
  warning: "#8d651c"
  model-teal: "#4b817a"
  model-sand: "#a87943"
  model-unknown: "#84917b"
  heat-0: "#edf2e8"
  heat-1: "#d9e6c9"
  heat-2: "#b5cf9b"
  heat-3: "#84a867"
  heat-4: "#527a4f"
  rail-surface: "#ebf3e7d4"
  filter-surface: "#ffffffd9"
  metric-surface: "#ffffffed"
  tooltip-surface: "#304d39"
  tooltip-ink: "#f9fcf6"
typography:
  headline: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "30px", "fontWeight": 600, "lineHeight": 1.25, "letterSpacing": "-.025em"}
  title: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "15px", "fontWeight": 620, "lineHeight": 1.5, "letterSpacing": "-.01em"}
  body: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "14px"}
  label: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "11px"}
  metric: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "29px", "fontWeight": 550, "lineHeight": 1.45, "letterSpacing": "-.035em"}
  metric-total: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "40px", "fontWeight": 550, "lineHeight": 1.05, "letterSpacing": "-.035em"}
  metric-pair: {"fontFamily": "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", "fontSize": "22px", "fontWeight": 550, "lineHeight": 1.45, "letterSpacing": "-.025em"}
rounded:
  panel: "14px"
  control: "7px"
  segment: "5px"
  heat-cell: "3px"
  model-marker: "2px"
  button: "8px"
  app-nav: "12px"
  tooltip: "10px"
spacing:
  control-gap: "8px"
  filter-gap: "12px"
  panel-gap: "20px"
  panel-block: "22px"
  panel-inline: "23px"
  calendar-gap: "3px"
components:
  daily-disclosure: {"backgroundColor": "transparent", "textColor": "{colors.ink}", "rounded": "{rounded.panel}", "padding": "20px 23px"}
  calendar-tooltip: {"backgroundColor": "{colors.tooltip-surface}", "textColor": "{colors.tooltip-ink}", "rounded": "{rounded.tooltip}", "padding": "14px 16px"}
  button-secondary: {"backgroundColor": "{colors.surface}", "textColor": "#3d5845", "rounded": "{rounded.button}", "padding": "9px 15px"}
  button-reset: {"backgroundColor": "transparent", "textColor": "#52694d", "padding": "7px 4px"}
  button-text: {"backgroundColor": "transparent", "textColor": "{colors.accent}", "padding": "8px 0"}
  filter-select: {"backgroundColor": "{colors.surface}", "textColor": "{colors.muted}", "rounded": "{rounded.control}", "padding": "8px 26px 8px 11px"}
  panel-standard: {"backgroundColor": "{colors.surface}", "rounded": "{rounded.panel}", "padding": "22px 23px"}
  segmented-button: {"backgroundColor": "transparent", "textColor": "#52694d", "rounded": "{rounded.segment}", "padding": "5px 11px"}
  heat-cell: {"backgroundColor": "{colors.heat-0}", "rounded": "{rounded.heat-cell}", "width": "13px", "height": "13px"}
  heat-legend-marker: {"backgroundColor": "{colors.heat-0}", "rounded": "{rounded.model-marker}", "width": "10px", "height": "10px"}
---

# Design System: Token 正式界面

## Overview

继承用户已确认的 LifeSpace 绿色世界。本文件仅规范正式 Token 路由，依据原型最终 copy-refinement 与本分支 React/CSS，不推广为全站重新设计。原型源目录保持只读，方向契约见 `.impeccable/surfaces/src-token-tokendashboard-tsx.md`。

## Colors

森林绿用于文字、日柱和选中控件；灰绿用于次要信息；暖棕用于选中日柱与日期指针；模型依次使用森林绿、青绿、暖棕与灰绿；日历使用既定五阶强度。薄荷／奶油渐变浅底上放白色细边框面板。

**The Semantic Series Rule.** 日柱总量、日期选择和模型构成色各有含义，不能因指标切换混淆。

## Typography

沿用 DM Sans 前置的系统 fallback 栈，不请求网络字体。基础字号14px，页标题30px/600，手机24px；面板标题15px/620，手机14px；辅助文字11px。数字使用 tabular-nums，总量40px、普通指标29px、输入/输出22px，断点按正式 CSS 收敛。

**The Numerical Alignment Rule.** 完整计数与精确金额仍可查看；缩写仅是显示格式，未知和未报告不替换成0。

## Layout

共享 AppLayout/AppNavigation 提供76px桌面和54px手机栏，原L标识与真实账户菜单。主内容最大1360px含内边距，桌面31px 40px 32px；≤1200px水平28px；≤720px为24px 16px。趋势/模型2.35:1，≤1200px为2:1，≤980px单列；手机筛选及指标两列，底部设备/明细单列。日历和表格独立滚动，不隐藏全局溢出。

## Elevation & Depth

**The Flat Panel Rule.** 面板使用白底、细线和间距分层。选中分段有轻微阴影，日期提示使用深绿底与柔和投影；共享侧栏沿用透明浅绿和模糊。过渡160ms，reduced-motion关闭过渡。

## Shapes

面板14px、按钮8px、select7px、分段按钮5px、热图单元3px、日期提示10px。表单使用原生控件，不添加装饰性素材。

## Components

- 趋势图（#241）：仅 Token / 费用两项，单日主汇总实心柱、暖棕选中日；移除趋势常驻图例和上一周期折线，保留指标带周期对比。日期悬停、轻触或键盘查看时，显示对齐该日的深绿浮动明细提示，模型在所有视口逐行纵向排列，不占布局空间、不改变趋势卡片高度，优先避开柱与轴；仅显示当日所选指标的前五个模型和剩余已报告模型「其他」。
- 日期提示：hover/focus/tap打开，支持hint Popover、auto及manual fixed回退；可移入阅读，Escape/外部激活关闭，完整日期名预先存在，不抢焦点或重复live播报。
- 明细：h2内button配近旁箭头，aria-expanded、hidden=until-found和beforematch同步；不支持beforematch时初始展开。表内显示真实摘要，完整分页读取状态明确。
- 模型：行内箭头、hover、选中勾选和恢复入口。未知费用仍保留Token统计。
- 设备：真实账户、接收时间、平台、周期、正常/逾期/停用；内联确认停用，重绑勾选旧凭据失效与历史保留。
- 状态：加载、无记录、错误、重试、权限和结果未知均可用；不制造演示值或假成功。

## Do's and Don'ts

- Do 保留已确认布局、必要时区与费用含义；精确值不反写为显示舍入值。
- Do 区分同样本模拟视觉、真实本地链路、真实设备和生产验收。
- Don't 添加导出、页内分区导航、3D、常驻日历详情、每日预览或重复教学文案。
- Don't 将部分/未知估算称为完整实际账单。
