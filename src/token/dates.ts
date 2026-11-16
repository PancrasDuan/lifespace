import { Temporal } from '@js-temporal/polyfill'

export const periods = { '1': '今天', week: '本周', month: '本月', '7': '近 7 天', '30': '近 30 天', '90': '近 90 天', year: '今年' } as const
export type Period = keyof typeof periods
export const beijingToday = (now = Date.now()) => Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO('Asia/Shanghai').toPlainDate().toString()
export const offsetDate = (date: string, days: number) => Temporal.PlainDate.from(date).add({ days }).toString()
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  for (let date = start; date <= end; date = offsetDate(date, 1)) dates.push(date)
  return dates
}
export function periodRange(period: Period, today: string) {
  const date = Temporal.PlainDate.from(today)
  const start = period === 'week' ? date.subtract({ days: date.dayOfWeek - 1 }).toString()
    : period === 'month' ? date.with({ day: 1 }).toString()
    : period === 'year' ? date.with({ month: 1, day: 1 }).toString() : offsetDate(today, 1 - Number(period))
  const days = Temporal.PlainDate.from(start).until(date).days + 1
  const previousStart = period === 'week' ? offsetDate(start, -7)
    : period === 'month' ? date.with({ day: 1 }).subtract({ months: 1 }).toString() : offsetDate(start, -days)
  const previousEnd = period === 'week' ? offsetDate(today, -7)
    : period === 'month' ? date.subtract({ months: 1 }, { overflow: 'constrain' }).toString() : offsetDate(start, -1)
  return { startDate: start, endDate: today, previousStart, previousEnd, days, comparison: period === 'week' ? '上周同期' : period === 'month' ? '上月同期' : '上一周期' }
}
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
export const longDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
export const sundayOffset = (date: string) => Temporal.PlainDate.from(date).dayOfWeek % 7
export const receivedTime = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date))
