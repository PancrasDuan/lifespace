// Throwaway UI prototype: fictional entries live in memory only.
export type LedgerEntry = {
  id: string
  occurredAt: string
  amountCents: number
  account: string
  direction: 'income' | 'expense'
  category: string
  note: string
  parentId?: string
  deletedAt?: string
}

export type EntryDraft = Omit<LedgerEntry, 'id' | 'parentId' | 'deletedAt'>
export type RefundDraft = Pick<LedgerEntry, 'occurredAt' | 'amountCents' | 'note'>
export type EntryStatus = 'completed' | 'partial-refund' | 'full-refund'
export type DateFilter = 'all' | 'today' | 'week' | 'month' | 'this-week' | 'this-month' | 'custom'
export type DateRange = { start: string; end: string }

export const statusLabels: Record<EntryStatus, string> = {
  completed: '已完成',
  'partial-refund': '部分退款',
  'full-refund': '全部退款',
}

export const categoryOptions: Record<LedgerEntry['direction'], readonly string[]> = {
  expense: ['交通', '住宿', '餐饮', '购物', '人情支出', '充值', '订阅', '投资理财', '其他'],
  income: ['工资', '兼职', '投资理财', '人情收入', '二手转卖', '其他收入'],
}

export const inputLimits = {
  maxAmountCents: 99_999_999_999,
  accountLength: 50,
  noteLength: 500,
}

const beijingOffset = 8 * 60 * 60 * 1000
const day = 24 * 60 * 60 * 1000

export function beijingDateKey(value: Date | string | number = new Date()): string {
  return new Date(new Date(value).getTime() + beijingOffset).toISOString().slice(0, 10)
}

export function toDateTimeInput(value: Date | string | number = new Date()): string {
  return new Date(new Date(value).getTime() + beijingOffset).toISOString().slice(0, 19)
}

export function fromDateTimeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('请填写完整的交易时间。')
  const date = new Date(`${value}+08:00`)
  if (!Number.isFinite(date.getTime()) || toDateTimeInput(date).slice(0, value.length) !== value) throw new Error('交易时间无效。')
  return date.toISOString()
}

export function formatDateTime(value: string): string {
  return toDateTimeInput(value).replace('T', ' ')
}

export function formatCurrency(amountCents: number, signed = true): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(amountCents / 100)
}

