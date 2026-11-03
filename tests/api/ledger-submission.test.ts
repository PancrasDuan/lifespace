import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizedMutation } from '../../src/auth/request'
import { createLedgerSubmission } from '../../src/ledger/useLedgerSubmission'
import type { LedgerCreate, LedgerEntry } from '../../src/shared/ledger'

// Control the existing HTTP seam, while exercising the real response parser and
// the same submission interface used by the page. No database behavior is faked.
vi.mock('../../src/auth/request', () => ({ authorizedMutation: vi.fn() }))
const request = vi.mocked(authorizedMutation)
const owner = '00000000-0000-4000-8000-000000000001'
const receipt = { entryId: '00000000-0000-4000-8000-000000000002', version: 1, deleted: false }
const input = (): LedgerCreate => ({ requestId: crypto.randomUUID(), direction: 'expense', amountCents: -1234, occurredAt: '2026-01-02T03:04:05.000Z', accountName: '零钱', categoryCode: 'dining', note: '' })
const parent: LedgerEntry = { direction: 'expense', amountCents: -1234, occurredAt: '2026-01-02T03:04:05.000Z', accountName: '零钱', categoryCode: 'dining', note: '', id: '00000000-0000-4000-8000-000000000003', createdAt: '2026-01-02T03:04:05.000Z', status: 'completed', parentEntryId: null }
type Submission = ReturnType<typeof createLedgerSubmission>
function newForm(submission: Submission) {
  submission.openNew()
  const form = submission.getSnapshot().form
  if (form?.kind !== 'new') throw new Error('应打开新建表单')
  return form
}
function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  request.mockReset()
  request.mockImplementation(async () => Response.json(receipt))
})

