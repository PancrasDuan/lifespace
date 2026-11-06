import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, ArrowUpRight, Eye, EyeOff, Pencil, Plus, Wallet } from 'lucide-react'
import { useVerifiedIdentity } from '../auth/identity'
import { ledgerAccountCreateSchema, ledgerAccountUpdateSchema } from '../shared/ledger'
import { readLedgerAccounts } from './api'
import { LedgerModal } from './LedgerModal'
import { useAccountSubmission } from './useAccountSubmission'
import './accounts.css'

const balanceText = (cents: number) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
function balanceInput(value: string) {
  const input = value.trim()
  if (!/^[+-]?\d+(\.\d{0,2})?$/.test(input)) throw new Error('金额格式有问题，请填写有效余额，最多保留两位小数。')
  const negative = input.startsWith('-'), [yuan, fraction = ''] = input.replace(/^[+-]/, '').split('.')
  const cents = BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents > 99_999_999_999n) throw new Error('余额须在 −999,999,999.99 至 999,999,999.99 元之间。')
  return { cents: Number(negative ? -cents : cents), formatted: `${input.split('.')[0]}.${fraction.padEnd(2, '0')}` }
}

export function BalanceVisibilityButton({ hidden, toggle }: { hidden: boolean; toggle: () => void }) {
  return <button type="button" className="la-visibility" aria-label={hidden ? '显示账户余额' : '隐藏账户余额'} onClick={toggle}>{hidden ? <Eye size={16} /> : <EyeOff size={16} />}<span>{hidden ? '显示余额' : '隐藏余额'}</span></button>
}

export function BalancePreferenceError() {
  return <p role="alert" className="la-conflict">无法保存余额显示设置，重新打开后可能恢复旧设置。请检查浏览器的网站数据设置。</p>
}

export function Accounts({ closeKey, onOpen, onTransfer, balancesHidden, toggleBalances, balancePreferenceError }: { closeKey: string | null; onOpen: () => void; onTransfer: (fromAccountId?: string) => void; balancesHidden: boolean; toggleBalances: () => void; balancePreferenceError: boolean }) {
  const identity = useVerifiedIdentity(), queries = useQueryClient()
  const accounts = useQuery({ queryKey: ['ledger', identity.ownerId, 'accounts'], queryFn: ({ signal }) => readLedgerAccounts(identity.ownerId, AbortSignal.any([signal, identity.signal])), retry: false, staleTime: 0, refetchOnWindowFocus: false })
  const [saved, setSaved] = useState(false)
  const submission = useAccountSubmission(() => {
    setSaved(true)
    void queries.invalidateQueries({ queryKey: ['ledger', identity.ownerId] })
  })
  const { close } = submission
  useEffect(() => { if (closeKey) close() }, [closeKey, close])
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 4500)
    return () => window.clearTimeout(timer)
  }, [saved])
  const openNew = () => { onOpen(); submission.open() }
  return <section aria-label="交易账户" className="la-accounts">
    <div className="la-section-heading"><h2>交易账户 <span>{accounts.data?.accounts.length ?? '—'}</span></h2><div className="la-heading-actions"><BalanceVisibilityButton hidden={balancesHidden} toggle={toggleBalances} /><button className="lp-secondary" onClick={() => onTransfer()}><ArrowRightLeft size={16} />账户转账</button><button className="lp-primary" onClick={openNew}><Plus size={17} />新增账户</button></div></div>
    {balancePreferenceError && <BalancePreferenceError />}
    {saved && <p role="status" className="la-feedback">账户已保存</p>}
    {submission.unconfirmed.map(session => <div role="alert" className="lp-unknown" key={session.key}><span>{session.message}</span><button className="lp-secondary" disabled={session.pending} onClick={() => { onOpen(); submission.resume(session.key); void submission.submit(session.key) }}>{session.pending ? '正在重试…' : '重试原账户请求'}</button><button className="lp-secondary" onClick={() => void accounts.refetch()}>查看最新账户</button></div>)}
    {accounts.isPending ? <p role="status" className="la-feedback">正在读取账户…</p> : accounts.isError ? <div role="alert" className="la-feedback">账户读取失败，请重试。<button className="lp-secondary" onClick={() => void accounts.refetch()}>重试读取账户</button></div> : accounts.data.accounts.length ? <div className="la-account-grid">{accounts.data.accounts.map(account => <article className={`la-account-card ${!balancesHidden && Math.abs(account.balanceCents) >= 10_000_000 ? 'la-wide-balance' : ''}`} key={account.id} aria-label={account.name}>
      <div className="la-card-heading"><span className="la-account-icon"><Wallet size={18} strokeWidth={1.65} /></span><h3 title={account.name}>{account.name}</h3><button className="la-edit" aria-label={`修改${account.name}`} onClick={() => { onOpen(); submission.open(account) }}><Pencil size={15} /></button></div>
      <p className="la-balance-label">当前余额</p><p className={`la-balance ${!balancesHidden && account.balanceCents < 0 ? 'negative' : ''}`}>{balancesHidden ? <span className="la-balance-mask" aria-label="余额已隐藏">••••••</span> : <><span>¥</span>{balanceText(account.balanceCents)}</>}</p>
      <button className="la-transfer" aria-label={`从${account.name}转账`} onClick={() => onTransfer(account.id)}>转账<ArrowUpRight size={13} /></button>
    </article>)}</div> : <div className="la-empty"><Wallet size={28} strokeWidth={1.5} /><h3>还没有交易账户</h3><p>添加银行卡、零钱或饭卡，并填写当前余额。</p><button className="lp-secondary" onClick={openNew}><Plus size={15} />新增账户</button></div>}
    {submission.form && <LedgerModal title={submission.form.account ? '修改账户' : '新增账户'} close={submission.close}><AccountForm key={submission.form.key} session={submission.form} submit={input => submission.submit(submission.form!.key, input)} cancel={submission.close} balancesHidden={balancesHidden} toggleBalances={toggleBalances} balancePreferenceError={balancePreferenceError} /></LedgerModal>}
  </section>
}

