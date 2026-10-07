import { useCallback, useEffect, useRef, useState } from 'react'
import tzlookup from '@photostructure/tz-lookup'
import type { City } from '../shared/contracts'
import { beijing, type Settings } from './settings'
import { validZone } from './time'

type LocationState = { generation: number; city: City; source: '自动定位' | '默认北京'; pending: boolean; error: string }
const fallback: LocationState = { generation: 0, city: beijing, source: '默认北京', pending: false, error: '' }

export function useLocation(settings: Settings) {
  const [state, setState] = useState<LocationState>(fallback)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current += 1 }, [])
  const retry = () => { invalidate(); setAttempt(value => value + 1) }
  useEffect(() => {
    const id = ++generation.current
    if (settings.mode === 'manual') return
    const deadline = Date.now() + 8000
    let settled = false
    const current = () => !settled && generation.current === id
    const fail = (error: string) => {
      if (!current()) return
      settled = true
      clearTimeout(timer)
      setState({ ...fallback, generation: id, error })
    }
    const timer = setTimeout(() => fail('定位超时，已使用北京'), 8000)
    const checkDeadline = () => { if (current() && Date.now() >= deadline) fail('定位超时，已使用北京') }
    document.addEventListener('visibilitychange', checkDeadline)
    window.addEventListener('focus', checkDeadline)
    setState({ ...fallback, generation: id, pending: true })
    try {
      if (!navigator.geolocation) fail('浏览器不支持定位，已使用北京')
      else navigator.geolocation.getCurrentPosition(position => {
        if (!current()) return
        checkDeadline()
        if (!current()) return
        try {
          const rawLat = position.coords.latitude; const rawLon = position.coords.longitude
          if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon) || Math.abs(rawLat) > 90 || Math.abs(rawLon) > 180) throw new Error('invalid coordinates')
          const latitude = Number(rawLat.toFixed(2)); const longitude = Number(rawLon.toFixed(2))
          const timeZone = tzlookup(latitude, longitude)
          if (!validZone(timeZone)) throw new Error('invalid time zone')
          checkDeadline()
          if (!current()) return
          settled = true
          clearTimeout(timer)
          setState({ generation: id, city: { id: 'current', name: '当前位置', region: '自动定位', latitude, longitude, timeZone }, source: '自动定位', pending: false, error: '' })
        } catch { fail('无法确定位置时区，已使用北京') }
      }, error => {
        checkDeadline()
        fail(error.code === 1 ? '定位授权被拒绝，已使用北京' : error.code === 3 ? '定位超时，已使用北京' : '定位不可用，已使用北京')
      }, { timeout: 8000, maximumAge: 0, enableHighAccuracy: false })
    } catch { fail('定位不可用，已使用北京') }
    return () => {
      settled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkDeadline)
      window.removeEventListener('focus', checkDeadline)
      if (generation.current === id) invalidate()
    }
  }, [settings.mode, attempt, invalidate])
  const active = state.generation === generation.current ? state : { ...fallback, pending: true }
  return settings.mode === 'manual' && settings.city
    ? { city: settings.city, source: '手动选择' as const, pending: false, error: '', retry, invalidate }
    : { ...active, retry, invalidate }
}
