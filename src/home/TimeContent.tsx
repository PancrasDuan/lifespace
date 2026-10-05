import { Globe2, MapPin } from 'lucide-react'
import { clock, dayText, utcOffset, zoneName } from './time'

export function TimeContent({ now, localZone, overseas }: { now: Date; localZone: string; overseas: string[] }) {
  return <div className="time-content">{[localZone, ...overseas.slice(0, 2)].map((id, index) => {
    const Icon = index === 0 ? MapPin : Globe2
    return <div className={`clock-column ${index === 0 ? 'local-clock' : 'world-clock'}`} key={`${index}-${id}`}>
      <div className="clock-label"><Icon size={14} /><span>{zoneName(id)}</span><small>{utcOffset(now, id)}</small></div>
      <p>{dayText(now, id)}</p><strong>{clock(now, id)}</strong>
    </div>
  })}{overseas.length > 2 && <span className="world-more">另有 {overseas.length - 2} 个时区，详情查看</span>}</div>
}
export function TimeDetail({ now, localZone, overseas }: { now: Date; localZone: string; overseas: string[] }) {
  return <div className="detail-zones">{[localZone, ...overseas].map((zone, index) => <div key={`${index}-${zone}`}><div><strong>{zoneName(zone)}</strong><small>{utcOffset(now, zone)}</small></div><div><strong>{clock(now, zone)}</strong><small>{dayText(now, zone)}</small></div></div>)}</div>
}
