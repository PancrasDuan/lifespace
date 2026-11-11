import { useCallback, useEffect, useRef, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningEnvelope, PlanningPage, PlanningPreview, PlanningQuery } from '../shared/adventure-planning'
import { planningApi, PlanningError } from './planning-api'
import { readTerminalPreference } from './planning-preferences'

const initialQuery = (includeTerminal = false): PlanningQuery => ({ page: 1, taskRange: 'today', taskPage: 1, taskScope: 'all', search: '', goalTaskPage: 1,
  goalId: new URLSearchParams(window.location.search).get('goalId') ?? undefined,
  includeTerminal })

type ConfirmationCommand = Extract<PlanningCommand, { type: 'endGoal' | 'deleteTask' | 'achieveGoal' | 'rescheduleTask' | 'cancelTaskCompletion' }>
type ConfirmationPreview = { command: ConfirmationCommand; value: PlanningPreview }
export type PlanningConfirmation = {
  preview?: PlanningPreview; stale: boolean; blocked: boolean;
  refresh: (command?: ConfirmationCommand, ready?: () => void) => Promise<void>;
  confirm: (command: ConfirmationCommand, saved: () => void) => Promise<void>;
  invalidate: () => void;
}

function matchesPreview(command: ConfirmationCommand, preview: PlanningPreview) {
  if (command.type === 'cancelTaskCompletion') return 'completionId' in preview && preview.completionId === command.completionId
  if (!('operation' in preview) || preview.operation !== command.type) return false
  if (command.type === 'achieveGoal') return 'goalId' in preview && preview.goalId === command.id
  if (command.type === 'rescheduleTask') return 'taskId' in preview && preview.taskId === command.id && preview.newPlannedOn === command.plannedOn
  return 'entityId' in preview && preview.entityId === command.id
}

