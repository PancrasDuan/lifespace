import { useCallback, useEffect, useRef, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import { planningEnvelopeSchema, type PlanningCommand, type PlanningEnvelope, type PlanningPage, type PlanningPreview, type PlanningQuery } from '../shared/adventure-planning'
import type { StoredPlanningEnvelope } from '../shared/adventure-recovery'
import { planningApi, PlanningError } from './planning-api'
import { readTerminalPreference } from './planning-preferences'
import { clearPending, PendingBusyError, readPending, savePending, watchPending, withPendingLock } from './pending-command'

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
  const [storageReady, setStorageReady] = useState(false)
  const [readRequired, setReadRequired] = useState(true)
  const lifecycle = useRef(new AbortController())
  const active = useRef(false)
  const submitting = useRef(false)
  const current = useRef<PlanningPage | undefined>(undefined)
  const pending = useRef<StoredPlanningEnvelope | undefined>(undefined)
  // Only this mounted page's own new command can use the normal retry path.
  // A record loaded from storage always uses the read-only lookup.
  const pendingIsCurrent = useRef(false)
  const syncStorage = useRef<() => Promise<void>>(async () => {})
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
      await clearPending(identity.ownerId, envelope, AbortSignal.any([identity.signal, epoch.signal]))
      epoch.signal.throwIfAborted()
      identity.signal.throwIfAborted()
      minimumVersion.current = Math.max(minimumVersion.current, receipt.version)
      pending.current = undefined
      pendingIsCurrent.current = false
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
        try { await clearPending(identity.ownerId, envelope, AbortSignal.any([identity.signal, epoch.signal])); pending.current = undefined; pendingIsCurrent.current = false }
        catch { setUncertain(true); setError('无法确认本地保存状态，请保留此页面并稍后重试。'); return false }
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
    if (active.current || submitting.current || pending.current || !storageReady || readRequired || !current.current || current.current.version < minimumVersion.current) return false
    const parsed = planningEnvelopeSchema.safeParse({ requestId: crypto.randomUUID(), expectedVersion: expectedVersion ?? current.current.version, command })
    if (!parsed.success) { setError('提交内容无效，请检查后重试。'); return false }
    const envelope = parsed.data
    submitting.current = true
    try {
      return await withPendingLock(identity.ownerId, async () => {
        identity.signal.throwIfAborted()
        const prior = await readPending(identity.ownerId)
        if (prior) { pending.current = prior; pendingIsCurrent.current = false; setUncertain(true); setError('有一项操作的结果尚未确认，请先确认结果；如果仍无法确认，请联系管理员核对。'); return false }
        await savePending(identity.ownerId, envelope, AbortSignal.any([identity.signal, lifecycle.current.signal]))
        pendingOrigin.current = confirmationGeneration.current
        pending.current = envelope
        pendingIsCurrent.current = true
        return send(envelope)
      }, true)
    } catch (error) {
      if (identity.signal.aborted) return false
      if (error instanceof PendingBusyError) { setReadRequired(true); setError('另一页面正在处理操作，请稍后重新读取。') }
      else { setStorageReady(false); setUncertain(true); setError('浏览器无法安全保存操作，请检查浏览器存储后重试。') }
      return false
    } finally { submitting.current = false }
  }, [send, identity.ownerId, identity.signal, storageReady, readRequired])

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
    if (active.current || submitting.current) return
    if (!storageReady) { await syncStorage.current(); return }
    if (!pending.current) { await load(); return }
    const generation = pendingOrigin.current
    const envelope = pending.current
    let success = false
    submitting.current = true
    try {
      success = await withPendingLock(identity.ownerId, async () => {
        identity.signal.throwIfAborted()
        const stored = await readPending(identity.ownerId)
        if (!stored || JSON.stringify(stored) !== JSON.stringify(envelope)) throw new Error('Pending command changed')
        if (pendingIsCurrent.current) {
          const parsed = planningEnvelopeSchema.safeParse(stored)
          if (!parsed.success) throw new Error('Invalid current command')
          return send(parsed.data)
        }
        const epoch = lifecycle.current
        if (active.current) return false
        active.current = true; setBusy(true); setError('')
        try {
          const receipt = await planningApi.lookupReceipt(identity.ownerId, stored, signal())
          epoch.signal.throwIfAborted(); identity.signal.throwIfAborted()
          await clearPending(identity.ownerId, stored, AbortSignal.any([identity.signal, epoch.signal]))
          epoch.signal.throwIfAborted(); identity.signal.throwIfAborted()
          minimumVersion.current = Math.max(minimumVersion.current, receipt.version)
          pending.current = undefined; pendingIsCurrent.current = false; setUncertain(false)
          if (stored.command.type === 'achieveGoal') setLastAchievement(receipt.result.entityId)
          setNotice({ id: stored.requestId, message: receipt.result.message }); setReadRequired(true)
          try { await refresh(signal()) }
          catch { if (!epoch.signal.aborted && !identity.signal.aborted) setError('操作已成功，页面更新失败。请重新读取。') }
          return true
        } catch (failure) {
          if (!epoch.signal.aborted && !identity.signal.aborted) { setUncertain(true); setError(failure instanceof PlanningError ? failure.message : '无法确认本地保存状态，请保留此页面并稍后重试。') }
          return false
        } finally {
          if (lifecycle.current === epoch && !epoch.signal.aborted && !identity.signal.aborted) { active.current = false; setBusy(false) }
        }
      }, true)
    } catch (error) {
      if (!identity.signal.aborted) {
        setUncertain(true)
        setError(error instanceof PendingBusyError ? '另一页面正在处理操作，请稍后再次确认。' : '浏览器无法安全读取操作，请检查浏览器存储后重试。')
      }
    } finally { submitting.current = false }
    finishConfirmation(success, generation, saved)
    if (success) return envelope.command.type
  }

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    current.current = undefined
    pending.current = undefined
    pendingIsCurrent.current = false
    invalidateConfirmation()
    minimumVersion.current = 0
    query.current = initialQuery(readTerminalPreference(identity.ownerId))
    setLastAchievement(undefined)
    active.current = false
    setData(undefined)
    setError('')
    setNotice(undefined)
    setUncertain(false)
    setStorageReady(false)
    setReadRequired(true)
    const sync = async () => {
      try {
        const stored = await withPendingLock(identity.ownerId, () => readPending(identity.ownerId))
        if (controller.signal.aborted || identity.signal.aborted) return
        const prior = pending.current
        if (!prior || !stored || JSON.stringify(prior) !== JSON.stringify(stored)) pendingIsCurrent.current = false
        pending.current = stored
        setUncertain(Boolean(stored)); setStorageReady(true)
        if (stored) setError('有一项操作的结果尚未确认，请先确认结果；如果仍无法确认，请联系管理员核对。')
        else if (enabled && !current.current) void load()
        else if (prior) { setReadRequired(true); setError('操作已在另一页面处理，请重新读取。') }
      } catch {
        if (!controller.signal.aborted && !identity.signal.aborted) { setStorageReady(false); setUncertain(true); setReadRequired(true); setError('浏览器无法安全读取操作，请检查浏览器存储后重试。') }
      }
    }
    syncStorage.current = sync
    let stop = () => {}
    try { stop = watchPending(() => { setReadRequired(true); void sync() }) } catch { /* sync reports unavailable storage */ }
    void sync()
    return () => { controller.abort(); stop() }
  }, [load, enabled, invalidateConfirmation])

  const clearGoal = useCallback(() => { query.current = { ...query.current, goalId: undefined, goalTaskPage: 1, page: 1 } }, [])
  const canLoad = useCallback(() => !active.current && !pending.current, [])

  const blocked = busy || uncertain || readRequired || !storageReady
  const confirmation: PlanningConfirmation = {
    preview: confirmationPreview?.value,
    stale: !confirmationPreview || confirmationPreview.value.version !== data?.version,
    blocked, refresh: preview, confirm, invalidate: invalidateConfirmation,
  }
  return { lastAchievement, clearGoal, canLoad, data, busy, blocked, storageReady, recoveryLabel: pendingIsCurrent.current ? '安全重试同一次操作' : '确认上次操作结果', error, clearError, notice, clearNotice, uncertain, readRequired, command, load, confirmation, recover }
}
