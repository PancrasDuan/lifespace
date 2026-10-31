// Selected throwaway prototype: A, the table layout.
// Refine centered task cards and a floating two-calendar date picker.
// Fictional in-memory data only; this is not the production finance page.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronLeft,
  ChevronRight, CreditCard, FlaskConical, House, Link2, ListTodo, LockKeyhole,
  Mountain, Newspaper, Plus, RotateCcw, Settings2, Target,
  Trash2, Wallet, X,
} from 'lucide-react'
import {
  beijingDateKey, categoryOptions, createEntry, createRefund, createSeedEntries, deleteEntry,
  filterEntries, formatCurrency, formatDateTime, fromDateTimeInput,
  getDateRange, getEntryStatus, getRefunds, refundedCents, statusLabels,
  toDateTimeInput, type DateFilter, type LedgerEntry,
} from './model'
import { DateRangePopover } from './DateRangePopover'
import { TransactionDateTimeField } from './TransactionDateTimeField'
import './ledger-prototype.css'

type Panel = { kind: 'detail' | 'refund' | 'delete'; id: string } | { kind: 'new' } | null
const filters: { value: DateFilter; label: string }[] = [
  { value: 'all', label: '全部时间' }, { value: 'today', label: '今天' },
  { value: 'week', label: '近 7 天' }, { value: 'month', label: '近 1 个月' },
  { value: 'custom', label: '自定义' },
]
function Amount({ entry, large = false }: { entry: LedgerEntry; large?: boolean }) {
  return <span className={`lp-amount ${entry.direction} ${large ? 'large' : ''}`}>{formatCurrency(entry.amountCents)}</span>
}
function Status({ entry, entries }: { entry: LedgerEntry; entries: LedgerEntry[] }) {
  const value = getEntryStatus(entry, entries)
  return <span className={`lp-status ${value}`}>{value === 'completed' && <Check size={11} />}{statusLabels[value]}</span>
}
function EntryIcon({ entry }: { entry: LedgerEntry }) {
  const Icon = entry.parentId ? RotateCcw : entry.direction === 'income' ? ArrowDownLeft : ArrowUpRight
  return <span className={`lp-entry-icon ${entry.direction}`}><Icon size={18} strokeWidth={1.7} /></span>
}

