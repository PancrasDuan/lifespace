import { Temporal } from '@js-temporal/polyfill'
const timeZone = 'Asia/Shanghai'
export function toDateTimeInput(value: Date | string | number = new Date()): string {
  return Temporal.Instant.fromEpochMilliseconds(new Date(value).getTime()).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: 'second' })
}
export function normalizeDateTimeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) || value.startsWith('0000-')) throw new Error('请填写完整的交易时间。')
  const normalized = Temporal.PlainDateTime.from(value, { overflow: 'reject' }).toString({ smallestUnit: 'second' })
  if (normalized.slice(0, value.length) !== value) throw new Error('交易时间无效。')
  return normalized
}
export function fromDateTimeInput(value: string): string {
  try {
    // Match PostgreSQL's later instant for a repeated local hour. Reject gaps
    // rather than silently moving the user's time across a DST transition.
    const local = normalizeDateTimeInput(value)
    const date = Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone, { disambiguation: 'later' })
    if (date.toPlainDateTime().toString({ smallestUnit: 'second' }) !== local) throw new Error()
    return date.toInstant().toString({ smallestUnit: 'millisecond' })
  } catch { throw new Error('交易时间无效，请检查日期及北京时间的历史时区规则。') }
}
export const formatDateTime = (value: string) => toDateTimeInput(value).replace('T', ' ')
export const formatCurrency = (amount: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100)
export function yuanToCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('请填写有效金额，最多保留两位小数。')
  const [yuan, fraction = ''] = value.trim().split('.')
  const cents = BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents === 0n) throw new Error('金额不能为零。')
  if (cents > 99_999_999_999n) throw new Error('单笔金额不能超过 999,999,999.99 元。')
  return Number(cents)
}
