// 首页 UI 原型：在 /prototype/home 用 ?variant=A|B|C 比较三种结构；任务和天气为示例数据。
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SolarDay } from 'tyme4ts'
import { ArrowLeft, ArrowRight, CalendarDays, ChartNoAxesCombined, ChevronRight, Clock3, CloudRain, CloudSun, Code2, Globe2, House, ListTodo, MapPin, Moon, RotateCw, Search, Settings2, Sun, Target, Wallet, X } from 'lucide-react'

type Variant = 'A' | 'B' | 'C'
type CardKind = 'time' | 'weather' | 'tasks' | 'calendar'
type Scenario = 'normal' | 'empty' | 'error'
type Settings = { city: string; overseas: string[] }
type Task = { id: string; title: string; area: string; planned: string; due: string | null }
const STORAGE_KEY = 'lifespace.PROTOTYPE.settings.v1'
const variants = { A: '晨光玻璃', B: '纸页日记', C: '横向信息台' }
const zones = [
  { id: 'America/New_York', name: '纽约' }, { id: 'Europe/London', name: '伦敦' },
  { id: 'Asia/Tokyo', name: '东京' }, { id: 'Europe/Paris', name: '巴黎' },
  { id: 'America/Los_Angeles', name: '洛杉矶' }, { id: 'Asia/Singapore', name: '新加坡' },
  { id: 'Australia/Sydney', name: '悉尼' },
]
const sampleTasks: Task[] = [
  { id: 'DEMO-1', title: '整理本周阅读笔记', area: '学习', planned: '09:30', due: null },
  { id: 'DEMO-2', title: '为 lifeSpace 选择首页布局', area: '工作', planned: '14:00', due: '22:00' },
  { id: 'DEMO-3', title: '去户外散步二十分钟', area: '生活', planned: '18:30', due: null },
]
const sampleWeather = {
  '上海': { temp: 23, low: 19, high: 26, rain: 65, condition: '多云，有阵雨' },
  '北京': { temp: 18, low: 11, high: 22, rain: 10, condition: '晴间多云' },
  '杭州': { temp: 24, low: 20, high: 28, rain: 45, condition: '多云' },
  '深圳': { temp: 29, low: 25, high: 31, rain: 30, condition: '晴间多云' },
}
const wait = () => new Promise(resolve => setTimeout(resolve, 450))
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const clock = (date: Date, zone = localZone) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
const dayText = (date: Date, zone = localZone) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric', weekday: 'long' }).format(date)
const dateKey = (date: Date, zone = localZone) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const zoneName = (id: string) => zones.find(zone => zone.id === id)?.name ?? id
const initialVariant = (): Variant => {
  const value = new URLSearchParams(location.search).get('variant')
  return value === 'B' || value === 'C' ? value : 'A'
}
const initialSettings = (): Settings => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const value = JSON.parse(saved) as Settings
      if (value.city in sampleWeather && Array.isArray(value.overseas) && value.overseas.every(id => zones.some(zone => zone.id === id))) return value
    } catch { /* 原型配置损坏时使用示例默认值。 */ }
  }
  return { city: '上海', overseas: ['America/New_York', 'Europe/London'] }
}

function Sidebar({ onSettings }: { onSettings: () => void }) {
  return <aside className="sidebar" aria-label="主导航">
    <a className="brand-mark" href="/prototype/home" aria-label="lifeSpace 首页">l<span>s</span></a>
    <nav>
      <button className="nav-item active" aria-current="page"><House size={20} /><span>首页</span></button>
      <button className="nav-item" disabled><ListTodo size={20} /><span>任务管理</span></button>
      <button className="nav-item" disabled><Target size={20} /><span>个人目标</span></button>
      <button className="nav-item" disabled><Wallet size={20} /><span>财务</span></button>
      <button className="nav-item" disabled><ChartNoAxesCombined size={20} /><span>股票行情</span></button>
    </nav>
    <button className="nav-settings" aria-label="打开设置" onClick={onSettings}><Settings2 size={20} /><span>设置</span></button>
  </aside>
}

