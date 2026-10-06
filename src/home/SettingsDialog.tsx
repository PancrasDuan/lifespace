import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './ui'
import type { Settings } from './settings'
import { zones } from './time'
import { api } from './api'

export function SettingsDialog({ settings, save, close }: { settings: Settings; save: (value: Settings) => void; close: () => void }) {
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const locations = useQuery({ queryKey: ['locations', query], enabled: query.length >= 2, queryFn: ({ signal }) => api.locations(query, signal), staleTime: 300000 })
  return <Modal title="首页设置" close={close}><div className="settings-content"><p>设置保存在当前浏览器。</p>
    <label className="field-label" htmlFor="city-search">天气城市</label><input id="city-search" aria-label="天气城市" className="city-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入城市名称搜索" maxLength={80} />
    <p className="selected-city">已选：{draft.city ? `${draft.city.name} · ${draft.city.region}` : '尚未选择'}</p>
    {query.length >= 2 && <div className="city-results" aria-live="polite">{locations.isPending ? <p>正在搜索城市…</p> : locations.isError ? <p>{locations.error.message}</p> : locations.data?.locations.length ? locations.data.locations.map(city => <button key={city.id} aria-label={`选择${city.name} ${city.region}`} onClick={() => { setDraft({ ...draft, city }); setSearch('') }}><strong>{city.name}</strong><span>{city.region}</span></button>) : <p>没有匹配城市，请换个名称搜索</p>}</div>}
    <div className="field-label">海外时间<span>选择你想关注的地区</span></div><div className="zone-options">{zones.map(zone => <label key={zone.id}><input type="checkbox" aria-label={zone.name} checked={draft.overseas.includes(zone.id)} onChange={event => setDraft({ ...draft, overseas: event.target.checked ? [...draft.overseas, zone.id] : draft.overseas.filter(id => id !== zone.id) })} /><span><strong>{zone.name}</strong><small>{zone.id}</small></span></label>)}</div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="primary-button" onClick={() => { try { save(draft); close() } catch { setError('浏览器未允许保存设置，请检查存储权限') } }}>保存设置</button>
  </div></Modal>
}