function AccountForm({ session, submit, cancel, balancesHidden, toggleBalances, balancePreferenceError }: { session: NonNullable<ReturnType<typeof useAccountSubmission>['form']>; submit: (read: () => ReturnType<typeof ledgerAccountCreateSchema.parse> | ReturnType<typeof ledgerAccountUpdateSchema.parse>) => Promise<void>; cancel: () => void; balancesHidden: boolean; toggleBalances: () => void; balancePreferenceError: boolean }) {
  const { account, pending, frozen, message, latestBalanceCents } = session
  const [name, setName] = useState(session.command?.input.name ?? account?.name ?? '')
  const [balance, setBalance] = useState(((session.command?.input.balanceCents ?? account?.balanceCents ?? 0) / 100).toFixed(2))
  const [balanceError, setBalanceError] = useState('')
  function formatBalance() {
    try {
      const value = balanceInput(balance)
      setBalance(value.formatted); setBalanceError('')
      return value.cents
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : '金额格式有问题，请检查余额。')
    }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    const cents = formatBalance()
    if (cents === undefined) return
    void submit(() => {
      const value = !account ? ledgerAccountCreateSchema.safeParse({ requestId: crypto.randomUUID(), name, balanceCents: cents }) : ledgerAccountUpdateSchema.safeParse({
        requestId: crypto.randomUUID(),
        ...(name.trim() !== account.name ? { name } : {}),
        ...(cents !== (latestBalanceCents ?? account.balanceCents) ? { balanceCents: cents, expectedBalanceCents: latestBalanceCents ?? account.balanceCents } : {}),
      })
      if (!value.success) throw new Error(value.error.issues[0]?.message)
      return value.data
    })
  }
  return <form className="la-form" onSubmit={save} noValidate>
    <label className="lp-field">账户名称<input aria-label="账户名称" data-initial-focus autoComplete="off" required disabled={pending || frozen} value={name} placeholder="例如：微信零钱" onChange={event => setName(event.target.value)} /><small>本人账户名称不能重复，最多 50 个字符。</small></label>
    <label className="lp-field">{account ? '当前余额' : '初始余额'}<span className="la-field-unit">人民币 · 元</span><input type={account && balancesHidden ? 'password' : 'text'} autoComplete="off" aria-label={account ? '当前余额' : '初始余额'} aria-describedby={balanceError ? 'la-balance-hint la-account-error' : 'la-balance-hint'} aria-invalid={!!balanceError} inputMode="decimal" required disabled={pending || frozen} value={balance} onChange={event => { setBalance(event.target.value); setBalanceError('') }} onBlur={() => { if (!pending && !frozen) formatBalance() }} /></label>
    {account && <BalanceVisibilityButton hidden={balancesHidden} toggle={toggleBalances} />}
    {account && balancePreferenceError && <BalancePreferenceError />}
    <p id="la-balance-hint" className="la-field-hint">允许零和负数，最多两位小数。{account && '手工修正余额不会生成收支流水。'}</p>
    {(balanceError || message) && <p id="la-account-error" role="alert" className="lp-form-error">{balanceError || message}</p>}
    {latestBalanceCents !== undefined && <p role="status" className="la-conflict">最新余额为 {balancesHidden ? '••••••' : `¥${balanceText(latestBalanceCents)}`}。已保留你的输入，请核对后再次保存。</p>}
    <div className="lp-form-actions"><button className="lp-secondary" type="button" onClick={cancel}>取消</button><button className="lp-primary" type="submit" disabled={pending}>{pending ? '正在保存…' : frozen ? '重试原请求' : account ? latestBalanceCents === undefined ? '保存修改' : '核对后保存修改' : '保存账户'}</button></div>
  </form>
}