function SearchBox() {
  const [text, setText] = useState('')
  return <form className="search-box" role="search" action="https://www.google.com/search" method="get" target="_blank" rel="noopener noreferrer" onSubmit={event => {
    if (!text.trim()) event.preventDefault()
  }}>
    <span className="google-mark" aria-hidden="true">G</span>
    <input name="q" aria-label="Google 搜索" placeholder="搜索一下，找到你想知道的" value={text} onChange={event => setText(event.target.value)} />
    <span className="search-hint">Google</span>
    <button aria-label="搜索"><Search size={20} /></button>
  </form>
}

function Masthead({ date, onSettings, variant }: { date: Date; onSettings: () => void; variant: Variant }) {
  return <header className="masthead">
    <div className="page-kicker"><span className="live-dot" />我的每日空间<span className="demo-badge">原型 · 示例数据</span></div>
    <button className="top-settings" onClick={onSettings} aria-label="首页设置"><Settings2 size={18} /></button>
    <h1 className="wordmark">life<span>Space</span><i /></h1>
    <p className="header-date">{dayText(date)}<span>把今天放在眼前</span></p>
    <SearchBox />
    {variant === 'B' && <div className="edition-line"><span>每日一页</span><span>{dateKey(date).replaceAll('-', ' / ')}</span><span>今日 · 只读</span></div>}
  </header>
}

function Panel({ kind, title, marker, children, footer, open, refresh, loading }: { kind: CardKind; title: string; marker?: string; children: ReactNode; footer: ReactNode; open: (kind: CardKind) => void; refresh?: () => void; loading?: boolean }) {
  const icons = { time: Clock3, weather: CloudSun, tasks: ListTodo, calendar: CalendarDays }
  const Icon = icons[kind]
  return <article className={`info-panel panel-${kind}`}>
    <div className="panel-heading"><span><Icon size={17} /><h2>{title}</h2></span><span className="panel-marker">{marker}<ChevronRight size={15} /></span></div>
    <button className="panel-open" aria-label={`查看${title}详情`} onClick={() => open(kind)}>{children}</button>
    <div className="panel-footer"><span>{footer}</span>{refresh && <button onClick={refresh} aria-label={`刷新${title}`} disabled={loading}><RotateCw size={14} className={loading ? 'spinning' : ''} /></button>}</div>
  </article>
}

function TimeContent({ now, settings }: { now: Date; settings: Settings }) {
  return <div className="time-content">
    <div className="local-clock"><span className="eyebrow">本地时间</span><strong>{clock(now)}</strong><p>{dayText(now)}</p></div>
    <div className="world-clocks">{settings.overseas.length ? settings.overseas.slice(0, 2).map(id => <div className="world-clock" key={id}>
      <div><Globe2 size={14} /><span>{zoneName(id)}</span><small>{dateKey(now, id) === dateKey(now) ? '今日' : dateKey(now, id) < dateKey(now) ? '昨日' : '明日'}</small></div>
      <strong>{clock(now, id)}</strong><p>{dayText(now, id)}</p>
    </div>) : <span className="quiet">在设置中添加海外时区</span>}{settings.overseas.length > 2 && <span className="world-more">另有 {settings.overseas.length - 2} 个时区，详情查看</span>}</div>
  </div>
}

function WeatherContent({ city, weather, loading, failed }: { city: string; weather: typeof sampleWeather['上海'] | undefined; loading: boolean; failed: boolean }) {
  if (!weather) return <div className="data-message">{loading ? '正在读取示例天气…' : '天气获取失败，请刷新重试'}</div>
  return <div className="weather-content">
    <div className="location"><MapPin size={14} />{city}<span>{failed ? '上次数据' : weather.condition}</span></div>
    <div className="weather-hero"><strong>{weather.temp}<sup>°</sup></strong><div className="weather-symbol">{weather.rain > 50 ? <CloudRain size={68} strokeWidth={1.3} /> : <CloudSun size={68} strokeWidth={1.3} />}</div></div>
    <div className="weather-range"><span>最低 {weather.low}°</span><i /><span>最高 {weather.high}°</span></div>
    <div className="rain-note"><CloudRain size={15} /><span>今日降雨概率</span><strong>{weather.rain}%</strong></div>
    {failed && <p className="inline-error">更新失败 · 正在显示上次结果</p>}
  </div>
}

