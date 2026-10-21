import { useCallback, useEffect, useRef, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningEnvelope, PlanningPage } from '../shared/adventure-planning'
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
  const signal = () => AbortSignal.any([lifecycle.current.signal, identity.signal, AbortSignal.timeout(15_000)])

  const refresh = useCallback(async (nextPage = page.current, requestSignal = signal()) => {
    const result = await planningApi.load(identity.ownerId, nextPage, requestSignal)
    requestSignal.throwIfAborted()
    if (result.version < minimumVersion.current) throw new PlanningError('数据尚未更新到已保存版本，请重新读取', 409)
    minimumVersion.current = result.version
    current.current = result
    page.current = nextPage
    setData(result)
    setReadRequired(false)
  }, [identity.ownerId, identity.signal])

  const load = useCallback(async (nextPage = page.current) => {
    if (active.current || pending.current) return
    const epoch = lifecycle.current
    active.current = true
    setBusy(true)
    setError('')
    try { await refresh(nextPage) }
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

  const command = useCallback(async (command: PlanningCommand) => {
    if (active.current || pending.current || !current.current || current.current.version < minimumVersion.current) return false
    const envelope = { requestId: crypto.randomUUID(), expectedVersion: current.current.version, command }
    pending.current = envelope
    return send(envelope)
  }, [send])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    current.current = undefined
    pending.current = undefined
    minimumVersion.current = 0
    page.current = 1
    active.current = false
    setData(undefined)
    setError('')
    setNotice(undefined)
    setUncertain(false)
    setReadRequired(true)
    void load()
    return () => controller.abort()
  }, [load])

  return { data, busy, error, clearError, notice, clearNotice, uncertain, readRequired, command, load,
    retry: () => pending.current ? send(pending.current) : Promise.resolve(false) }
}
