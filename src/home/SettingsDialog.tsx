import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './ui'
import type { Settings } from './settings'
import { zones } from './time'
import { api } from './api'

export function SettingsDialog({ settings, location, save, close }: { settings: Settings; location: { source: string; pending: boolean; error: string; city: { name: string }; retry: () => void }; save: (value: Settings) => void; close: () => void }) {
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const locations = useQuery({ queryKey: ['locations', query], enabled: query.length >= 2, queryFn: ({ signal }) => api.locations(query, signal), staleTime: 300000 })
  return <Modal title="首页设置" close={close}><div className="settings-content"><p>设置保存在当前浏览器。</p>
    <p role="status">地区来源：{location.source} · {location.city.name}{location.pending ? ' · 正在定位…' : ''}{location.error ? ` · ${location.error}` : ''}</p>
    <label><input type="radio" name="location-mode" checked={draft.mode === 'auto'} onChange={() => setDraft({ ...draft, mode: 'auto', city: null })} />自动定位</label>
    <label><input type="radio" name="location-mode" checked={draft.mode === 'manual'} onChange={() => setDraft({ ...draft, mode: 'manual' })} />手动地区</label>
    {settings.mode === 'auto' && <button onClick={location.retry}>重新定位</button>}
    <button onClick={() => setDraft({ ...draft, mode: 'auto', city: null })}>恢复自动定位</button>
    <p>自动定位坐标保留两位小数，经本站发送给 Open-Meteo 获取天气，不保存自动坐标。时区在本地解析，边界附近可手动选择地区。</p>
    <label className="field-label" htmlFor="city-search">天气城市</label><input id="city-search" aria-label="天气城市" className="city-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入城市名称搜索" maxLength={80} />
    <p className="selected-city">已选：{draft.city ? `${draft.city.name} · ${draft.city.region}` : '尚未选择'}</p>
    {query.length >= 2 && <div className="city-results" aria-live="polite">{locations.isPending ? <p>正在搜索城市…</p> : locations.isError ? <p>{locations.error.message}</p> : locations.data?.locations.length ? locations.data.locations.map(city => <button key={city.id} aria-label={`选择${city.name} ${city.region}`} onClick={() => { setDraft({ ...draft, mode: 'manual', city }); setSearch('') }}><strong>{city.name}</strong><span>{city.region}</span></button>) : <p>没有匹配城市，请换个名称搜索</p>}</div>}
    <div className="field-label">海外时间<span>选择你想关注的地区</span></div><div className="zone-options">{zones.map(zone => <label key={zone.id}><input type="checkbox" aria-label={zone.name} checked={draft.overseas.includes(zone.id)} onChange={event => setDraft({ ...draft, overseas: event.target.checked ? [...draft.overseas, zone.id] : draft.overseas.filter(id => id !== zone.id) })} /><span><strong>{zone.name}</strong><small>{zone.id}</small></span></label>)}</div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="primary-button" onClick={() => { try { if (draft.mode === 'manual' && !draft.city) { setError('请搜索并选择手动地区'); return } save(draft); close() } catch { setError('浏览器未允许保存设置，请检查存储权限') } }}>保存设置</button>
  </div></Modal>
}
