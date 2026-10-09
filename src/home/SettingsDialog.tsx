import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './ui'
import type { Settings } from './settings'
import { zones } from './time'
import { api } from './api'
import type { City } from '../shared/contracts'

export function SettingsDialog({ settings, location, save, close }: { settings: Settings; location: { source: string; pending: boolean; error: string; city: { name: string }; retry: () => void }; save: (value: Settings) => void; close: () => void }) {
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(-1)
  const [requestLocation, setRequestLocation] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded && active >= 0) optionsRef.current?.children.item(active)?.scrollIntoView({ block: 'nearest' })
  }, [active, expanded])
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const locations = useQuery({ queryKey: ['locations', query], enabled: query.length >= 2, queryFn: ({ signal }) => api.locations(query, signal), staleTime: 300000 })
  const cities = query === search.trim() && query.length >= 2 ? locations.data?.locations ?? [] : []
  const options: (City | null)[] = [null, ...cities]
  const choose = (city: City | null) => {
    setDraft({ ...draft, mode: city ? 'manual' : 'auto', city })
    setRequestLocation(!city)
    setSearch(''); setExpanded(false); setActive(-1); setError('')
  }
  return <Modal title="首页设置" close={close}><div className="settings-content"><p>设置保存在当前浏览器。地区用于时间、日历和今日待办；天气城市在天气详情中单独选择。</p>
    <p role="status">地区来源：{location.source} · {location.city.name}{location.pending ? ' · 正在定位…' : ''}{location.error ? ` · ${location.error}` : ''}</p>
    <label className="field-label" htmlFor="city-search">地区</label>
    <div className="city-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setExpanded(false); setActive(-1) } }}>
      <input id="city-search" role="combobox" aria-label="地区" aria-expanded={expanded} aria-controls="city-options" aria-autocomplete="list" aria-activedescendant={expanded && active >= 0 && active < options.length ? `city-option-${active}` : undefined} className="city-search" value={search} onFocus={() => setExpanded(true)} onClick={() => setExpanded(true)} onChange={event => { setSearch(event.target.value); setExpanded(true); setActive(-1) }} placeholder="搜索城市，或选择使用当前位置" maxLength={80} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setExpanded(true); setActive(value => event.key === 'ArrowDown' ? Math.min(value + 1, options.length - 1) : Math.max(value - 1, 0)) }
        else if (event.key === 'Enter' && expanded && active >= 0 && active < options.length) { event.preventDefault(); choose(options[active] ?? null) }
        else if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); setActive(-1) }
      }} />
      {expanded && <div className="city-results"><div ref={optionsRef} id="city-options" role="listbox" aria-label="地区候选项">{options.map((city, index) => <button type="button" role="option" id={`city-option-${index}`} key={city?.id ?? 'auto'} aria-selected={active === index} aria-label={city ? `选择${city.name} ${city.region}` : '使用当前位置'} onMouseDown={event => event.preventDefault()} onClick={() => choose(city)}><strong>{city?.name ?? '使用当前位置'}</strong><span>{city?.region ?? '自动定位；保存后重新获取位置'}</span></button>)}</div>
        {search.trim().length >= 2 && <p role="status">{query !== search.trim() || locations.isPending ? '正在搜索城市…' : locations.isError ? locations.error.message : !cities.length ? '没有匹配城市，请换个名称搜索' : ''}</p>}
      </div>}
    </div>
    <p className="selected-city">已选：{draft.mode === 'manual' && draft.city ? `${draft.city.name} · ${draft.city.region}` : '使用当前位置（自动定位）'}</p>
    <p className="location-notice">自动定位坐标保留两位小数，用于确定本地时区，不保存自动坐标。时区在本地解析，边界附近可手动选择地区。</p>
    <div className="field-label">海外时间<span>选择你想关注的地区</span></div><div className="zone-options">{zones.map(zone => <label key={zone.id}><input type="checkbox" aria-label={zone.name} checked={draft.overseas.includes(zone.id)} onChange={event => setDraft({ ...draft, overseas: event.target.checked ? [...draft.overseas, zone.id] : draft.overseas.filter(id => id !== zone.id) })} /><span><strong>{zone.name}</strong><small>{zone.id}</small></span></label>)}</div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="primary-button" onClick={() => { try { save(draft); if (requestLocation && settings.mode === 'auto') location.retry(); close() } catch { setError('浏览器未允许保存设置，请检查存储权限') } }}>保存设置</button>
  </div></Modal>
}
