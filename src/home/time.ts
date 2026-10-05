export const clock = (date: Date, zone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
export const dayText = (date: Date, zone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric', weekday: 'long' }).format(date)
export const dateKey = (date: Date, zone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
export const utcOffset = (date: Date, zone: string) => {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? 'GMT'
  return value === 'GMT' ? 'UTC+0' : value.replace('GMT', 'UTC')
}
export const zones = [
  { id: 'America/New_York', name: '纽约' }, { id: 'Europe/London', name: '伦敦' },
  { id: 'Asia/Tokyo', name: '东京' }, { id: 'Europe/Paris', name: '巴黎' },
  { id: 'America/Los_Angeles', name: '洛杉矶' }, { id: 'Asia/Singapore', name: '新加坡' },
  { id: 'Australia/Sydney', name: '悉尼' }, { id: 'Asia/Kolkata', name: '加尔各答' },
]
export const zoneName = (id: string) => zones.find(zone => zone.id === id)?.name ?? (id === 'Asia/Shanghai' ? '上海' : id.split('/').at(-1)?.replaceAll('_', ' ') ?? id)
export function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: zone }).format(); return !/^[+-]/.test(zone) }
  catch { return false }
}
