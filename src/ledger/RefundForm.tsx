import { useState, type FormEvent } from 'react'
import { Check, Link2 } from 'lucide-react'
import { categoryLabel, ledgerRefundSchema, type LedgerEntry, type LedgerRefund } from '../shared/ledger'
import type { FormSubmission } from './useLedgerSubmission'
import { formatCurrency, fromDateTimeInput, toDateTimeInput, yuanToCents } from './time'
import { TransactionDateTimeField } from './TransactionDateTimeField'

export function RefundForm({ parent, remainingCents, submission, cancel }: { parent: LedgerEntry; remainingCents: number; submission: FormSubmission<LedgerRefund>; cancel: () => void }) {
  const [amount, setAmount] = useState(''), [time, setTime] = useState(toDateTimeInput), [note, setNote] = useState('')
  const { pending, frozen, message } = submission
  const disabled = pending || frozen
  function submit(event: FormEvent) {
    event.preventDefault()
    void submission.submit(() => {
      const parsed = ledgerRefundSchema.safeParse({ requestId: crypto.randomUUID(), amountCents: yuanToCents(amount), occurredAt: fromDateTimeInput(time), note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message)
      const input = parsed.data
      if (Date.parse(input.occurredAt) < Date.parse(parent.occurredAt)) throw new Error('退款时间不能早于父支出。')
      if (Date.parse(input.occurredAt) > Date.now()) throw new Error('交易时间不能晚于当前北京时间。')
      return input
    })
  }
  return <form className="lp-entry-form" onSubmit={submit} noValidate>
    <div className="lp-form-parent"><Link2 size={15} /><div>原支出<strong>{categoryLabel(parent.categoryCode)} · {formatCurrency(parent.amountCents)}</strong><span>可退 {formatCurrency(remainingCents).replace(/^\+/, '')}</span></div></div>
    <div className="lp-form-status"><span>收支类型</span><span>收入 · 退款</span></div>
    <label className="lp-amount-field"><span>交易金额<small>人民币</small></span><div><b>+ ¥</b><input autoFocus disabled={disabled} aria-label="交易金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></div></label>
    <TransactionDateTimeField disabled={disabled} value={time} onChange={setTime} minInstant={parent.occurredAt} />
    <label className="lp-field">交易账户<input readOnly value={parent.accountName} /></label>
    <label className="lp-field">交易分类<input readOnly value={categoryLabel(parent.categoryCode)} /></label>
    <div className="lp-form-status"><span>交易状态</span><span><Check size={12} />已完成</span></div>
    <label className="lp-field">交易备注<span className="lp-optional">选填</span><textarea disabled={disabled} aria-label="交易备注" rows={3} placeholder="添加备注" value={note} onChange={event => setNote(event.target.value)} /></label>
    {message && <p className="lp-form-error" role="alert">{message}</p>}
    <div className="lp-form-actions"><button type="button" className="lp-secondary" onClick={cancel}>取消</button><button className="lp-primary" type="submit" disabled={pending}>{pending ? '正在保存…' : frozen ? '重试原请求' : '保存退款'}</button></div>
  </form>
}