export function LedgerPrototype() {
  const [entries, setEntries] = useState(createSeedEntries)
  const [filter, setFilter] = useState<DateFilter>('all')
  const [start, setStart] = useState(getDateRange('month')!.start)
  const [end, setEnd] = useState(beijingDateKey())
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(() => entries.find(entry => getEntryStatus(entry, entries) === 'partial-refund')?.id ?? entries[0].id)
  const [panel, setPanel] = useState<Panel>(null)
  const [toast, setToast] = useState('')
  const [stateOpen, setStateOpen] = useState(false)
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null)
  const dateTrigger = useRef<HTMLButtonElement>(null)
  const visible = filterEntries(entries, filter, start, end)
  const pageCount = Math.max(1, Math.ceil(visible.length / 30))
  const pageEntries = visible.slice((page - 1) * 30, page * 30)
  const current = panel && panel.kind !== 'new' ? entries.find(entry => entry.id === panel.id && !entry.deletedAt) : undefined
  const custom = filter === 'custom' || filter === 'this-week' || filter === 'this-month'
  useEffect(() => { setPage(value => Math.min(value, pageCount)) }, [pageCount])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    console.info('Ledger A prototype', { filter, page, entries })
  }, [entries, filter, page])

  const closeCalendar = useCallback(() => { setDateAnchor(null); dateTrigger.current?.focus({ preventScroll: true }) }, [])
  function changeFilter(next: DateFilter) { setFilter(next); setPage(1); setDateAnchor(null) }
  function openEntry(entry: LedgerEntry) { setSelectedId(entry.id); setPanel({ kind: 'detail', id: entry.id }) }
  function saved(next: LedgerEntry[]) {
    setEntries(next)
    setSelectedId(next[next.length - 1].id)
    changeFilter('all')
    setPanel(null)
    setToast('流水已记录')
  }
  const filterControl = <div className="lp-filter-control">
    <div className="lp-filter-buttons" aria-label="交易日期筛选">{filters.map(item =>
      <button key={item.value} ref={item.value === 'custom' ? dateTrigger : undefined}
        id={item.value === 'custom' ? 'lp-custom-date-trigger' : undefined}
        className={(item.value === 'custom' ? custom : filter === item.value) ? 'active' : ''}
        aria-pressed={item.value === 'custom' ? custom : filter === item.value}
        aria-haspopup={item.value === 'custom' ? 'dialog' : undefined}
        aria-expanded={item.value === 'custom' ? !!dateAnchor : undefined}
        onClick={event => item.value === 'custom'
          ? setDateAnchor(dateAnchor ? null : event.currentTarget.getBoundingClientRect())
          : changeFilter(item.value)}>
        {item.value === 'custom' && <CalendarDays size={14} />}{item.label}{item.value === 'custom' && <ChevronDown size={12} />}
      </button>)}
      {custom && <span className="lp-applied-range">{start} 至 {end}</span>}
    </div>
  </div>
  const pagination = <footer className="lp-pagination">
    <span>{visible.length ? `${(page - 1) * 30 + 1}–${Math.min(page * 30, visible.length)} / ${visible.length} 条流水` : '0 条流水'}</span>
    <div><button aria-label="上一页" disabled={page === 1} onClick={() => { setPage(page - 1); window.scrollTo(0, 0) }}><ChevronLeft size={16} /></button>
      <span>{page} <i>/</i> {pageCount}</span>
      <button aria-label="下一页" disabled={page === pageCount} onClick={() => { setPage(page + 1); window.scrollTo(0, 0) }}><ChevronRight size={16} /></button></div>
  </footer>
  const detail = (entry: LedgerEntry) => <EntryDetail entry={entry} entries={entries}
    openEntry={id => { setSelectedId(id); setPanel({ kind: 'detail', id }) }}
    refund={() => setPanel({ kind: 'refund', id: entry.id })} remove={() => setPanel({ kind: 'delete', id: entry.id })} />

  return <div className="lifespace-app theme-light lp-app lp-variant-a">
    <aside className="sidebar" aria-label="主导航">
      <a className="brand-mark" href="/finance/prototype" aria-label="LifeSpace 原型首页"><img src="/favicon.svg" alt="" width={38} height={38} /></a>
      <nav>{[
        { title: '首页', icon: House }, { title: '新闻', icon: Newspaper },
        { title: '人生冒险', icon: Mountain }, { title: '任务管理', icon: ListTodo },
        { title: '个人目标', icon: Target }, { title: '财务', icon: Wallet },
      ].map(({ title, icon: Icon }) => <button key={title} className={`nav-item ${title === '财务' ? 'active' : ''}`}
        aria-current={title === '财务' ? 'page' : undefined} disabled={title !== '财务'}><Icon size={20} /><span>{title}</span></button>)}</nav>
      <div className="lp-sidebar-bottom"><Settings2 size={19} /><span>我</span></div>
    </aside>
    <main><div className="lp-workspace">
      <div className="lp-preview-note"><span><FlaskConical size={13} />原型 · 模拟数据</span>
        <div className="lp-preview-actions"><button onClick={() => setStateOpen(!stateOpen)} aria-expanded={stateOpen}>数据状态</button><button onClick={() => { const fresh = createSeedEntries(); setEntries(fresh); changeFilter('all'); setSelectedId(fresh.find(entry => getEntryStatus(entry, fresh) === 'partial-refund')!.id); setPanel(null); setToast('已重置演示数据') }}><RotateCcw size={12} />重置</button></div></div>
      <header className="lp-page-header"><div><h1>账单流水<span>人民币</span></h1></div>
        <button className="lp-primary" onClick={() => setPanel({ kind: 'new' })}><Plus size={17} />新建流水</button></header>

      <section className="lp-table-surface" aria-label="表格布局">
        <div className="lp-top-toolbar">{filterControl}<span className="lp-timezone"><CalendarDays size={14} />北京时间</span></div>
        <div className="lp-list-heading"><span>流水明细 <b>{visible.length}</b></span></div>
        {pageEntries.length ? <div className="lp-table-wrap"><table className="lp-table"><thead><tr>
          <th>交易时间</th><th>分类 / 备注</th><th>交易账户</th><th>收支类型</th><th>交易状态</th><th className="lp-numeric">交易金额</th><th><span className="lp-sr">查看详情</span></th>
        </tr></thead><tbody>{pageEntries.map(entry => <tr key={entry.id} onClick={() => openEntry(entry)}>
          <td><time><strong>{formatDateTime(entry.occurredAt).slice(0, 10)}</strong><small>{formatDateTime(entry.occurredAt).slice(11)}</small></time></td>
          <td><button className="lp-cell-title" onClick={event => { event.stopPropagation(); openEntry(entry) }}>{entry.category}</button>{entry.parentId && <span className="lp-refund-label">退款</span>}<small className="lp-row-note">{entry.note || '—'}</small></td>
          <td><span className="lp-account"><CreditCard size={13} />{entry.account}</span></td>
          <td><span className={`lp-direction ${entry.direction}`}>{entry.direction === 'income' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{entry.direction === 'income' ? '收入' : '支出'}</span></td>
          <td><Status entry={entry} entries={entries} /></td><td className="lp-numeric"><Amount entry={entry} /></td><td><ChevronRight size={15} /></td>
        </tr>)}</tbody></table></div> : <EmptyState newEntry={() => setPanel({ kind: 'new' })} />}{pagination}
      </section>

    </div></main>

    {panel?.kind === 'detail' && current && <ModalCard title="流水详情" close={() => setPanel(null)}>{detail(current)}</ModalCard>}
    {(panel?.kind === 'new' || (panel?.kind === 'refund' && current)) && <ModalCard title={panel.kind === 'new' ? '新建流水' : '登记退款'} close={() => setPanel(null)} form>
      <EntryForm key={panel.kind === 'refund' ? panel.id : 'new'} parent={panel.kind === 'refund' ? current : undefined} entries={entries} save={saved} cancel={() => setPanel(null)} />
    </ModalCard>}
    {panel?.kind === 'delete' && current && <ModalCard title="删除这条流水？" close={() => setPanel(null)} compact>
      <div className="lp-delete-content"><div className="lp-delete-preview"><span>{current.category}<small>{current.account} · {formatDateTime(current.occurredAt)}</small></span><Amount entry={current} /></div>
        <p>{getRefunds(current.id, entries).length ? `同时删除 ${getRefunds(current.id, entries).length} 条关联退款。` : ''}删除后无法恢复。</p>
        <div className="lp-form-actions"><button className="lp-secondary" onClick={() => setPanel(null)}>取消</button><button className="lp-danger" onClick={() => { setEntries(deleteEntry(entries, current.id)); setPanel(null); setToast('流水已删除') }}>确认删除</button></div>
      </div></ModalCard>}
    {toast && <div role="status" className="lp-toast"><Check size={15} />{toast}</div>}
    {dateAnchor && <DateRangePopover start={start} end={end} anchor={dateAnchor} trigger={dateTrigger.current} close={closeCalendar}
      apply={(nextStart, nextEnd) => { setStart(nextStart); setEnd(nextEnd); changeFilter('custom'); dateTrigger.current?.focus() }} />}
    {stateOpen && <section className="lp-state-panel"><header><strong>原型数据状态</strong><button aria-label="关闭数据状态" onClick={() => setStateOpen(false)}><X size={16} /></button></header>
      <pre>{JSON.stringify({ variant: 'A', filter, start, end, page, selectedId, entries }, null, 2)}</pre></section>}
  </div>
}

