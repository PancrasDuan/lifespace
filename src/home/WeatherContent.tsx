import type { UseQueryResult } from '@tanstack/react-query'
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, MapPin, Snowflake, Sun } from 'lucide-react'
import type { City, WeatherResult } from '../shared/contracts'

export function weatherCondition(code: number | null) {
  if (code === 0) return { text: '晴', icon: Sun }
  if (code === 1 || code === 2) return { text: '晴间多云', icon: CloudSun }
  if (code === 3) return { text: '多云', icon: Cloud }
  if (code === 45 || code === 48) return { text: '有雾', icon: CloudFog }
  if (code !== null && code >= 95) return { text: '雷雨', icon: CloudLightning }
  if (code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return { text: '降雪', icon: Snowflake }
  if (code !== null && code >= 51 && code <= 82) return { text: '有雨', icon: CloudRain }
  return { text: '暂无天气状态', icon: CloudSun }
}
export const temperature = (value: number | null) => value === null ? '—' : String(Math.round(value))

export function WeatherContent({ query, city }: { query: UseQueryResult<WeatherResult, Error>; city: City | null }) {
  if (!city) return <div className="data-message" role="status">请在设置中选择天气城市</div>
  if (!query.data) return <div className="data-message" role="status">{query.isPending ? '正在获取当天天气…' : query.error?.message ?? '天气获取失败'}</div>
  const data = query.data; const condition = weatherCondition(data.weatherCode); const Icon = condition.icon
  return <div className="weather-content"><div className="location"><MapPin size={14} />{city.name}<span>{condition.text}</span></div>
    <div className="weather-hero"><strong>{temperature(data.temperature)}<sup>°</sup></strong><div className="weather-symbol"><Icon size={68} strokeWidth={1.3} /></div></div>
    <div className="weather-range"><span>最低 {temperature(data.temperatureMin)}°</span><i /><span>最高 {temperature(data.temperatureMax)}°</span></div>
    <div className="rain-note"><CloudRain size={15} /><span>今日降雨概率</span><strong>{data.precipitationProbability === null ? '暂无数据' : `${data.precipitationProbability}%`}</strong></div>
    {query.isError && <p className="inline-error">更新失败 · 正在显示上次结果</p>}
  </div>
}
