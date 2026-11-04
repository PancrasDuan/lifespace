import { useMemo, useRef, useSyncExternalStore } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { LedgerCreate, LedgerEntry, LedgerRefund, LedgerTransfer } from '../shared/ledger'
import { LedgerError, saveLedger, saveRefund, saveTransfer } from './api'

export type FormSubmission<Input> = {
  pending: boolean
  frozen: boolean
  message: string
  submit: (readInput: () => Input) => Promise<void>
}
type Command = { kind: 'new'; input: LedgerCreate } | { kind: 'refund'; input: LedgerRefund; parentId: string } | { kind: 'transfer'; input: LedgerTransfer }
type Session = { key: string; pending: boolean; frozen: boolean; message: string; command?: Command }
type Form = { kind: 'transfer'; key: string; fromAccountId?: string; submission: FormSubmission<LedgerTransfer> }
  | { kind: 'new'; key: string; submission: FormSubmission<LedgerCreate> }
  | { kind: 'refund'; key: string; parent: LedgerEntry; remainingCents: number; submission: FormSubmission<LedgerRefund> }
type Unconfirmed = { key: string; pending: boolean; message: string; retry: () => Promise<void> }
type Snapshot = { form: Form | null; unconfirmed: Unconfirmed[] }

// One page owns the request and its form together. Closing a form leaves only
// in-flight or unconfirmed requests in memory; nothing survives leaving the page.
export function createLedgerSubmission(owner: string, signal: AbortSignal, onSaved: () => void) {
  const listeners = new Set<() => void>()
  const sessions = new Set<Session>()
  let current: { session: Session; view: () => Form } | null = null
  let snapshot: Snapshot = { form: null, unconfirmed: [] }
  function publish() {
    for (const session of sessions) {
      if (session !== current?.session && !session.pending && !session.frozen) sessions.delete(session)
    }
    snapshot = {
      form: current?.view() ?? null,
      unconfirmed: [...sessions].filter(session => session.frozen && session !== current?.session).map(session => ({
        key: session.key, pending: session.pending, message: session.message,
        retry: () => submit(session),
      })),
    }
    for (const listener of listeners) listener()
  }
  async function submit(session: Session, readCommand?: () => Command) {
    if (signal.aborted || session.pending || !sessions.has(session)) return
    session.message = ''
    try {
      // The form is read only for a new attempt. An unknown result always keeps
      // the original request ID, payload and refund parent, even after closing.
      session.command ??= structuredClone(readCommand!())
    } catch (error) {
      session.message = error instanceof Error ? error.message : '请检查输入'
      publish()
      return
    }
    session.pending = true
    publish()
    const command = session.command
    try {
      if (command.kind === 'refund') await saveRefund(owner, command.parentId, command.input, signal)
      else if (command.kind === 'transfer') await saveTransfer(owner, command.input, signal)
      else await saveLedger(owner, command.input, signal)
    } catch (error) {
      if (!signal.aborted) {
        session.frozen ||= error instanceof LedgerError && error.code === 'SAVE_UNKNOWN'
        session.message = error instanceof Error ? error.message : '保存失败，请重试'
        if (!session.frozen) session.command = undefined
      }
      return
    } finally {
      session.pending = false
      if (!signal.aborted) publish()
    }
    if (signal.aborted) return
    sessions.delete(session)
    if (current?.session === session) current = null
    publish()
    // A successful write is settled before the page starts reading again.
    onSaved()
  }
  function createForm<Input>(command: (input: Input) => Command) {
    const session: Session = { key: crypto.randomUUID(), pending: false, frozen: false, message: '' }
    sessions.add(session)
    const send = (readInput: () => Input) => submit(session, () => command(readInput()))
    return { session, view: (): FormSubmission<Input> => ({
      pending: session.pending, frozen: session.frozen, message: session.message, submit: send,
    }) }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    openNew() {
      const form = createForm<LedgerCreate>(input => ({ kind: 'new', input }))
      current = { session: form.session, view: () => ({ kind: 'new', key: form.session.key, submission: form.view() }) }
      publish()
    },
    openTransfer(fromAccountId?: string) {
      const form = createForm<LedgerTransfer>(input => ({ kind: 'transfer', input }))
      current = { session: form.session, view: () => ({ kind: 'transfer', key: form.session.key, fromAccountId, submission: form.view() }) }
      publish()
    },
    openRefund(parent: LedgerEntry, remainingCents: number) {
      const form = createForm<LedgerRefund>(input => ({ kind: 'refund', input, parentId: parent.id }))
      current = { session: form.session, view: () => ({ kind: 'refund', key: form.session.key, parent, remainingCents, submission: form.view() }) }
      publish()
    },
    close() { current = null; publish() },
  }
}

export function useLedgerSubmission(onSaved: () => void) {
  const identity = useVerifiedIdentity()
  const saved = useRef(onSaved)
  saved.current = onSaved
  const submission = useMemo(() => createLedgerSubmission(identity.ownerId, identity.signal, () => saved.current()), [identity.ownerId, identity.signal])
  return { ...useSyncExternalStore(submission.subscribe, submission.getSnapshot), ...submission }
}
