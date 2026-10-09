import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { City } from '../shared/contracts'
import { api } from './api'

export function WeatherCityPicker({ choose }: { choose: (city: City) => void }) {
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false); const [active, setActive] = useState(-1)
  const id = useId(); const optionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const locations = useQuery({ queryKey: ['locations', query], queryFn: ({ signal }) => api.locations(query, signal), enabled: query.length >= 2, staleTime: 300000 })
  const cities = query === search.trim() && query.length >= 2 ? locations.data?.locations ?? [] : []
  useEffect(() => { if (active >= 0) optionsRef.current?.children.item(active)?.scrollIntoView({ block: 'nearest' }) }, [active])
  const select = (city: City) => { choose(city); setSearch(''); setOpen(false); setActive(-1) }
  return <div className="city-picker weather-city-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1) } }}>
    <input className="city-search" role="combobox" aria-label="天气城市" aria-expanded={open && search.trim().length >= 2} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && active < cities.length ? `${id}-${active}` : undefined} placeholder="搜索天气城市" maxLength={80} value={search} onFocus={() => setOpen(true)} onChange={event => { setSearch(event.target.value); setOpen(true); setActive(-1) }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(value => event.key === 'ArrowDown' ? Math.min(value + 1, cities.length - 1) : Math.max(value - 1, 0)) }
      else if (event.key === 'Enter' && open && active >= 0 && active < cities.length) { event.preventDefault(); select(cities[active]) }
      else if (event.key === 'Escape' && open && search.trim().length >= 2) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1) }
    }} />
    {open && search.trim().length >= 2 && <div className="city-results"><div id={`${id}-options`} ref={optionsRef} role="listbox" aria-label="天气城市候选项">{cities.map((city, index) => <button type="button" role="option" id={`${id}-${index}`} key={city.id} aria-selected={active === index} aria-label={`选择${city.name} ${city.region}`} onMouseDown={event => event.preventDefault()} onClick={() => select(city)}><strong>{city.name}</strong><span>{city.region}</span></button>)}</div>
      <p role="status">{query !== search.trim() || locations.isPending ? '正在搜索城市…' : locations.isError ? locations.error.message : !cities.length ? '没有匹配城市，请换个名称搜索' : ''}</p></div>}
  </div>
}
