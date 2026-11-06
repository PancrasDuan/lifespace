import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowRightLeft, Link } from 'lucide-react'
import { useVerifiedIdentity } from '../auth/identity'
import { ledgerLimits, ledgerTransferSchema, type LedgerTransfer } from '../shared/ledger'
import { readLedgerAccounts } from './api'
import { formatCurrency, fromDateTimeInput, toDateTimeInput, yuanToCents } from './time'
import { TransactionDateTimeField } from './TransactionDateTimeField'
import { BalancePreferenceError, BalanceVisibilityButton } from './Accounts'
import type { FormSubmission } from './useLedgerSubmission'
import './transfers.css'

export function TransferForm({ fromAccountId, submission, cancel, balancesHidden, toggleBalances, balancePreferenceError }: { fromAccountId?: string; submission: FormSubmission<LedgerTransfer>; cancel: () => void; balancesHidden: boolean; toggleBalances: () => void; balancePreferenceError: boolean }) {
  const identity = useVerifiedIdentity()
  const accounts = useQuery({ queryKey: ['ledger', identity.ownerId, 'accounts'], queryFn: ({ signal }) => readLedgerAccounts(identity.ownerId, AbortSignal.any([signal, identity.signal])), retry: false, refetchOnWindowFocus: false })
  const [from, setFrom] = useState(fromAccountId ?? ''), [to, setTo] = useState('')
  const [amount, setAmount] = useState(''), [time, setTime] = useState(toDateTimeInput), [note, setNote] = useState('')
  const { pending, frozen, message } = submission
  const disabled = pending || frozen, choices = accounts.data?.accounts ?? []
  const source = choices.find(item => item.id === from), target = choices.find(item => item.id === to)
  let cents: number | undefined
  try { cents = yuanToCents(amount) } catch { /* Show validation when submitted. */ }
  const fromBalance = source && cents !== undefined ? source.balanceCents - cents : undefined
  const toBalance = target && cents !== undefined ? target.balanceCents + cents : undefined
  const overLimit = fromBalance !== undefined && Math.abs(fromBalance) > ledgerLimits.amountCents || toBalance !== undefined && Math.abs(toBalance) > ledgerLimits.amountCents
  function submit(event: FormEvent) {
    event.preventDefault()
    void submission.submit(() => {
      const parsed = ledgerTransferSchema.safeParse({ requestId: crypto.randomUUID(), fromAccountId: from, toAccountId: to, amountCents: yuanToCents(amount), occurredAt: fromDateTimeInput(time), note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message)
      if (Date.parse(parsed.data.occurredAt) > Date.now()) throw new Error('交易时间不能晚于当前北京时间。')
      if (overLimit) throw new Error('操作后的账户余额超出允许范围，请调整金额。')
      return parsed.data
    })
  }
  return <form className="lp-entry-form lt-form" onSubmit={submit} noValidate>
    <div className="lt-accounts">
      <label className="lp-field">转出账户<select aria-label="转出账户" autoFocus disabled={disabled || !choices.length} value={from} onChange={event => { setFrom(event.target.value); if (to === event.target.value) setTo('') }}><option value="" disabled>选择账户</option>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{source ? `当前余额 ${balancesHidden ? '••••••' : formatCurrency(source.balanceCents)}` : '选择资金转出的账户'}</small></label>
      <button className="lt-swap" type="button" aria-label="交换转出与转入账户" disabled={disabled || !from || !to} onClick={() => { setFrom(to); setTo(from) }}><ArrowRightLeft size={18} /></button>
      <label className="lp-field">转入账户<select aria-label="转入账户" disabled={disabled || choices.length < 2} value={to} onChange={event => setTo(event.target.value)}><option value="" disabled>选择账户</option>{choices.filter(item => item.id !== from).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{target ? `当前余额 ${balancesHidden ? '••••••' : formatCurrency(target.balanceCents)}` : '选择资金转入的账户'}</small></label>
    </div>
    <BalanceVisibilityButton hidden={balancesHidden} toggle={toggleBalances} />
    {balancePreferenceError && <BalancePreferenceError />}
    {accounts.isPending && <p role="status">正在读取账户…</p>}
    {accounts.isError && <p role="alert" className="lp-form-error">账户读取失败，请重试。<button type="button" className="lp-secondary" onClick={() => void accounts.refetch()}>重试读取账户</button></p>}
    {accounts.data && choices.length < 2 && <p role="status" className="la-field-hint">转账需要两个不同的本人账户，请先新增账户。</p>}
    <label className="lp-amount-field"><span>转账金额<small>人民币</small></span><div><b>¥</b><input disabled={disabled} aria-label="转账金额" inputMode="decimal" placeholder="0.00" required value={amount} onChange={event => setAmount(event.target.value)} /></div></label>
    {fromBalance !== undefined && toBalance !== undefined && !overLimit && <div className="lt-balances" aria-label="转账后余额"><span>{source?.name}<strong>{balancesHidden ? '••••••' : formatCurrency(fromBalance)}</strong></span><ArrowRight size={16} /><span>{target?.name}<strong>{balancesHidden ? '••••••' : formatCurrency(toBalance)}</strong></span></div>}
    {overLimit && <p className="lp-form-error" role="status">操作后的账户余额超出允许范围，请调整金额。</p>}
    <TransactionDateTimeField disabled={disabled} value={time} onChange={setTime} />
    <label className="lp-field">交易备注<span className="lp-optional">选填</span><textarea disabled={disabled} aria-label="交易备注" rows={3} placeholder="添加备注" value={note} onChange={event => setNote(event.target.value)} /></label>
    <p className="lt-hint"><Link size={14} />将同时生成转出、转入两条关联流水。</p>
    {message && <p className="lp-form-error" role="alert">{message}</p>}
    <div className="lp-form-actions"><button type="button" className="lp-secondary" onClick={cancel}>取消</button><button type="submit" className="lp-primary" disabled={pending || (!frozen && choices.length < 2)}>{pending ? '正在转账…' : frozen ? '重试原请求' : '确认转账'}</button></div>
  </form>
}
