import { toDateTimeInput } from './time'

export type DateRange = { start: string; end: string }
export type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom'
export const beijingDateKey = (value: Date | string | number = new Date()) => toDateTimeInput(value).slice(0, 10)
export function getDateRange(filter: Exclude<DateFilter, 'custom'> | 'this-week' | 'this-month', now = new Date()): DateRange | null {
  if (filter === 'all') return null
  const today = beijingDateKey(now)
  const day = new Date(`${today}T12:00:00Z`)
  const key = (offset: number) => new Date(day.getTime() + offset * 86400_000).toISOString().slice(0, 10)
  if (filter === 'today') return { start: today, end: today }
  if (filter === 'week') return { start: key(-6), end: today }
  if (filter === 'month') return { start: key(-29), end: today }
  if (filter === 'this-week') {
    const monday = -((day.getUTCDay() + 6) % 7)
    return { start: key(monday), end: key(monday + 6) }
  }
  day.setUTCMonth(day.getUTCMonth() + 1, 0)
  return { start: `${today.slice(0, 7)}-01`, end: day.toISOString().slice(0, 10) }
}
