export type NewsSource = { id: string; label: string; defaultEnabled: boolean; order: number }

const entries = [
  ['baidu', '百度热搜'], ['cls-hot', '财联社热门'], ['tencent-hot', '腾讯新闻综合早报'],
  ['toutiao', '今日头条'], ['zhihu', '知乎'],
  ['bilibili-hot-search', '哔哩哔哩热搜'], ['chongbuluo-hot', '虫部落最热'],
  ['coolapk', '酷安今日最热'], ['douban', '豆瓣热门电影'], ['douyin', '抖音'],
  ['freebuf', 'Freebuf 网络安全'], ['github-trending-today', 'GitHub Today'],
  ['hackernews', 'Hacker News'], ['hupu', '虎扑主干道热帖'], ['ifeng', '凤凰网热点资讯'],
  ['iqiyi-hot-ranklist', '爱奇艺热播榜'], ['juejin', '稀土掘金'], ['nowcoder', '牛客'],
  ['producthunt', 'Product Hunt'], ['qqvideo-tv-hotsearch', '腾讯视频热搜榜'],
  ['sspai', '少数派'], ['steam', 'Steam 在线人数'], ['thepaper', '澎湃新闻热榜'],
  ['tieba', '百度贴吧热议'], ['wallstreetcn-hot', '华尔街见闻最热'],
  ['weibo', '微博实时热搜'], ['xueqiu-hotstock', '雪球热门股票'],
  ['aihot', 'AIHOT 热点榜'],
] as const

export const newsSources: readonly NewsSource[] = entries.map(([id, label], index) => ({
  id, label, defaultEnabled: index < 5, order: index + 1,
}))
