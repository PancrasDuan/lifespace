import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { City } from '../shared/contracts'
import { api } from './api'

export function WeatherCityPicker({ choose }: { choose: (city: City | null) => void }) {
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false); const [active, setActive] = useState(-1)
  const id = useId(); const optionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const locations = useQuery({ queryKey: ['locations', query], queryFn: ({ signal }) => api.locations(query, signal), enabled: query.length >= 2, staleTime: 300000 })
  const cities = query === search.trim() && query.length >= 2 ? locations.data?.locations ?? [] : []
  const options: (City | null)[] = [null, ...cities]
  useEffect(() => { if (active >= 0) optionsRef.current?.children.item(active)?.scrollIntoView({ block: 'nearest' }) }, [active])
  const select = (city: City | null) => { choose(city); setSearch(''); setOpen(false); setActive(-1) }
  return <div className="city-picker weather-city-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1) } }}>
    <input className="city-search" role="combobox" aria-label="天气城市" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && active < options.length ? `${id}-${active}` : undefined} placeholder="搜索天气城市" maxLength={80} value={search} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { setSearch(event.target.value); setOpen(true); setActive(-1) }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(value => event.key === 'ArrowDown' ? Math.min(value + 1, options.length - 1) : Math.max(value - 1, 0)) }
      else if (event.key === 'Enter' && open && active >= 0 && active < options.length) { event.preventDefault(); select(options[active]) }
      else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1) }
    }} />
    {open && <div className="city-results"><div id={`${id}-options`} ref={optionsRef} role="listbox" aria-label="天气城市候选项">{options.map((city, index) => <button type="button" role="option" id={`${id}-${index}`} key={city?.id ?? 'auto'} aria-selected={active === index} aria-label={city ? `选择${city.name} ${city.region}` : '使用当前位置'} onMouseDown={event => event.preventDefault()} onClick={() => select(city)}><strong>{city?.name ?? '使用当前位置'}</strong>{city && <span>{city.region}</span>}</button>)}</div>
      <p role="status">{search.trim().length < 2 ? '输入至少两个字符搜索城市' : query !== search.trim() || locations.isPending ? '正在搜索城市…' : locations.isError ? locations.error.message : !cities.length ? '没有匹配城市，请换个名称搜索' : ''}</p></div>}
  </div>
}
