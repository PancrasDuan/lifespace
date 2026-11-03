import { useState } from 'react'
import { Modal } from './ui'
import type { Settings } from './settings'
import { zones } from './time'
import { CityPicker } from './CityPicker'
import type { City } from '../shared/contracts'

export function SettingsDialog({ settings, location, save, close }: { settings: Settings; location: { source: string; pending: boolean; error: string; city: { name: string }; retry: () => void }; save: (value: Settings) => void; close: () => void }) {
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const [requestLocation, setRequestLocation] = useState(false)
  const choose = (city: City | null) => {
    setDraft({ ...draft, mode: city ? 'manual' : 'auto', city })
    setRequestLocation(!city)
    setError('')
  }
  return <Modal title="首页设置" close={close}><div className="settings-content">
    <p role="status">地区来源：{location.source} · {location.city.name}{location.pending ? ' · 正在定位…' : ''}{location.error ? ` · ${location.error}` : ''}</p>
    <CityPicker variant="region" choose={choose} />
    <p className="selected-city">已选：{draft.mode === 'manual' && draft.city ? `${draft.city.name} · ${draft.city.region}` : '使用当前位置（自动定位）'}</p>
    <div className="field-label">海外时间<span>选择你想关注的地区</span></div><div className="zone-options">{zones.map(zone => <label key={zone.id}><input type="checkbox" aria-label={zone.name} checked={draft.overseas.includes(zone.id)} onChange={event => setDraft({ ...draft, overseas: event.target.checked ? [...draft.overseas, zone.id] : draft.overseas.filter(id => id !== zone.id) })} /><span><strong>{zone.name}</strong><small>{zone.id}</small></span></label>)}</div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="primary-button" onClick={() => { try { save(draft); if (requestLocation && settings.mode === 'auto') location.retry(); close() } catch { setError('浏览器未允许保存设置，请检查存储权限') } }}>保存设置</button>
  </div></Modal>
}
