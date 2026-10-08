import { SolarDay } from 'tyme4ts'
import { dateKey } from './time'

function calendarDay(now: Date, timeZone: string) {
  const [year, month, day] = dateKey(now, timeZone).split('-').map(Number)
  return { year, month, day, lunar: SolarDay.fromYmd(year, month, day).getLunarDay() }
}
export function CalendarContent({ now, timeZone }: { now: Date; timeZone: string }) {
  const { year, month, day, lunar } = calendarDay(now, timeZone)
  return <div className="calendar-content"><div className="calendar-day"><span>{year} 年 {month} 月</span><strong>{String(day).padStart(2, '0')}</strong><p>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone }).format(now)}</p></div>
    <div className="lunar-summary"><span>{lunar.toString()}</span><div><b>宜</b><p>{lunar.getRecommends().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div><div><b>忌</b><p>{lunar.getAvoids().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div></div>
  </div>
}
export { CalendarDetail } from './CalendarDetail'
