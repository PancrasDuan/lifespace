import { z } from 'zod'

export const ledgerCategories = {
  expense: [
    ['transport', '交通'], ['accommodation', '住宿'], ['dining', '餐饮'], ['shopping', '购物'],
    ['gift_expense', '人情支出'], ['top_up', '充值'], ['subscription', '订阅'], ['investment', '投资理财'], ['other_expense', '其他'],
  ],
  income: [['salary', '工资'], ['part_time', '兼职'], ['investment', '投资理财'], ['gift_income', '人情收入'], ['secondhand_sale', '二手转卖'], ['other_income', '其他收入']],
} as const
export const ledgerLimits = { amountCents: 99_999_999_999, accountName: 50, note: 500, pageSize: 30 } as const
export const ledgerStatusLabels = { completed: '已完成', 'partial-refund': '部分退款', 'full-refund': '全部退款' } as const
export const ledgerDirectionSchema = z.enum(['expense', 'income'], { error: '请选择收入或支出。' })
export const ledgerCategorySchema = z.enum(['transport', 'accommodation', 'dining', 'shopping', 'gift_expense', 'top_up', 'subscription', 'investment', 'other_expense', 'salary', 'part_time', 'gift_income', 'secondhand_sale', 'other_income'], { error: '请选择有效的交易分类。' })
const accountName = z.string().trim().refine(value => [...value].length >= 1 && [...value].length <= 50, '交易账户不能为空，且最多 50 个字符。')
const note = z.string().trim().refine(value => [...value].length <= 500, '交易备注最多 500 个字符。')
const amountCents = z.number().int().min(-ledgerLimits.amountCents).max(ledgerLimits.amountCents).refine(value => value !== 0, '金额不能为零。')
const utcTime = z.iso.datetime().refine(value => /^\d{4}-/.test(value) && !value.startsWith('0000-') && Date.parse(value) % 1000 === 0, '交易时间须精确到秒。')
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const transactionFields = { direction: ledgerDirectionSchema, amountCents, occurredAt: utcTime, accountName, categoryCode: ledgerCategorySchema, note }
export const ledgerCreateSchema = z.strictObject({ requestId: z.uuid(), ...transactionFields }).superRefine((value, ctx) => {
  if ((value.direction === 'expense') !== (value.amountCents < 0)) ctx.addIssue({ code: 'custom', message: '金额符号与收支类型不符。', path: ['amountCents'] })
  if (!ledgerCategories[value.direction].some(([code]) => code === value.categoryCode)) ctx.addIssue({ code: 'custom', message: '请选择与收支类型对应的交易分类。', path: ['categoryCode'] })
})
export const ledgerRefundSchema = z.strictObject({ requestId: z.uuid(), amountCents: amountCents.refine(value => value > 0, '退款金额必须为正数。'), occurredAt: utcTime, note })
export const ledgerEntrySchema = z.strictObject({
  id: z.uuid(), ...transactionFields, parentEntryId: z.uuid().nullable(), createdAt: z.iso.datetime(),
  status: z.enum(['completed', 'partial-refund', 'full-refund']),
})
export const ledgerPageSchema = z.strictObject({ items: z.array(ledgerEntrySchema).max(30), total: revision, page: z.number().int().min(1), pageSize: z.literal(30), version: revision })
export const ledgerDetailSchema = z.strictObject({ entry: ledgerEntrySchema, parentEntry: ledgerEntrySchema.nullable(), refunds: z.array(ledgerEntrySchema), version: revision })
export const ledgerReceiptSchema = z.strictObject({ entryId: z.uuid(), version: revision, deleted: z.boolean() })
export const ledgerDeleteSchema = z.strictObject({ scope: z.string().regex(/^[a-f0-9]{64}$/) })
export const ledgerDeletePreviewSchema = z.strictObject({ entry: ledgerEntrySchema, refundCount: revision, scope: ledgerDeleteSchema.shape.scope, version: revision })
export const ledgerDateSchema = z.iso.date().refine(value => !value.startsWith('0000-'), '日期无效')
export const ledgerQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  startDate: ledgerDateSchema.optional(), endDate: ledgerDateSchema.optional(),
  version: z.string().regex(/^(0|[1-9]\d*)$/).pipe(z.coerce.number<string>().int().min(0).max(Number.MAX_SAFE_INTEGER)).optional(),
}).refine(value => (!value.startDate && !value.endDate) || (!!value.startDate && !!value.endDate && value.startDate <= value.endDate), '日期范围无效')
export const ledgerErrors = {
  INVALID_ENTRY: [400, '流水输入无效，请检查金额、账户、分类与交易时间'],
  INVALID_QUERY: [400, '日期或分页参数无效'],
  LIST_CHANGED: [409, '列表已更新，已返回第一页'],
  FUTURE_TIME: [400, '交易时间不能晚于当前北京时间'],
  REQUEST_ID_REUSED: [409, '请求编号已用于不同内容，请重新创建流水'],
  NOT_FOUND: [404, '流水不存在或不属于当前账户'],
  REFUND_PARENT_INVALID: [409, '只能为本人未删除的普通支出登记退款'],
  REFUND_LIMIT: [409, '退款金额超过剩余可退额度，请查看最新流水'],
  REFUND_TIME: [400, '退款时间不能早于父支出'],
  DELETE_SCOPE_CHANGED: [409, '关联退款范围已变化，请核对最新影响后再次确认删除'],
  DELETE_UNKNOWN: [503, '删除结果未确认，请重试删除或查看最新流水'],
  LEDGER_UNAVAILABLE: [503, '暂时无法读取账单，请稍后重试'],
  SAVE_UNKNOWN: [503, '保存结果未确认，请沿用原请求重试或刷新查看流水'],
} as const
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>
export type LedgerCreate = z.infer<typeof ledgerCreateSchema>
export type LedgerRefund = z.infer<typeof ledgerRefundSchema>
export type LedgerPage = z.infer<typeof ledgerPageSchema>
export type LedgerReceipt = z.infer<typeof ledgerReceiptSchema>
export type LedgerDeletePreview = z.infer<typeof ledgerDeletePreviewSchema>
export function categoryLabel(code: string) { return [...ledgerCategories.expense, ...ledgerCategories.income].find(([value]) => value === code)?.[1] ?? code }
