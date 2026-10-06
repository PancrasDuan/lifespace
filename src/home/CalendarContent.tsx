import { SolarDay } from 'tyme4ts'

function lunarDay(now: Date) { return SolarDay.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunarDay() }
export function CalendarContent({ now }: { now: Date }) {
  const lunar = lunarDay(now)
  return <div className="calendar-content"><div className="calendar-day"><span>{now.getFullYear()} 年 {now.getMonth() + 1} 月</span><strong>{String(now.getDate()).padStart(2, '0')}</strong><p>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)}</p></div>
    <div className="lunar-summary"><span>{lunar.toString()}</span><div><b>宜</b><p>{lunar.getRecommends().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div><div><b>忌</b><p>{lunar.getAvoids().slice(0, 3).map(item => item.getName()).join(' · ') || '—'}</p></div></div>
  </div>
}
export function CalendarDetail({ now }: { now: Date }) {
  const lunar = lunarDay(now)
  return <><div className="detail-calendar"><strong>{String(now.getDate()).padStart(2, '0')}</strong><span>{lunar.toString()}</span></div><div className="almanac-block good"><b>宜</b><p>{lunar.getRecommends().map(item => item.getName()).join(' · ') || '—'}</p></div><div className="almanac-block avoid"><b>忌</b><p>{lunar.getAvoids().map(item => item.getName()).join(' · ') || '—'}</p></div><p className="detail-note">tyme4ts · 本地当天生成</p></>
}