export function usePlanning(enabled = true) {
  const identity = useVerifiedIdentity()
  const [data, setData] = useState<PlanningPage>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clearError = useCallback(() => setError(''), [])
  const [lastAchievement, setLastAchievement] = useState<string>()
  const [notice, setNotice] = useState<{ id: string; message: string }>()
  const clearNotice = useCallback(() => setNotice(undefined), [])
  const [uncertain, setUncertain] = useState(false)
  const [readRequired, setReadRequired] = useState(true)
  const lifecycle = useRef(new AbortController())
  const active = useRef(false)
  const current = useRef<PlanningPage | undefined>(undefined)
  const pending = useRef<PlanningEnvelope | undefined>(undefined)
  // A retry keeps its original UI origin even if that view has since closed.
  const pendingOrigin = useRef(0)
  const confirmationGeneration = useRef(0)
  const currentPreview = useRef<ConfirmationPreview | undefined>(undefined)
  const [confirmationPreview, setConfirmationPreview] = useState<ConfirmationPreview>()
  const invalidateConfirmation = useCallback(() => {
    confirmationGeneration.current++
    currentPreview.current = undefined
    setConfirmationPreview(undefined)
  }, [])
  const minimumVersion = useRef(0)
  const query = useRef<PlanningQuery>(initialQuery(readTerminalPreference(identity.ownerId)))
  const signal = () => AbortSignal.any([lifecycle.current.signal, identity.signal, AbortSignal.timeout(15_000)])

  const refresh = useCallback(async (requestSignal = signal()) => {
    const result = await planningApi.load(identity.ownerId, query.current, requestSignal)
    requestSignal.throwIfAborted()
    if (result.version < minimumVersion.current) throw new PlanningError('数据尚未更新到已保存版本，请重新读取', 409)
    minimumVersion.current = result.version
    current.current = result
    setData(result)
    setReadRequired(false)
  }, [identity.ownerId, identity.signal])

  const load = useCallback(async (filters: Partial<PlanningQuery> = {}) => {
    if (active.current || pending.current) return
    // Keep requested filters for safe read recovery after a failed query.
    query.current = { ...query.current, ...filters }
    const epoch = lifecycle.current
    active.current = true
    setBusy(true)
    setError('')
    try { await refresh(signal()) }
    catch { if (!epoch.signal.aborted && !identity.signal.aborted) { setReadRequired(true); setError('暂时无法读取人生冒险，请检查连接后重新读取。') } }
    finally { if (lifecycle.current === epoch && !epoch.signal.aborted) { active.current = false; setBusy(false) } }
  }, [refresh, identity.signal])

  const send = useCallback(async (envelope: PlanningEnvelope) => {
    if (active.current) return false
    const epoch = lifecycle.current
    const requestSignal = signal()
    active.current = true
    setBusy(true)
    setError('')
    try {
      const receipt = await planningApi.send(identity.ownerId, envelope, requestSignal)
      epoch.signal.throwIfAborted()
      identity.signal.throwIfAborted()
      minimumVersion.current = Math.max(minimumVersion.current, receipt.version)
      pending.current = undefined
      if (envelope.command.type === 'achieveGoal') setLastAchievement(receipt.result.entityId)
      setUncertain(false)
      setNotice({ id: envelope.requestId, message: receipt.result.message })
      setReadRequired(true)
      try { await refresh(requestSignal) }
      catch { if (!epoch.signal.aborted && !identity.signal.aborted) setError('操作已成功，页面更新失败。请重新读取。') }
      return true
    } catch (failure) {
      if (epoch.signal.aborted || identity.signal.aborted) return false
      const fault = failure instanceof PlanningError ? failure : new PlanningError('保存结果未知，请安全重试', 0, true)
      setUncertain(fault.uncertain)
      setError(fault.message)
      if (!fault.uncertain) {
        pending.current = undefined
        if (fault.status === 409) {
          try { await refresh(requestSignal); setError('数据已更新，请检查最新内容后再次确认原操作。') }
          catch { setReadRequired(true); setError('数据已更新，但重新读取失败，请先重新读取。') }
        }
      }
      return false
    } finally {
      if (lifecycle.current === epoch && !epoch.signal.aborted && !identity.signal.aborted) { active.current = false; setBusy(false) }
    }
  }, [identity.ownerId, identity.signal, refresh])

  const command = useCallback(async (command: PlanningCommand, expectedVersion?: number) => {
    if (active.current || pending.current || !current.current || current.current.version < minimumVersion.current) return false
    const envelope = { requestId: crypto.randomUUID(), expectedVersion: expectedVersion ?? current.current.version, command }
    pendingOrigin.current = confirmationGeneration.current
    pending.current = envelope
    return send(envelope)
  }, [send])

  const preview = useCallback(async (command = currentPreview.current?.command, ready?: () => void) => {
    if (!command) return
    if (active.current || pending.current || !current.current || readRequired) return
    const epoch = lifecycle.current
    const generation = ++confirmationGeneration.current
    const requestSignal = signal()
    active.current = true
    setBusy(true)
    setError('')
    try {
      const result = await planningApi.preview(identity.ownerId, current.current.version, command, requestSignal)
      requestSignal.throwIfAborted()
      if (result.version !== current.current.version) throw new PlanningError('数据已更新，请重新读取后预览', 409)
      if (!matchesPreview(command, result)) throw new PlanningError('预览内容与当前操作不符，请重新预览', 502)
      if (generation !== confirmationGeneration.current) return
      const next = { command, value: result }
      currentPreview.current = next
      setConfirmationPreview(next)
      ready?.()
    } catch (failure) {
      if (!epoch.signal.aborted && !identity.signal.aborted && generation === confirmationGeneration.current) {
        setError(failure instanceof PlanningError ? failure.message : '暂时无法预览，请重试')
        if (failure instanceof PlanningError && failure.status === 409) {
          try { await refresh(requestSignal) } catch { setReadRequired(true) }
        }
      }
    } finally {
      if (lifecycle.current === epoch && !epoch.signal.aborted && !identity.signal.aborted) { active.current = false; setBusy(false) }
    }
  }, [identity.ownerId, identity.signal, readRequired, refresh])

  const finishConfirmation = useCallback((saved: boolean, generation: number, onSaved: () => void) => {
    if (!saved || generation !== confirmationGeneration.current || lifecycle.current.signal.aborted || identity.signal.aborted) return
    invalidateConfirmation()
    onSaved()
  }, [invalidateConfirmation, identity.signal])

  const confirm = useCallback(async (action: ConfirmationCommand, saved: () => void) => {
    const shown = currentPreview.current
    if (!shown || readRequired || !current.current || shown.value.version !== current.current.version || !matchesPreview(action, shown.value)) return
    const generation = confirmationGeneration.current
    finishConfirmation(await command(action, shown.value.version), generation, saved)
  }, [command, readRequired, finishConfirmation])

  const recover = async (saved: () => void) => {
    if (!pending.current) { await load(); return }
    const generation = pendingOrigin.current
    const envelope = pending.current
    const success = await send(envelope)
    finishConfirmation(success, generation, saved)
    if (success) return envelope.command.type
  }

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    lifecycle.current = controller
    current.current = undefined
    pending.current = undefined
    invalidateConfirmation()
    minimumVersion.current = 0
    query.current = initialQuery(readTerminalPreference(identity.ownerId))
    setLastAchievement(undefined)
    active.current = false
    setData(undefined)
    setError('')
    setNotice(undefined)
    setUncertain(false)
    setReadRequired(true)
    void load()
    return () => controller.abort()
  }, [load, enabled, invalidateConfirmation])

  const clearGoal = useCallback(() => { query.current = { ...query.current, goalId: undefined, goalTaskPage: 1, page: 1 } }, [])

  const blocked = busy || uncertain || readRequired
  const confirmation: PlanningConfirmation = {
    preview: confirmationPreview?.value,
    stale: !confirmationPreview || confirmationPreview.value.version !== data?.version,
    blocked, refresh: preview, confirm, invalidate: invalidateConfirmation,
  }
  return { lastAchievement, clearGoal, data, busy, blocked, error, clearError, notice, clearNotice, uncertain, readRequired, command, load, confirmation, recover }
}
