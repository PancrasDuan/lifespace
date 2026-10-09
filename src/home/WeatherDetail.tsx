import { useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { CalendarDays, Clock3, Droplets, Leaf, MapPin, Moon, CloudMoon, RotateCw, Sunrise, Sunset, Wind } from 'lucide-react'
import type { City } from '../shared/contracts'
import type { WeatherDetailResult } from '../shared/weather-contracts'
import { dateKey } from './time'
import { api } from './api'
import { weatherCondition, temperature } from './WeatherContent'
import { WeatherCityPicker } from './WeatherCityPicker'
import './weather.css'

const metric = (value: number | null, unit: string) => value === null ? '暂无数据' : `${Math.round(value * 10) / 10}${unit}`
const localTime = (value: number | null, zone: string) => value === null ? '暂无数据' : new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value * 1000))
function aqiLabel(value: number | null) {
  if (value === null) return '暂无指数'
  if (value <= 50) return '优'
  if (value <= 100) return '中等'
  if (value <= 150) return '对敏感人群不健康'
  if (value <= 200) return '不健康'
  if (value <= 300) return '非常不健康'
  return '危险'
}
function WeatherIcon({ code, isDay, size = 28 }: { code: number | null; isDay?: number | null; size?: number }) {
  const Icon = isDay === 0 && code === 0 ? Moon : isDay === 0 && (code === 1 || code === 2) ? CloudMoon : weatherCondition(code).icon
  return <Icon size={size} strokeWidth={1.4} aria-hidden="true" />
}
function HourlyForecast({ data }: { data: WeatherDetailResult }) {
  const hours = data.hourly
  if (!hours.length) return <p className="weather-empty">暂无逐小时预报</p>
  const values = hours.flatMap(hour => hour.temperature === null ? [] : [hour.temperature])
  const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0
  const points = hours.map((hour, index) => hour.temperature === null ? null : { x: index * 82 + 41, y: 80 - (hour.temperature - min) / Math.max(max - min, 1) * 44 })
  return <div className="forecast-scroll" tabIndex={0} role="region" aria-label="未来24小时预报，可横向滚动"><div className="hourly-track" style={{ width: hours.length * 82 }}>
    <div className="hourly-labels">{hours.map(hour => <div key={hour.time}><span>{new Intl.DateTimeFormat('zh-CN', { timeZone: data.timeZone, month: '2-digit', day: '2-digit' }).format(new Date(hour.time * 1000))}</span><strong>{localTime(hour.time, data.timeZone)}</strong><WeatherIcon code={hour.weatherCode} isDay={hour.isDay} /><small>{weatherCondition(hour.weatherCode).text}</small></div>)}</div>
    <svg width={hours.length * 82} height="110" className="weather-chart" aria-hidden="true">{points.map((point, index) => {
      const next = points[index + 1]
      return point ? <g key={hours[index].time}>{next && <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} />}<circle cx={point.x} cy={point.y} r="3.5" /><text x={point.x} y={point.y - 13} textAnchor="middle">{temperature(hours[index].temperature)}°</text></g> : <text key={hours[index].time} x={index * 82 + 41} y="60" textAnchor="middle">—</text>
    })}</svg>
    <div className="hourly-rain">{hours.map(hour => <span key={hour.time}><span className="sr-only">{localTime(hour.time, data.timeZone)} 温度 {temperature(hour.temperature)}°，降雨概率 </span><Droplets size={12} aria-hidden="true" />{metric(hour.precipitationProbability, '%')}</span>)}</div>
  </div></div>
}
export function WeatherDetail({ query, city, now, chooseCity, cityError }: { query: UseQueryResult<WeatherDetailResult, Error>; city: City; now: Date; chooseCity: (city: City) => void; cityError: string }) {
  const data = query.data
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const air = useQuery({ queryKey: ['air-quality', city.latitude, city.longitude, city.timeZone, dateKey(now, city.timeZone)], queryFn: ({ signal }) => api.airQuality(city, signal), staleTime: 300000 })
  const selected = data?.daily.find(day => day.date === selectedDate) ?? data?.daily[0]
  const direction = data?.windDirection === null || data?.windDirection === undefined ? '' : ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(data.windDirection / 45) % 8]
  const refresh = () => { void query.refetch(); void air.refetch() }
  return <div className="weather-detail">
    <div className="weather-toolbar"><div className="weather-place"><MapPin size={16} /><strong>{city.name}</strong><span>{city.region}</span></div><div className="weather-tools"><WeatherCityPicker choose={chooseCity} /><button className="weather-refresh" aria-label="刷新天气详情" disabled={query.isFetching || air.isFetching} onClick={refresh}><RotateCw size={16} className={query.isFetching || air.isFetching ? 'spinning' : ''} /></button></div></div>
    <p className="weather-city-note">天气城市独立保存，仅影响首页天气和此详情。</p>
    {cityError && <p role="alert" className="inline-error">{cityError}</p>}
    {!data ? <div className="weather-empty" role="status">{query.isPending ? '正在获取天气…' : query.error?.message ?? '天气获取失败，请刷新重试'}</div> : <>
      <section className="weather-current" aria-label="当前天气"><div className="weather-now"><strong>{temperature(data.temperature)}<sup>°</sup></strong><div><WeatherIcon code={data.weatherCode} isDay={data.isDay} size={60} /><span>{weatherCondition(data.weatherCode).text}</span></div></div><div className="weather-current-meta"><p>{data.date} · {city.timeZone}</p><p>体感 {metric(data.apparentTemperature, '°')} · 今日 {temperature(data.temperatureMin)}°～{temperature(data.temperatureMax)}°</p><p>天气数据时间 {localTime(data.currentTime, city.timeZone)}</p></div></section>
      {query.isError && <p className="inline-error" role="status">更新失败 · 正在显示上次结果（获取于 {new Intl.DateTimeFormat('zh-CN', { timeZone: city.timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(data.fetchedAt))}）</p>}
      <div className="weather-metrics"><div><span>湿度</span><strong>{metric(data.humidity, '%')}</strong></div><div><span><Wind size={14} />{direction}风</span><strong>{metric(data.windSpeed, ' m/s')}</strong></div><div><span>海平面气压</span><strong>{metric(data.pressure, ' hPa')}</strong></div><div><span>当前时段降水</span><strong>{metric(data.precipitation, ' mm')}</strong></div><div><span><Sunrise size={14} />今日日出</span><strong>{localTime(data.daily[0]?.sunrise ?? null, city.timeZone)}</strong></div><div><span><Sunset size={14} />今日日落</span><strong>{localTime(data.daily[0]?.sunset ?? null, city.timeZone)}</strong></div></div>
      <section className="weather-section"><h3><Clock3 size={16} />未来 24 小时<span>温度 · 降雨概率</span></h3><HourlyForecast data={data} /></section>
      <section className="weather-section"><h3><CalendarDays size={16} />7 日天气预报<span>选择日期查看详情</span></h3>{!data.daily.length ? <p className="weather-empty">暂无每日预报</p> : <><div className="forecast-scroll" role="region" aria-label="7日预报，可横向滚动" tabIndex={0}><div className="daily-track">{data.daily.map((day, index) => <button key={day.date} type="button" aria-label={`查看${day.date}预报`} aria-pressed={selected?.date === day.date} onClick={() => setSelectedDate(day.date)}><strong>{index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</strong><span>{day.date.slice(5).replace('-', '/')}</span><WeatherIcon code={day.weatherCode} size={30} /><small>{weatherCondition(day.weatherCode).text}</small><b>{temperature(day.temperatureMax)}°<span> / {temperature(day.temperatureMin)}°</span></b><span className="daily-probability"><Droplets size={12} />{metric(day.precipitationProbability, '%')}</span></button>)}</div></div>{selected && <div className="selected-forecast" role="status"><strong>{selected.date}</strong><span>{weatherCondition(selected.weatherCode).text}</span><span>降水总量 {metric(selected.precipitation, ' mm')}</span><span>日出 {localTime(selected.sunrise, city.timeZone)}</span><span>日落 {localTime(selected.sunset, city.timeZone)}</span></div>}</>}</section>
    </>}
    <section className="weather-section air-section" aria-label="空气质量"><h3><Leaf size={16} />空气质量<span>美制 AQI · 模型估计</span></h3>{!air.data ? <p className="weather-empty" role="status">{air.isPending ? '正在获取空气质量…' : '空气质量暂时不可用，请刷新重试'}</p> : <><div className="air-metrics"><div><span>美制 AQI</span><strong>{air.data.usAqi === null ? '—' : Math.round(air.data.usAqi)}</strong><small>{aqiLabel(air.data.usAqi)}</small></div><div><span>PM2.5</span><strong>{metric(air.data.pm25, '')}</strong><small>μg/m³</small></div><div><span>PM10</span><strong>{metric(air.data.pm10, '')}</strong><small>μg/m³</small></div></div><p className="weather-city-note">空气质量数据时间 {localTime(air.data.time, city.timeZone)} · 美制指数与国内 AQI 口径不同</p>{air.isError && <p className="inline-error" role="status">空气质量更新失败 · 正在显示上次结果</p>}</>}
      <p className="weather-source">来源：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noopener noreferrer">CAMS</a> · 所有预报时间均为天气城市当地时间</p></section>
  </div>
}
