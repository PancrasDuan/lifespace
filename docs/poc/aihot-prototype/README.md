# AIHOT 新闻来源原型

用于查看沿用现有卡片接入 AIHOT 后的页面效果，新闻标题均为示例。

启动：

```sh
python3 -m http.server 8793 --bind 127.0.0.1 --directory docs/poc/aihot-prototype
```

打开 `http://127.0.0.1:8793/?variant=enabled` 查看开启后的六张卡片；切换为 `variant=disabled` 查看默认关闭状态。来源设置中的开关即时控制原型展示，仅保留内存状态。示例标题链接统一打开 AIHOT 热点页；正式接入时使用每条事件的详情链接。

原型沿用当前布局，AIHOT 使用官网 https://aihot.news/icon.png 来源图标。验证后通过正式实现交付。
