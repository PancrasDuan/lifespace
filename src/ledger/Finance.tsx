import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Plus, RefreshCw, Wallet, X } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useVerifiedIdentity } from '../auth/identity'
import { categoryLabel, ledgerCategories, ledgerCreateSchema, ledgerStatusLabels, type LedgerCreate, type LedgerEntry, type LedgerRefund } from '../shared/ledger'
import { LedgerError, readLedger, readLedgerDetail, saveLedger, saveRefund } from './api'
import { RefundForm } from './RefundForm'
import { formatCurrency, formatDateTime, fromDateTimeInput, toDateTimeInput, yuanToCents } from './time'
import { TransactionDateTimeField } from './TransactionDateTimeField'
import './finance.css'

function Amount({ entry, large = false }: { entry: LedgerEntry; large?: boolean }) {
  return <span className={`lp-amount ${entry.direction} ${large ? 'large' : ''}`}>{formatCurrency(entry.amountCents)}</span>
}
function Status({ entry }: { entry: LedgerEntry }) {
  return <span className={`lp-status ${entry.status}`}><Check size={11} />{ledgerStatusLabels[entry.status]}</span>
}
export function Finance() {
  const identity = useVerifiedIdentity()
  const queries = useQueryClient()
  const [page, setPage] = useState(1)
  const [panel, setPanel] = useState<{ kind: 'new'; session: string } | { kind: 'refund'; session: string; parent: LedgerEntry; remainingCents: number } | { kind: 'detail'; id: string } | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<(({ input: LedgerCreate; parentId?: undefined } | { input: LedgerRefund; parentId: string }) & { session: string; pending: boolean; message: string })[]>([])
  const [notice, setNotice] = useState(0)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(0), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  const inFlight = useRef(new Set<string>())
  useEffect(() => {
    const refresh = () => { if (!identity.signal.aborted) void queries.invalidateQueries({ queryKey: ['ledger', identity.ownerId] }) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [identity, queries])
  const entries = useQuery({ queryKey: ['ledger', identity.ownerId, 'entries', page], queryFn: ({ signal }) => readLedger(identity.ownerId, page, AbortSignal.any([signal, identity.signal])), retry: false, staleTime: 0 })
  const data = entries.data
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 30))
  const newEntry = () => setPanel({ kind: 'new', session: crypto.randomUUID() })
  function saved(session: string) {
    if (identity.signal.aborted) return
    setPanel(current => (current?.kind === 'new' || current?.kind === 'refund') && current.session === session ? null : current)
    setNotice(value => value + 1)
    setPage(1)
    void queries.invalidateQueries({ queryKey: ['ledger', identity.ownerId] })
  }
  async function submit(command: { input: LedgerCreate; parentId?: undefined } | { input: LedgerRefund; parentId: string }, session: string) {
    const { input } = command
    if (inFlight.current.has(input.requestId)) return
    inFlight.current.add(input.requestId)
    setUnconfirmed(current => current.map(item => item.input.requestId === input.requestId ? { ...item, pending: true } : item))
    try {
      if (command.parentId !== undefined) await saveRefund(identity.ownerId, command.parentId, command.input, identity.signal)
      else await saveLedger(identity.ownerId, command.input, identity.signal)
      if (identity.signal.aborted) return
      setUnconfirmed(current => current.filter(item => item.input.requestId !== input.requestId))
      saved(session)
    } catch (error) {
      if (!identity.signal.aborted && error instanceof LedgerError && error.code === 'SAVE_UNKNOWN')
        setUnconfirmed(current => [...current.filter(item => item.input.requestId !== input.requestId), { ...command, session, pending: false, message: error.message }])
      else setUnconfirmed(current => current.map(item => item.input.requestId === input.requestId ? { ...item, pending: false, message: error instanceof Error ? error.message : '保存失败' } : item))
      throw error
    } finally { inFlight.current.delete(input.requestId) }
  }
  return <AppLayout page="finance" className="finance-page lp-app lp-variant-a">
    <div className="lp-workspace">
      <header className="lp-page-header"><h1>账单流水<span>人民币</span></h1><button className="lp-primary" onClick={newEntry}><Plus size={17} />新建流水</button></header>
      {unconfirmed.filter(item => (panel?.kind !== 'new' && panel?.kind !== 'refund') || panel.session !== item.session).map(item => <div role="alert" className="lp-unknown" key={item.input.requestId}><span>{item.message}</span><button className="lp-secondary" disabled={item.pending} onClick={() => void submit(item, item.session).catch(() => {})}>{item.pending ? '正在重试…' : '重试原请求'}</button><button className="lp-secondary" onClick={() => void entries.refetch()}>查看最新流水</button></div>)}
      <section className="lp-table-surface" aria-label="账单流水">
        <div className="lp-top-toolbar"><div className="lp-filter-buttons"><button className="active" aria-pressed="true">全部时间</button></div><span className="lp-timezone"><CalendarDays size={14} />北京时间</span></div>
        <div className="lp-list-heading"><span>流水明细 <b>{data?.total ?? '—'}</b></span><button className="lp-refresh" onClick={() => void queries.invalidateQueries({ queryKey: ['ledger', identity.ownerId] })}><RefreshCw size={14} />刷新数据</button></div>
        {entries.isPending ? <p role="status" className="lp-feedback">正在读取流水…</p> : entries.isError ? <div role="alert" className="lp-feedback">读取失败，请重试。<button className="lp-secondary" onClick={() => void entries.refetch()}>重试读取</button></div> : data?.items.length ? <div className="lp-table-wrap"><table className="lp-table"><thead><tr>
          <th>交易时间</th><th>分类 / 备注</th><th>交易账户</th><th>收支类型</th><th>交易状态</th><th className="lp-numeric">交易金额</th><th><span className="lp-sr">查看详情</span></th>
        </tr></thead><tbody>{data.items.map(entry => <tr key={entry.id} onClick={() => setPanel({ kind: 'detail', id: entry.id })}>
          <td><time><strong>{formatDateTime(entry.occurredAt).slice(0, 10)}</strong><small>{formatDateTime(entry.occurredAt).slice(11)}</small></time></td>
          <td><button className="lp-cell-title" onClick={event => { event.stopPropagation(); setPanel({ kind: 'detail', id: entry.id }) }}>{categoryLabel(entry.categoryCode)}</button>{entry.parentEntryId && <span className="lp-refund-tag">退款</span>}<small className="lp-row-note">{entry.note || '—'}</small></td>
          <td><span className="lp-account"><CreditCard size={13} />{entry.accountName}</span></td>
          <td><span className={`lp-direction ${entry.direction}`}>{entry.direction === 'income' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{entry.direction === 'income' ? '收入' : '支出'}</span></td>
          <td><Status entry={entry} /></td><td className="lp-numeric"><Amount entry={entry} /></td><td><ChevronRight size={15} /></td>
        </tr>)}</tbody></table></div> : <div className="lp-empty"><Wallet size={30} strokeWidth={1.3} /><h3>暂无流水</h3><button className="lp-secondary" onClick={newEntry}><Plus size={15} />新建流水</button></div>}
        <footer className="lp-pagination"><span>{data?.total ? `${(page - 1) * 30 + 1}–${Math.min(page * 30, data.total)} / ${data.total} 条流水` : '0 条流水'}</span><div>
          <button aria-label="上一页" disabled={page === 1 || entries.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><span>{page} <i>/</i> {pageCount}</span>
          <button aria-label="下一页" disabled={page === pageCount || entries.isFetching} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></footer>
      </section>
    </div>
    {panel?.kind === 'new' && <LedgerModal title="新建流水" close={() => setPanel(null)} form><EntryForm key={panel.session} save={input => submit({ input }, panel.session)} cancel={() => setPanel(null)} /></LedgerModal>}
    {panel?.kind === 'refund' && <LedgerModal title="登记退款" close={() => setPanel(null)} form><RefundForm key={panel.session} parent={panel.parent} remainingCents={panel.remainingCents} save={input => submit({ input, parentId: panel.parent.id }, panel.session)} cancel={() => setPanel(null)} /></LedgerModal>}
    {panel?.kind === 'detail' && <LedgerModal title="流水详情" close={() => setPanel(null)}><EntryDetail id={panel.id} open={id => setPanel({ kind: 'detail', id })} refund={(parent, remainingCents) => setPanel({ kind: 'refund', parent, remainingCents, session: crypto.randomUUID() })} /></LedgerModal>}
    {!!notice && <div role="status" className="lp-toast"><Check size={15} />流水已记录</div>}
  </AppLayout>
}
export function LedgerModal({ title, children, close, form = false }: { title: string; children: ReactNode; close: () => void; form?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className={`lp-dialog ${form ? 'entry-card' : ''}`} aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><h2>{title}</h2><button aria-label="关闭" onClick={close}><X size={19} /></button></header>{children}
  </dialog>
}
function EntryDetail({ id, open, refund }: { id: string; open: (id: string) => void; refund: (parent: LedgerEntry, remainingCents: number) => void }) {
  const identity = useVerifiedIdentity()
  const detail = useQuery({ queryKey: ['ledger', identity.ownerId, 'detail', id], queryFn: ({ signal }) => readLedgerDetail(identity.ownerId, id, AbortSignal.any([signal, identity.signal])), retry: false })
  if (detail.isPending) return <p role="status" className="lp-feedback">正在读取详情…</p>
  if (detail.isError) return <div role="alert" className="lp-feedback">读取失败。<button className="lp-secondary" onClick={() => void detail.refetch()}>重试读取</button></div>
  const { entry, parentEntry, refunds } = detail.data
  return <div className="lp-detail"><div className="lp-detail-hero"><span>{entry.direction === 'income' ? '收入' : '支出'}{entry.parentEntryId ? ' · 退款' : ''} · {categoryLabel(entry.categoryCode)}</span><Amount entry={entry} large /><Status entry={entry} /></div>
    <dl className="lp-detail-fields"><div><dt>交易时间</dt><dd>{formatDateTime(entry.occurredAt)}</dd></div><div><dt>交易账户</dt><dd>{entry.accountName}</dd></div><div><dt>交易分类</dt><dd>{categoryLabel(entry.categoryCode)}</dd></div><div><dt>交易备注</dt><dd>{entry.note || '无备注'}</dd></div></dl>
    {parentEntry && <button className="lp-secondary" onClick={() => open(parentEntry.id)}>查看父流水</button>}
    {!!refunds.length && <section className="lp-related" aria-label="关联退款"><h3>关联退款</h3>{refunds.map(item => <button className="lp-related-entry" key={item.id} aria-label={`查看退款 ${formatCurrency(item.amountCents)} ${formatDateTime(item.occurredAt)}`} onClick={() => open(item.id)}><time>{formatDateTime(item.occurredAt)}</time><Amount entry={item} /><ChevronRight size={14} /></button>)}</section>}
    {entry.direction === 'expense' && !entry.parentEntryId && entry.status !== 'full-refund' && <div className="lp-form-actions"><button className="lp-primary" onClick={() => refund(entry, -entry.amountCents - refunds.reduce((total, item) => total + item.amountCents, 0))}>登记退款</button></div>}
  </div>
}
function EntryForm({ save, cancel }: { save: (input: LedgerCreate) => Promise<unknown>; cancel: () => void }) {
  const [direction, setDirection] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState(''), [time, setTime] = useState(toDateTimeInput), [account, setAccount] = useState(''), [category, setCategory] = useState(''), [note, setNote] = useState('')
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [uncertainInput, setUncertainInput] = useState<LedgerCreate>()
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    setError('')
    let input: LedgerCreate
    try {
      const cents = yuanToCents(amount)
      const parsed = ledgerCreateSchema.safeParse({ requestId: crypto.randomUUID(), direction, amountCents: direction === 'expense' ? -cents : cents, occurredAt: fromDateTimeInput(time), accountName: account, categoryCode: category, note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message)
      input = uncertainInput ?? parsed.data
      if (Date.parse(input.occurredAt) > Date.now()) throw new Error('交易时间不能晚于当前北京时间。')
    } catch (error) { setError(error instanceof Error ? error.message : '请检查输入'); return }
    submitting.current = true; setPending(true)
    try { await save(input) }
    catch (error) {
      if (error instanceof LedgerError && error.code === 'SAVE_UNKNOWN') setUncertainInput(input)
      setError(error instanceof Error ? error.message : '保存失败，请重试')
    }
    finally { submitting.current = false; setPending(false) }
  }
  return <form className="lp-entry-form" onSubmit={submit} noValidate>
    <div className="lp-direction-picker" aria-label="收支类型">{(['expense', 'income'] as const).map(value => <button disabled={pending || !!uncertainInput} type="button" key={value} aria-pressed={direction === value} className={direction === value ? 'active' : ''} onClick={() => { if (value !== direction) { setDirection(value); setCategory('') } }}>{value === 'expense' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}{value === 'expense' ? '支出' : '收入'}</button>)}</div>
    <label className="lp-amount-field"><span>交易金额<small>人民币</small></span><div><b>{direction === 'expense' ? '−' : '+'} ¥</b><input disabled={pending || !!uncertainInput} autoFocus aria-label="交易金额" inputMode="decimal" placeholder="0.00" required value={amount} onChange={event => setAmount(event.target.value)} /></div></label>
    <TransactionDateTimeField disabled={pending || !!uncertainInput} value={time} onChange={setTime} />
    <label className="lp-field">交易账户<input disabled={pending || !!uncertainInput} placeholder="招商储蓄卡" required value={account} onChange={event => setAccount(event.target.value)} /></label>
    <label className="lp-field">交易分类<select disabled={pending || !!uncertainInput} aria-label="交易分类" required value={category} onChange={event => setCategory(event.target.value)}><option value="" disabled>选择分类</option>{ledgerCategories[direction].map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label>
    <div className="lp-form-status"><span>交易状态</span><span><Check size={12} />已完成</span></div>
    <label className="lp-field">交易备注<span className="lp-optional">选填</span><textarea disabled={pending || !!uncertainInput} aria-label="交易备注" rows={3} placeholder="添加备注" value={note} onChange={event => setNote(event.target.value)} /></label>
    {error && <p className="lp-form-error" role="alert">{error}</p>}
    <div className="lp-form-actions"><button type="button" className="lp-secondary" onClick={cancel}>取消</button><button className="lp-primary" type="submit" disabled={pending}>{pending ? '正在保存…' : uncertainInput ? '重试原请求' : '保存流水'}</button></div>
  </form>
}