function EmptyState({ newEntry }: { newEntry: () => void }) {
  return <div className="lp-empty"><Wallet size={30} strokeWidth={1.3} /><h3>暂无流水</h3><button className="lp-secondary" onClick={newEntry}><Plus size={15} />新建流水</button></div>
}

function EntryDetail({ entry, entries, openEntry, refund, remove }: { entry: LedgerEntry; entries: LedgerEntry[]; openEntry: (id: string) => void; refund: () => void; remove: () => void }) {
  const parent = entries.find(item => item.id === entry.parentId && !item.deletedAt)
  const refunds = getRefunds(entry.id, entries)
  const remaining = Math.abs(entry.amountCents) - refundedCents(entry.id, entries)
  return <div className="lp-detail"><div className="lp-detail-hero"><EntryIcon entry={entry} /><span>{entry.parentId ? '退款收入' : entry.direction === 'income' ? '收入' : '支出'} · {entry.category}</span>
    <Amount entry={entry} large /><Status entry={entry} entries={entries} /></div>
    <dl className="lp-detail-fields"><div><dt>交易时间</dt><dd>{formatDateTime(entry.occurredAt)}</dd></div>
      <div><dt>交易账户</dt><dd>{entry.account}</dd></div><div><dt>交易分类</dt><dd>{entry.category}</dd></div>
      <div><dt>交易备注</dt><dd>{entry.note || '无备注'}</dd></div></dl>
    {parent && <section className="lp-related"><h3><Link2 size={14} />关联原支出</h3><button onClick={() => openEntry(parent.id)}><div><strong>{parent.category}<Amount entry={parent} /></strong><span>{formatDateTime(parent.occurredAt)}</span></div><ChevronRight size={15} /></button></section>}
    {!entry.parentId && entry.direction === 'expense' && <section className="lp-related"><h3><RotateCcw size={14} />关联退款<span>{refunds.length} 笔</span></h3>
      {refunds.length ? refunds.map(item => <button key={item.id} onClick={() => openEntry(item.id)}><div><strong>退款<Amount entry={item} /></strong><span>{formatDateTime(item.occurredAt)}</span></div><ChevronRight size={15} /></button>) : <p>暂无退款</p>}</section>}
    <div className="lp-detail-actions">{entry.direction === 'expense' && !entry.parentId && remaining > 0 && <button className="lp-primary" onClick={refund}><RotateCcw size={15} />登记退款</button>}
      <button className="lp-delete-button" onClick={remove}><Trash2 size={14} />删除流水</button></div>
  </div>
}