function TaskContent({ tasks, loading, failed }: { tasks: Task[] | undefined; loading: boolean; failed: boolean }) {
  if (!tasks) return <div className="data-message">{loading ? '正在读取示例待办…' : '待办获取失败，请刷新重试'}</div>
  if (!tasks.length) return <div className="empty-tasks"><Sun size={36} strokeWidth={1.1} /><strong>{failed ? '待办更新失败' : '今天没有待办'}</strong><span>{failed ? '上次读取时没有待办，请刷新重试' : '给自己留一点自由时间'}</span></div>
  return <div className="task-content"><div className="task-count"><strong>{tasks.length.toString().padStart(2, '0')}</strong><span>件事，慢慢做好</span></div>
    <div className="task-list">{tasks.map((task, index) => <div className="task-row" key={task.id}>
      <span className="task-number">0{index + 1}</span><div><strong>{task.title}</strong><span>{task.planned}<i />{task.area}{task.due && <small>截止 {task.due}</small>}</span></div><ChevronRight size={15} />
    </div>)}</div>{failed && <p className="inline-error">更新失败 · 正在显示上次结果</p>}
  </div>
}

function CalendarContent({ now }: { now: Date }) {
  const lunar = SolarDay.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunarDay()
  return <div className="calendar-content"><div className="calendar-day"><span>{now.getFullYear()} 年 {now.getMonth() + 1} 月</span><strong>{String(now.getDate()).padStart(2, '0')}</strong><p>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)}</p></div>
    <div className="lunar-summary"><span>{lunar.toString()}</span><div><b>宜</b><p>{lunar.getRecommends().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div><div><b>忌</b><p>{lunar.getAvoids().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div></div>
  </div>
}

type LayoutProps = { now: Date; settings: Settings; panels: Record<CardKind, ReactNode>; onSettings: () => void }
export function VariantA({ now, onSettings, panels }: LayoutProps) {
  return <div className="variant-a"><Masthead date={now} onSettings={onSettings} variant="A" /><section className="glass-grid" aria-label="每日信息">{panels.time}{panels.weather}{panels.tasks}{panels.calendar}</section><p className="page-note">生活有自己的节奏，今天也一样。</p></div>
}
export function VariantB({ now, settings, onSettings, panels }: LayoutProps) {
  return <div className="variant-b"><Masthead date={now} onSettings={onSettings} variant="B" /><div className="editorial-summary"><span><Clock3 size={15} />本地 {clock(now)}</span><span><MapPin size={15} />{settings.city} · 示例天气</span><span>把重要的事留给今天</span></div><section className="editorial-body" aria-label="每日信息"><div className="editorial-primary">{panels.tasks}{panels.time}</div><div className="editorial-secondary">{panels.calendar}{panels.weather}</div></section><p className="page-note">一页，收好今天。</p></div>
}
export function VariantC({ now, onSettings, panels }: LayoutProps) {
  return <div className="variant-c"><Masthead date={now} onSettings={onSettings} variant="C" /><section className="ribbon-stack" aria-label="每日信息">{panels.time}{panels.tasks}{panels.weather}{panels.calendar}</section><p className="page-note">信息在这里，生活在别处。</p></div>
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [close])
  return <div className="modal-backdrop" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">lifeSpace</span><h2>{title}</h2></div><button aria-label="关闭详情" onClick={close}><X size={22} /></button></header>{children}</section></div>
}

function SettingsDialog({ settings, save, close }: { settings: Settings; save: (value: Settings) => void; close: () => void }) {
  const [draft, setDraft] = useState(settings)
  return <Modal title="首页设置" close={close}><div className="settings-content"><p>设置保存在当前浏览器的原型空间中。</p><label className="field-label" htmlFor="city-setting">天气城市<span>原型提供四个示例城市</span></label><select id="city-setting" value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })}>{Object.keys(sampleWeather).map(city => <option key={city}>{city}</option>)}</select><div className="field-label">海外时间<span>选择你想关注的地区</span></div><div className="zone-options">{zones.map(zone => <label key={zone.id}><input type="checkbox" checked={draft.overseas.includes(zone.id)} onChange={event => setDraft({ ...draft, overseas: event.target.checked ? [...draft.overseas, zone.id] : draft.overseas.filter(id => id !== zone.id) })} /><span><strong>{zone.name}</strong><small>{zone.id}</small></span></label>)}</div><button className="primary-button" onClick={() => { save(draft); close() }}>保存设置</button></div></Modal>
}

