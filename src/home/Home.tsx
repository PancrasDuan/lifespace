import { AiStatusContent, AiStatusDetail, aiStatusDescription, useAiStatus } from './AiStatusContent'
import { useEffect, useState } from 'react'
import { useLocation } from './useLocation'
import { Search, Settings2 } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { loadSettings, persistSettings, type Settings } from './settings'
import { Panel, Modal, type CardKind } from './ui'
import { TimeContent, TimeDetail } from './TimeContent'
import { SettingsDialog } from './SettingsDialog'
import { CalendarContent, CalendarDetail } from './CalendarContent'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { dateKey, clock } from './time'
import { TaskContent, TaskDetail } from './TaskContent'
import { WeatherContent } from './WeatherContent'
import { WeatherDetail } from './WeatherDetail'
import { loadWeatherSettings, saveWeatherSettings } from './weather-city'
import { DomainContent, DomainDetail, DNSHELoginLink } from './DomainContent'

export function Home() {
  const [settings, setSettings] = useState(loadSettings)
  const [weatherSettings, setWeatherSettings] = useState(loadWeatherSettings)
  const [weatherCityError, setWeatherCityError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [activeCard, setActiveCard] = useState<CardKind | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const aiStatus = useAiStatus()
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const location = useLocation(settings)
  const weatherLocation = useLocation({ ...weatherSettings, overseas: [] })
  const weatherCity = weatherLocation.city
  const localZone = location.city.timeZone
  const taskQuery = useQuery({ queryKey: ['tasks', localZone, dateKey(now, localZone)], queryFn: ({ signal }) => api.todayTasks(localZone, signal) })
  const domainQuery = useQuery({ queryKey: ['domains'], queryFn: ({ signal }) => api.domains(signal), staleTime: 300000, refetchOnWindowFocus: false })
  const city = location.city
  const weatherQuery = useQuery({ queryKey: ['weather', weatherCity.latitude, weatherCity.longitude, weatherCity.timeZone, dateKey(now, weatherCity.timeZone)],
    queryFn: ({ signal }) => api.weatherDetail(weatherCity, signal), staleTime: 300000 })
  const updated = (value?: string) => value ? `更新 ${clock(new Date(value), deviceZone)}` : '尚未获取'
  const save = (value: Settings) => { persistSettings(value); if (value.mode !== settings.mode) location.invalidate(); setSettings(value) }
  return <AppLayout page="home" openSettings={() => setSettingsOpen(true)}><div className="home-page"><header className="masthead">
    <div className="page-kicker"><span className="live-dot" />我的每日空间</div><button className="top-settings" aria-label="首页设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button>
    <h1 className="wordmark">Life<span>Space</span><i /></h1><p className="header-date">把今天放在眼前</p>
    <form className="search-box" role="search" action="https://www.google.com/search" method="get" target="_blank" rel="noopener noreferrer" onSubmit={event => { if (!search.trim()) event.preventDefault() }}><span className="google-mark" aria-hidden="true">G</span><input name="q" aria-label="Google 搜索" placeholder="搜索一下，找到你想知道的" value={search} onChange={event => setSearch(event.target.value)} /><span className="search-hint">Google</span><button aria-label="搜索"><Search size={20} /></button></form>
  </header><section className="glass-grid" aria-label="每日信息"><Panel kind="time" open={() => setActiveCard('time')}><TimeContent now={now} localZone={localZone} localName={city.name} overseas={settings.overseas} /></Panel>
  <Panel kind="weather" open={() => setActiveCard('weather')} footer={<><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · {updated(weatherQuery.data?.fetchedAt)}</>} refresh={() => { void weatherQuery.refetch() }} loading={weatherQuery.isFetching}><WeatherContent query={weatherQuery} city={weatherCity} locationStatus={weatherLocation.pending ? '正在定位，暂时显示北京天气' : weatherLocation.error} /></Panel>
  <Panel kind="tasks" open={() => setActiveCard('tasks')} footer={`Supabase · ${updated(taskQuery.data?.fetchedAt)}`} refresh={() => { void taskQuery.refetch() }} loading={taskQuery.isFetching}><TaskContent query={taskQuery} localZone={localZone} /></Panel>
  <Panel kind="calendar" open={() => setActiveCard('calendar')} footer="tyme4ts · 本地生成"><CalendarContent now={now} timeZone={localZone} /></Panel>
  <Panel kind="domains" open={() => setActiveCard('domains')} footer={<><DNSHELoginLink /> · {updated(domainQuery.data?.fetchedAt)}</>} refresh={() => { void domainQuery.refetch() }} loading={domainQuery.isFetching}><DomainContent query={domainQuery} now={now} localZone={deviceZone} /></Panel><Panel kind="ai" open={() => setActiveCard('ai')} footer={aiStatus.query.data ? `检查 ${clock(new Date(aiStatus.query.data.checkedAt), deviceZone)}` : '尚未获取'} refresh={() => { void aiStatus.query.refetch() }} loading={aiStatus.query.isFetching}><AiStatusContent view={aiStatus} /></Panel></section><p className="page-note">生活有自己的节奏，今天也一样。</p></div>
    {activeCard === 'ai' && <Modal title="AI 服务状态" description={aiStatusDescription} close={() => setActiveCard(null)}><div className="detail-content"><AiStatusDetail view={aiStatus} /></div></Modal>}
    {activeCard === 'time' && <Modal title="世界时间" close={() => setActiveCard(null)}><div className="detail-content"><TimeDetail now={now} localZone={localZone} localName={city.name} overseas={settings.overseas} /></div></Modal>}
    {activeCard === 'calendar' && <Modal title="日历" className="calendar-modal" expandable close={() => setActiveCard(null)}><CalendarDetail now={now} timeZone={localZone} /></Modal>}
    {activeCard === 'tasks' && <Modal title="今日待办" close={() => setActiveCard(null)}><div className="detail-content"><TaskDetail query={taskQuery} localZone={localZone} /></div></Modal>}
    {activeCard === 'weather' && <Modal title="天气" className="weather-modal" close={() => setActiveCard(null)}><WeatherDetail query={weatherQuery} city={weatherCity} now={now} cityError={weatherCityError} location={weatherLocation} chooseCity={value => { try { const next = saveWeatherSettings(value); if (next.mode !== weatherSettings.mode) weatherLocation.invalidate(); setWeatherSettings(next); if (!value && weatherSettings.mode === 'auto') weatherLocation.retry(); setWeatherCityError('') } catch { setWeatherCityError('浏览器未允许保存天气城市，请检查存储权限') } }} /></Modal>}
    {activeCard === 'domains' && <Modal title="DNSHE 域名" close={() => setActiveCard(null)}><div className="detail-content"><DomainDetail query={domainQuery} now={now} localZone={deviceZone} /></div></Modal>}
    {settingsOpen && <SettingsDialog settings={settings} location={location} save={save} close={() => setSettingsOpen(false)} />}
  </AppLayout>
}
