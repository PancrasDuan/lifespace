import { useCallback, useEffect, useRef, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningEnvelope, PlanningPage, TaskRange, TaskScope } from '../shared/adventure-planning'
import { planningApi, PlanningError } from './planning-api'

export function usePlanning() {
  const identity = useVerifiedIdentity()
  const [data, setData] = useState<PlanningPage>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clearError = useCallback(() => setError(''), [])
  const [notice, setNotice] = useState<{ id: string; message: string }>()
  const clearNotice = useCallback(() => setNotice(undefined), [])
  const [uncertain, setUncertain] = useState(false)
  const [readRequired, setReadRequired] = useState(true)
  const lifecycle = useRef(new AbortController())
  const active = useRef(false)
  const current = useRef<PlanningPage | undefined>(undefined)
  const pending = useRef<PlanningEnvelope | undefined>(undefined)
  const minimumVersion = useRef(0)
  const page = useRef(1)
  const taskRange = useRef<TaskRange>('today')
  const taskPage = useRef(1)
  const taskScope = useRef<TaskScope>('all')
  const search = useRef('')
  const signal = () => AbortSignal.any([lifecycle.current.signal, identity.signal, AbortSignal.timeout(15_000)])

  const refresh = useCallback(async (nextPage = page.current, requestSignal = signal(), nextRange = taskRange.current, nextTaskPage = taskPage.current, nextScope = taskScope.current, nextSearch = search.current) => {
    const result = await planningApi.load(identity.ownerId, nextPage, requestSignal, nextRange, nextTaskPage, nextScope, nextSearch)
    requestSignal.throwIfAborted()
    if (result.version < minimumVersion.current) throw new PlanningError('数据尚未更新到已保存版本，请重新读取', 409)
    minimumVersion.current = result.version
    current.current = result
    page.current = nextPage
    taskRange.current = nextRange
    taskPage.current = nextTaskPage
    taskScope.current = nextScope
    search.current = nextSearch
    setData(result)
    setReadRequired(false)
  }, [identity.ownerId, identity.signal])

  const load = useCallback(async (nextPage = page.current, nextRange = taskRange.current, nextTaskPage = taskPage.current, nextScope = taskScope.current, nextSearch = search.current) => {
    if (active.current || pending.current) return
    // Preserve the requested filters when a read fails so recovery retries that query.
    page.current = nextPage
    taskRange.current = nextRange
    taskPage.current = nextTaskPage
    taskScope.current = nextScope
    search.current = nextSearch
    const epoch = lifecycle.current
    active.current = true
    setBusy(true)
    setError('')
    try { await refresh(nextPage, signal(), nextRange, nextTaskPage, nextScope, nextSearch) }
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
      setUncertain(false)
      setNotice({ id: envelope.requestId, message: receipt.result.message })
      setReadRequired(true)
      try { await refresh(page.current, requestSignal) }
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
          try { await refresh(page.current, requestSignal); setError('数据已更新，请检查最新内容后再次确认原操作。') }
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
    pending.current = envelope
    return send(envelope)
  }, [send])

  const preview = useCallback(async (command: PlanningCommand) => {
    if (active.current || pending.current || !current.current || readRequired) return
    const epoch = lifecycle.current
    const requestSignal = signal()
    active.current = true
    setBusy(true)
    setError('')
    try {
      const result = await planningApi.preview(identity.ownerId, current.current.version, command, requestSignal)
      requestSignal.throwIfAborted()
      if (result.version !== current.current.version) throw new PlanningError('数据已更新，请重新读取后预览', 409)
      return result
    } catch (failure) {
      if (!epoch.signal.aborted && !identity.signal.aborted) {
        setError(failure instanceof PlanningError ? failure.message : '暂时无法预览，请重试')
        if (failure instanceof PlanningError && failure.status === 409) {
          try { await refresh(page.current, requestSignal) } catch { setReadRequired(true) }
        }
      }
    } finally {
      if (lifecycle.current === epoch && !epoch.signal.aborted && !identity.signal.aborted) { active.current = false; setBusy(false) }
    }
  }, [identity.ownerId, identity.signal, readRequired, refresh])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    current.current = undefined
    pending.current = undefined
    minimumVersion.current = 0
    page.current = 1
    taskRange.current = 'today'
    taskPage.current = 1
    taskScope.current = 'all'
    search.current = ''
    active.current = false
    setData(undefined)
    setError('')
    setNotice(undefined)
    setUncertain(false)
    setReadRequired(true)
    void load()
    return () => controller.abort()
  }, [load])

  return { data, busy, error, clearError, notice, clearNotice, uncertain, readRequired, command, load, preview,
    retry: () => pending.current ? send(pending.current) : Promise.resolve(false) }
}