export function PrototypeHome() {
  const [variant, setVariant] = useState<Variant>(initialVariant)
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [now, setNow] = useState(new Date())
  const [activeCard, setActiveCard] = useState<CardKind | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const [taskScenario, setTaskScenario] = useState<Scenario>('normal')
  const [weatherScenario, setWeatherScenario] = useState<'normal' | 'error'>('normal')
  const weatherQuery = useQuery({ queryKey: ['PROTOTYPE-weather', settings.city], staleTime: Infinity, queryFn: async () => { await wait(); if (weatherScenario === 'error') throw new Error('示例天气接口失败'); return { value: sampleWeather[settings.city as keyof typeof sampleWeather], fetchedAt: new Date().toISOString() } } })
  const taskQuery = useQuery({ queryKey: ['PROTOTYPE-tasks', dateKey(now)], staleTime: Infinity, queryFn: async () => { await wait(); if (taskScenario === 'error') throw new Error('示例任务接口失败'); return { value: taskScenario === 'empty' ? [] : sampleTasks, fetchedAt: new Date().toISOString() } } })
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { void taskQuery.refetch() }, [taskScenario])
  useEffect(() => { void weatherQuery.refetch() }, [weatherScenario])
  const switchVariant = (direction: number) => {
    const keys: Variant[] = ['A', 'B', 'C']
    const next = keys[(keys.indexOf(variant) + direction + keys.length) % keys.length]
    setVariant(next)
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState({}, '', url)
  }
  useEffect(() => {
    if (activeCard || settingsOpen || stateOpen) return
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); switchVariant(event.key === 'ArrowLeft' ? -1 : 1) }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [variant, activeCard, settingsOpen, stateOpen])
  const saveSettings = (value: Settings) => { setSettings(value); localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) }
  const weather = weatherQuery.data?.value
  const tasks = taskQuery.data?.value
  const updated = (value?: string) => value ? `更新 ${clock(new Date(value))}` : '读取中'
  const panels: Record<CardKind, ReactNode> = {
    time: <Panel kind="time" title="世界时间" marker="此刻" open={setActiveCard} footer={localZone}><TimeContent now={now} settings={settings} /></Panel>,
    weather: <Panel kind="weather" title="今日天气" marker="示例" open={setActiveCard} refresh={() => { void weatherQuery.refetch() }} loading={weatherQuery.isFetching} footer={`示例数据 · ${updated(weatherQuery.data?.fetchedAt)}`}><WeatherContent city={settings.city} weather={weather} loading={weatherQuery.isFetching} failed={weatherQuery.isError} /></Panel>,
    tasks: <Panel kind="tasks" title="今日待办" marker="示例 · 只读" open={setActiveCard} refresh={() => { void taskQuery.refetch() }} loading={taskQuery.isFetching} footer={`示例数据 · ${updated(taskQuery.data?.fetchedAt)}`}><TaskContent tasks={tasks} loading={taskQuery.isFetching} failed={taskQuery.isError} /></Panel>,
    calendar: <Panel kind="calendar" title="日期与黄历" marker="今日" open={setActiveCard} footer="tyme4ts · 本地生成"><CalendarContent now={now} /></Panel>,
  }
  const props: LayoutProps = { now, settings, panels, onSettings: () => setSettingsOpen(true) }
  const lunar = SolarDay.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunarDay()
  const state = { question: '首页结构与只读交互是否顺手？', variant: `${variant} ${variants[variant]}`, settings, localTimeZone: localZone, day: dateKey(now), activeCard, settingsOpen, taskScenario, weatherScenario, taskStatus: taskQuery.status, weatherStatus: weatherQuery.status, taskCount: tasks?.length ?? 0, taskFetching: taskQuery.isFetching, weatherFetching: weatherQuery.isFetching }
  useEffect(() => { if (import.meta.env.DEV) console.info('[lifeSpace prototype state]', state) }, [variant, settings, activeCard, settingsOpen, taskScenario, weatherScenario, taskQuery.status, weatherQuery.status])
  return <div className={`prototype-app theme-${variant.toLowerCase()}`}>
    <Sidebar onSettings={() => setSettingsOpen(true)} />
    <main>{variant === 'A' ? <VariantA {...props} /> : variant === 'B' ? <VariantB {...props} /> : <VariantC {...props} />}</main>
    {activeCard && <Modal title={{ time: '世界时间', weather: '今天天气', tasks: '今日待办', calendar: '今日黄历' }[activeCard]} close={() => setActiveCard(null)}>
      <div className="detail-content"><span className="detail-date">{dayText(now)} · 只读详情</span>
        {activeCard === 'time' && <><div className="detail-local"><span>本地 · {localZone}</span><strong>{clock(now)}</strong></div><div className="detail-zones">{settings.overseas.map(id => <div key={id}><div><strong>{zoneName(id)}</strong><small>{id}</small></div><div><strong>{clock(now, id)}</strong><small>{dayText(now, id)}</small></div></div>)}</div></>}
        {activeCard === 'weather' && <><div className="detail-weather"><span>{settings.city} · 示例数据</span><strong>{weather?.temp ?? '—'}°</strong><p>{weather?.condition ?? '正在读取'}</p></div><div className="detail-stats"><div><span>今日最低</span><strong>{weather?.low ?? '—'}°</strong></div><div><span>今日最高</span><strong>{weather?.high ?? '—'}°</strong></div><div><span>降雨概率</span><strong>{weather?.rain ?? '—'}%</strong></div></div><p className="detail-note">本期天气详情查看当天信息。</p></>}
        {activeCard === 'tasks' && <><p className="detail-note">示例待办，状态均为 todo。任务详情保持只读。</p>{tasks?.length ? <ol className="detail-task-list">{tasks.map(task => <li key={task.id}><strong>{task.title}</strong><p>计划 · 今日 {task.planned}{task.due && `　截止 · 今日 ${task.due}`}</p><span>{task.area} · 待办</span></li>)}</ol> : <p className="data-message">{taskQuery.isError ? '任务获取失败' : '今天没有待办'}</p>}</>}
        {activeCard === 'calendar' && <><div className="detail-calendar"><strong>{String(now.getDate()).padStart(2, '0')}</strong><span>{lunar.toString()}</span></div><div className="almanac-block good"><b>宜</b><p>{lunar.getRecommends().map(item => item.getName()).join(' · ') || '—'}</p></div><div className="almanac-block avoid"><b>忌</b><p>{lunar.getAvoids().map(item => item.getName()).join(' · ') || '—'}</p></div><p className="detail-note">tyme4ts · 按本地当天日期生成</p></>}
      </div>
    </Modal>}
    {settingsOpen && <SettingsDialog settings={settings} save={saveSettings} close={() => setSettingsOpen(false)} />}
    {import.meta.env.DEV && <>
      <div className="prototype-switcher" aria-label="原型方案切换"><button aria-label="上一个方案" onClick={() => switchVariant(-1)}><ArrowLeft size={17} /></button><span><small>首页 UI 原型</small><strong>{variant} <i />{variants[variant]}</strong></span><button aria-label="下一个方案" onClick={() => switchVariant(1)}><ArrowRight size={17} /></button><div className="switcher-divider" /><button className="state-toggle" aria-label="查看原型状态" onClick={() => setStateOpen(true)}><Code2 size={15} /><span>原型状态</span></button></div>
      {stateOpen && <Modal title="原型状态" close={() => setStateOpen(false)}><div className="state-content"><p>天气和任务为示例数据；时间和黄历本地生成。</p><label>任务状态<select aria-label="原型任务状态" value={taskScenario} onChange={event => setTaskScenario(event.target.value as Scenario)}><option value="normal">正常 · 三条示例待办</option><option value="empty">空态 · 没有待办</option><option value="error">失败 · 保留上次数据</option></select></label><label>天气状态<select aria-label="原型天气状态" value={weatherScenario} onChange={event => setWeatherScenario(event.target.value as 'normal' | 'error')}><option value="normal">正常</option><option value="error">失败 · 保留上次数据</option></select></label><pre>{JSON.stringify(state, null, 2)}</pre></div></Modal>}
    </>}
  </div>
}