function ModalCard({ title, children, close, compact = false, form = false }: { title: string; children: ReactNode; close: () => void; compact?: boolean; form?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className={`lp-dialog ${compact ? 'compact' : ''} ${form ? 'entry-card' : ''}`} aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><h2>{title}</h2><button aria-label="关闭" onClick={close}><X size={19} /></button></header>{children}
  </dialog>
}

function EntryForm({ parent, entries, save, cancel }: { parent?: LedgerEntry; entries: LedgerEntry[]; save: (next: LedgerEntry[]) => void; cancel: () => void }) {
  const [direction, setDirection] = useState<'income' | 'expense'>(parent ? 'income' : 'expense')
  const [amount, setAmount] = useState('')
  const [time, setTime] = useState(toDateTimeInput())
  const [account, setAccount] = useState(parent?.account ?? '')
  const [category, setCategory] = useState(parent?.category ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const remaining = parent ? Math.abs(parent.amountCents) - refundedCents(parent.id, entries) : 0
  function changeDirection(next: 'income' | 'expense') {
    if (next === direction) return
    setDirection(next)
    setCategory('')
    setError('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) throw new Error('请填写有效金额，最多保留两位小数。')
      const amountCents = Math.round(Number(amount) * 100) * (direction === 'expense' ? -1 : 1)
      const occurredAt = fromDateTimeInput(time)
      save(parent ? createRefund(entries, parent.id, { amountCents, occurredAt, note }) : createEntry(entries, { amountCents, occurredAt, account, category, direction, note }))
    } catch (caught) { setError((caught as Error).message) }
  }
  return <form className="lp-entry-form" onSubmit={submit}>
    {parent ? <div className="lp-form-parent"><Link2 size={15} /><div>原支出<strong>{parent.category} · {formatCurrency(parent.amountCents)}</strong><span>可退 {formatCurrency(remaining, false)}</span></div></div>
      : <div className="lp-direction-picker" aria-label="收支类型"><button type="button" aria-pressed={direction === 'expense'} className={direction === 'expense' ? 'active' : ''} onClick={() => changeDirection('expense')}><ArrowUpRight size={15} />支出</button><button type="button" aria-pressed={direction === 'income'} className={direction === 'income' ? 'active' : ''} onClick={() => changeDirection('income')}><ArrowDownLeft size={15} />收入</button></div>}
    <label className="lp-amount-field"><span>{parent ? '退款金额' : '交易金额'}<small>人民币</small></span><div><b>{direction === 'expense' ? '−' : '+'} ¥</b><input autoFocus aria-label={parent ? '退款金额' : '交易金额'} inputMode="decimal" placeholder="0.00" required value={amount} onChange={event => setAmount(event.target.value)} /></div></label>
    <TransactionDateTimeField value={time} onChange={setTime} min={parent ? toDateTimeInput(parent.occurredAt) : undefined} />
    <label className="lp-field">交易账户{parent && <span className="lp-inherited"><LockKeyhole size={11} /></span>}<input placeholder="招商储蓄卡" required readOnly={!!parent} value={account} onChange={event => setAccount(event.target.value)} /></label>
    <label className="lp-field">交易分类{parent && <span className="lp-inherited"><LockKeyhole size={11} /></span>}
      {parent ? <input readOnly required value={category} /> : <select required value={category} onChange={event => setCategory(event.target.value)}>
        <option value="" disabled>选择分类</option>
        {categoryOptions[direction].map(value => <option value={value} key={value}>{value}</option>)}
      </select>}
    </label>
    <div className="lp-form-status"><span>交易状态</span><span><Check size={12} />已完成</span></div>
    <label className="lp-field">交易备注<span className="lp-optional">选填</span><textarea placeholder="添加备注" rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
    {error && <p className="lp-form-error" role="alert">{error}</p>}
    <div className="lp-form-actions"><button type="button" className="lp-secondary" onClick={cancel}>取消</button><button className="lp-primary" type="submit">{parent ? '记录退款' : '保存流水'}</button></div>
  </form>
}
