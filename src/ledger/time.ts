const offset = 8 * 60 * 60 * 1000
export function toDateTimeInput(value: Date | string | number = new Date()): string {
  return new Date(new Date(value).getTime() + offset).toISOString().slice(0, 19)
}
export function fromDateTimeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) || value.startsWith('0000-')) throw new Error('请填写完整的交易时间。')
  const date = new Date(`${value}+08:00`)
  if (!Number.isFinite(date.getTime()) || toDateTimeInput(date).slice(0, value.length) !== value) throw new Error('交易时间无效。')
  return date.toISOString()
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