describe('账单当前页内提交协作', () => {
  it('输入校验失败保留表单，修正后保存成功', async () => {
    const saved = vi.fn(), submission = createLedgerSubmission(owner, new AbortController().signal, saved)
    const form = newForm(submission)
    await form.submission.submit(() => { throw new Error('金额不能为零。') })
    expect(request).not.toHaveBeenCalled()
    expect(submission.getSnapshot().form?.submission).toMatchObject({ pending: false, frozen: false, message: '金额不能为零。' })
    await form.submission.submit(input)
    expect(submission.getSnapshot().form).toBeNull()
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('同次保存同步防重，迟到成功保留后来表单', async () => {
    const response = deferredResponse(), saved = vi.fn()
    request.mockReturnValueOnce(response.promise)
    const submission = createLedgerSubmission(owner, new AbortController().signal, saved)
    const first = newForm(submission), read = vi.fn(input)
    const saving = first.submission.submit(read)
    await first.submission.submit(read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(submission.getSnapshot().form?.submission.pending).toBe(true)
    submission.close()
    const later = newForm(submission)
    response.resolve(Response.json(receipt))
    await saving
    expect(submission.getSnapshot().form?.key).toBe(later.key)
    expect(submission.getSnapshot().form?.submission).toMatchObject({ pending: false, frozen: false, message: '' })
    expect(saved).toHaveBeenCalledTimes(1)
  })

  for (const kind of ['new', 'refund'] as const) it(`${kind} 未知结果冻结完整原请求，重试不再读取表单`, async () => {
    const signal = new AbortController().signal
    const submission = createLedgerSubmission(owner, signal, vi.fn())
    request.mockRejectedValueOnce(new TypeError('network failed'))
    if (kind === 'new') submission.openNew()
    else submission.openRefund(parent, 1234)
    const form = submission.getSnapshot().form!
    const ordinary = input(), refund = { requestId: crypto.randomUUID(), amountCents: 300, occurredAt: '2026-01-03T03:04:05.000Z', note: '退款' }
    if (form.kind === 'new') await form.submission.submit(() => ordinary)
    else await form.submission.submit(() => refund)
    const firstRequest = request.mock.calls[0]
    expect(firstRequest[0]).toBe(kind === 'new' ? '/api/ledger/entries' : `/api/ledger/entries/${parent.id}/refunds`)
    expect(firstRequest[2]).toBe(signal)
    expect(firstRequest[3]).toBe(owner)
    expect(submission.getSnapshot().form?.submission).toMatchObject({ pending: false, frozen: true })
    expect(submission.getSnapshot().unconfirmed).toEqual([])
    // Even a caller mutating its draft cannot change the retained request.
    ordinary.note = '改过的草稿'; refund.note = '改过的退款'
    const readAgain = vi.fn(() => { throw new Error('未知重试不应再读取输入') })
    await form.submission.submit(readAgain)
    expect(readAgain).not.toHaveBeenCalled()
    expect(request.mock.calls[1]).toEqual(firstRequest)
    expect(submission.getSnapshot()).toEqual({ form: null, unconfirmed: [] })
  })

  it('关闭后的未知原请求不阻塞退款，旧请求重试不关闭后来表单', async () => {
    const saved = vi.fn(), submission = createLedgerSubmission(owner, new AbortController().signal, saved)
    request.mockResolvedValueOnce(Response.json({ invalidReceipt: true }))
    await newForm(submission).submission.submit(input)
    submission.close()
    const unknown = submission.getSnapshot().unconfirmed[0]
    submission.openRefund(parent, 1234)
    const refund = submission.getSnapshot().form
    if (refund?.kind !== 'refund') throw new Error('应打开退款表单')
    await refund.submission.submit(() => ({ requestId: crypto.randomUUID(), amountCents: 300, occurredAt: '2026-01-03T03:04:05.000Z', note: '' }))
    const later = newForm(submission)
    const response = deferredResponse()
    request.mockReturnValueOnce(response.promise)
    const retry = unknown.retry()
    await unknown.retry()
    expect(submission.getSnapshot().unconfirmed[0].pending).toBe(true)
    expect(request).toHaveBeenCalledTimes(3)
    response.resolve(Response.json(receipt))
    await retry
    expect(request.mock.calls[2]).toEqual(request.mock.calls[0])
    expect(submission.getSnapshot().form?.key).toBe(later.key)
    expect(submission.getSnapshot().unconfirmed).toEqual([])
    expect(saved).toHaveBeenCalledTimes(2)
  })

  it('明确拒绝允许修正并发新请求；未知请求后再被拒绝仍保留原请求', async () => {
    const failure = () => Response.json({ error: { code: 'REFUND_LIMIT', message: '退款金额超过剩余可退额度' } }, { status: 409 })
    const submission = createLedgerSubmission(owner, new AbortController().signal, vi.fn())
    const form = newForm(submission)
    request.mockResolvedValueOnce(failure())
    await form.submission.submit(input)
    expect(submission.getSnapshot().form?.submission).toMatchObject({ frozen: false, message: '退款金额超过剩余可退额度' })
    request.mockRejectedValueOnce(new TypeError('network failed'))
    await form.submission.submit(input)
    expect(request.mock.calls[1][1]).not.toBe(request.mock.calls[0][1])
    request.mockResolvedValueOnce(failure())
    await form.submission.submit(input)
    expect(submission.getSnapshot().form?.submission.frozen).toBe(true)
    expect(request.mock.calls[2]).toEqual(request.mock.calls[1])
  })

  it('身份失效后的迟到响应不关闭表单、不触发成功处理，也不再提交', async () => {
    const response = deferredResponse(), controller = new AbortController(), saved = vi.fn()
    request.mockReturnValueOnce(response.promise)
    const submission = createLedgerSubmission(owner, controller.signal, saved)
    const form = newForm(submission), saving = form.submission.submit(input)
    controller.abort()
    response.resolve(Response.json(receipt))
    await saving
    await form.submission.submit(input)
    expect(saved).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('新的页面实例不恢复或自动重发旧未知请求', async () => {
    request.mockRejectedValueOnce(new TypeError('network failed'))
    const first = createLedgerSubmission(owner, new AbortController().signal, vi.fn())
    await newForm(first).submission.submit(input)
    first.close()
    expect(first.getSnapshot().unconfirmed).toHaveLength(1)
    const reentered = createLedgerSubmission(owner, new AbortController().signal, vi.fn())
    expect(reentered.getSnapshot()).toEqual({ form: null, unconfirmed: [] })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
