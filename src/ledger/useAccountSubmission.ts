import { useMemo, useRef, useSyncExternalStore } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import { ledgerAccountCreateSchema, type LedgerAccount, type LedgerAccountCreate, type LedgerAccountUpdate } from '../shared/ledger'
import { LedgerError, readLedgerAccounts, saveLedgerAccount } from './api'

type Command = { id?: undefined; input: LedgerAccountCreate } | { id: string; input: LedgerAccountUpdate }
type Session = { key: string; account?: LedgerAccount; command?: Command; pending: boolean; frozen: boolean; message: string; latestBalanceCents?: number }
type Snapshot = { form: Session | null; unconfirmed: Session[] }

// Commands stay in this page only. A retry uses the original input, including
// the expected balance; an acknowledged conflict starts a new request instead.
function accountSubmission(owner: string, signal: AbortSignal, onSaved: () => void) {
  const listeners = new Set<() => void>(), sessions = new Set<Session>()
  let current: Session | null = null
  let snapshot: Snapshot = { form: null, unconfirmed: [] }
  function publish() {
    for (const session of sessions) if (session !== current && !session.pending && !session.frozen) sessions.delete(session)
    snapshot = { form: current ? { ...current } : null, unconfirmed: [...sessions].filter(session => session !== current && session.frozen).map(session => ({ ...session })) }
    for (const listener of listeners) listener()
  }
  async function submit(key: string, readInput?: () => LedgerAccountCreate | LedgerAccountUpdate) {
    const session = [...sessions].find(session => session.key === key)
    if (!session || session.pending || signal.aborted) return
    session.message = ''
    try {
      if (!session.command) {
        const input = structuredClone(readInput!())
        session.command = session.account ? { id: session.account.id, input } : { input: ledgerAccountCreateSchema.parse(input) }
      }
    } catch (error) {
      session.message = error instanceof Error ? error.message : '请检查账户输入'
      publish(); return
    }
    session.pending = true; publish()
    try {
      await saveLedgerAccount(owner, session.command.input, signal, session.command.id)
    } catch (error) {
      if (!signal.aborted) {
        // A known rejection settles the formerly unknown attempt. In particular,
        // BALANCE_CHANGED means the correction was not recorded, so it can be rechecked.
        session.frozen = error instanceof LedgerError && error.code === 'SAVE_UNKNOWN'
        session.message = error instanceof Error ? error.message : '保存失败，请重试'
        if (!session.frozen) session.command = undefined
        if (error instanceof LedgerError && error.code === 'BALANCE_CHANGED') {
          try {
            const latest = (await readLedgerAccounts(owner, signal)).accounts.find(account => account.id === session.account?.id)
            if (latest) session.latestBalanceCents = latest.balanceCents
          } catch { session.message = '余额已变化，暂时无法读取最新余额，请重试以重新核对' }
        }
      }
      return
    } finally {
      session.pending = false
      if (!signal.aborted) publish()
    }
    if (signal.aborted) return
    sessions.delete(session)
    if (current === session) current = null
    publish(); onSaved()
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    open(account?: LedgerAccount) {
      current = { key: crypto.randomUUID(), account, pending: false, frozen: false, message: '' }
      sessions.add(current); publish()
    },
    resume(key: string) {
      const session = [...sessions].find(session => session.key === key)
      if (!session || signal.aborted) return
      current = session; publish()
    },
    close() { current = null; publish() },
    submit,
  }
}

export function useAccountSubmission(onSaved: () => void) {
  const identity = useVerifiedIdentity(), saved = useRef(onSaved)
  saved.current = onSaved
  const submission = useMemo(() => accountSubmission(identity.ownerId, identity.signal, () => saved.current()), [identity.ownerId, identity.signal])
  return { ...useSyncExternalStore(submission.subscribe, submission.getSnapshot), ...submission }
}