export function getDateRange(filter: DateFilter, start = '', end = '', now = new Date()): DateRange | null {
  const today = beijingDateKey(now)
  const midnight = new Date(`${today}T00:00:00+08:00`).getTime()
  const key = (offset: number) => beijingDateKey(midnight + offset * day)
  if (filter === 'all') return null
  if (filter === 'custom') return start && end ? { start, end } : null
  if (filter === 'today') return { start: today, end: today }
  if (filter === 'week') return { start: key(-6), end: today }
  if (filter === 'month') return { start: key(-29), end: today }
  if (filter === 'this-week') {
    const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay()
    const mondayOffset = -((weekday + 6) % 7)
    return { start: key(mondayOffset), end: key(mondayOffset + 6) }
  }
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${lastDay}` }
}

export function filterEntries(entries: LedgerEntry[], filter: DateFilter = 'all', start = '', end = '', now = new Date()): LedgerEntry[] {
  const range = getDateRange(filter, start, end, now)
  return entries.filter(entry => {
    if (entry.deletedAt) return false
    const date = beijingDateKey(entry.occurredAt)
    return !range || (date >= range.start && date <= range.end)
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
}

export function getRefunds(parentId: string, entries: LedgerEntry[]): LedgerEntry[] {
  return filterEntries(entries.filter(entry => entry.parentId === parentId))
}

export function refundedCents(parentId: string, entries: LedgerEntry[]): number {
  return getRefunds(parentId, entries).reduce((sum, entry) => sum + entry.amountCents, 0)
}

export function getEntryStatus(entry: LedgerEntry, entries: LedgerEntry[]): EntryStatus {
  if (entry.direction === 'income' || entry.parentId) return 'completed'
  const refunded = refundedCents(entry.id, entries)
  if (!refunded) return 'completed'
  return refunded === Math.abs(entry.amountCents) ? 'full-refund' : 'partial-refund'
}

function validTime(value: string, now: Date): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('请填写有效的交易时间。')
  if (date.getTime() > now.getTime()) throw new Error('交易时间不能晚于当前北京时间。')
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString()
}

function validAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw new Error('金额不能为零，且最多保留两位小数。')
  if (Math.abs(amountCents) > inputLimits.maxAmountCents) throw new Error(`单笔金额不能超过 ${formatCurrency(inputLimits.maxAmountCents, false)}。`)
}

export function createEntry(entries: LedgerEntry[], draft: EntryDraft, now = new Date()): LedgerEntry[] {
  validAmount(draft.amountCents)
  if ((draft.direction === 'expense' && draft.amountCents > 0) || (draft.direction === 'income' && draft.amountCents < 0)) {
    throw new Error('支出填写负数，收入填写正数。')
  }
  const account = draft.account.trim()
  const note = draft.note.trim()
  if (!account) throw new Error('交易账户不能为空。')
  if (Array.from(account).length > inputLimits.accountLength) throw new Error(`交易账户最多 ${inputLimits.accountLength} 个字符。`)
  if (Array.from(note).length > inputLimits.noteLength) throw new Error(`交易备注最多 ${inputLimits.noteLength} 个字符。`)
  const category = draft.category.trim()
  if (!categoryOptions[draft.direction].includes(category)) throw new Error('请选择与收支类型对应的交易分类。')
  return [...entries, {
    id: crypto.randomUUID(), occurredAt: validTime(draft.occurredAt, now), amountCents: draft.amountCents,
    account, direction: draft.direction, category, note,
  }]
}

export function createRefund(entries: LedgerEntry[], parentId: string, draft: RefundDraft, now = new Date()): LedgerEntry[] {
  const parent = entries.find(entry => entry.id === parentId && !entry.deletedAt)
  if (!parent || parent.direction !== 'expense' || parent.parentId) throw new Error('只能为未删除的普通支出登记退款。')
  validAmount(draft.amountCents)
  if (draft.amountCents < 0) throw new Error('退款金额必须为正数。')
  const remaining = Math.abs(parent.amountCents) - refundedCents(parent.id, entries)
  if (draft.amountCents > remaining) throw new Error(`退款金额超过剩余可退金额 ${formatCurrency(remaining, false)}。`)
  const note = draft.note.trim()
  if (Array.from(note).length > inputLimits.noteLength) throw new Error(`交易备注最多 ${inputLimits.noteLength} 个字符。`)
  const occurredAt = validTime(draft.occurredAt, now)
  if (Date.parse(occurredAt) < Date.parse(parent.occurredAt)) throw new Error('退款时间不能早于原支出的交易时间。')
  return [...entries, {
    id: crypto.randomUUID(), parentId: parent.id, occurredAt, amountCents: draft.amountCents,
    account: parent.account, category: parent.category, direction: 'income', note,
  }]
}

export function deleteEntry(entries: LedgerEntry[], id: string, now = new Date()): LedgerEntry[] {
  const target = entries.find(entry => entry.id === id && !entry.deletedAt)
  if (!target) return entries
  return entries.map(entry => (!entry.deletedAt && (entry.id === id || entry.parentId === id))
    ? { ...entry, deletedAt: now.toISOString() } : entry)
}

export function createSeedEntries(now = new Date()): LedgerEntry[] {
  const timestamp = Math.floor(now.getTime() / 1000) * 1000
  const at = (hoursAgo: number) => new Date(timestamp - hoursAgo * 60 * 60 * 1000).toISOString()
  const accounts = ['招商储蓄卡', '建设储蓄卡', '工商信用卡']
  const purchases = [
    { category: '餐饮', amountCents: -3600, note: '街角小馆 · 午餐' },
    { category: '餐饮', amountCents: -2600, note: '燕麦拿铁' },
    { category: '交通', amountCents: -650, note: '地铁通勤' },
    { category: '购物', amountCents: -8990, note: '纸巾与清洁用品' },
    { category: '购物', amountCents: -12850, note: '周末采购' },
    { category: '购物', amountCents: -6800, note: '新买的一本书' },
    { category: '订阅', amountCents: -2500, note: '音乐月度订阅' },
    { category: '其他', amountCents: -7900, note: '周末羽毛球' },
    { category: '充值', amountCents: -10000, note: '手机话费充值' },
    { category: '投资理财', amountCents: -50000, note: '基金申购' },
    { category: '人情支出', amountCents: -20000, note: '好友生日礼物' },
    { category: '住宿', amountCents: -24000, note: '周末民宿' },
  ]
  const incomeExamples = [
    { category: '兼职', note: '插画项目结款' },
    { category: '工资', note: '本月工资' },
    { category: '投资理财', note: '基金收益到账' },
    { category: '二手转卖', note: '闲置相机转卖' },
  ]
  const entries: LedgerEntry[] = Array.from({ length: 68 }, (_, index) => {
    const purchase = purchases[index % purchases.length]
    const income = index % 17 === 9
    const incomeExample = incomeExamples[Math.floor(index / 17) % incomeExamples.length]
    return {
      id: `demo-${String(index + 1).padStart(3, '0')}`, occurredAt: at(index * 10 + 0.25),
      amountCents: income ? 180000 + index * 100 : purchase.amountCents,
      account: accounts[index % accounts.length], direction: income ? 'income' : 'expense',
      category: income ? incomeExample.category : purchase.category, note: income ? incomeExample.note : purchase.note,
    }
  })
  const partial: LedgerEntry = {
    id: 'demo-partial', occurredAt: at(50), amountCents: -29900, account: '工商信用卡',
    direction: 'expense', category: '购物', note: '两件棉质衬衫',
  }
  const full: LedgerEntry = {
    id: 'demo-full', occurredAt: at(120), amountCents: -15800, account: '招商储蓄卡',
    direction: 'expense', category: '住宿', note: '行程取消，已退全款',
  }
  const monthStart = Date.parse(`${beijingDateKey(now).slice(0, 7)}-01T00:00:00+08:00`)
  const crossMonth: LedgerEntry = {
    id: 'demo-cross-month', occurredAt: new Date(monthStart - 26 * 60 * 60 * 1000).toISOString(),
    amountCents: -56000, account: '建设储蓄卡', direction: 'expense', category: '住宿', note: '上月预订的周末民宿',
  }
  const refund = (parent: LedgerEntry, id: string, amountCents: number, occurredAt: string, note: string): LedgerEntry => ({
    id, parentId: parent.id, occurredAt, amountCents, account: parent.account,
    category: parent.category, direction: 'income', note,
  })
  return [...entries, partial, full, crossMonth,
    refund(partial, 'demo-partial-refund', 9900, at(6), '退回一件衬衫'),
    refund(full, 'demo-full-refund', 15800, at(25), '行程取消，全额退款'),
    refund(crossMonth, 'demo-cross-month-refund', 20000, new Date(Math.min(timestamp, monthStart + 12 * 60 * 60 * 1000)).toISOString(), '民宿订单部分退款'),
  ]
}
