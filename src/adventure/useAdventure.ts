import { useVerifiedIdentity } from '../auth/identity'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adventureApi,
  AdventureError,
  type AdventureResponse,
  type Envelope,
} from './api'
import type { AdventureCommand } from '../shared/adventure/commands'

export function useAdventure() {
  const identity = useVerifiedIdentity()
  const [data, setData] = useState<AdventureResponse>()
  const current = useRef<AdventureResponse | undefined>(undefined)
  const pending = useRef<Envelope | undefined>(undefined)
  const active = useRef(false)
  const alive = useRef(true)
  const controller = useRef(new AbortController())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [notice, setNotice] = useState('')
  const accept = (value: AdventureResponse) => {
    if (
      !alive.current ||
      (current.current && value.version < current.current.version)
    )
      return
    current.current = value
    setData(value)
    if (value.result?.reward)
      setNotice(
        `本次结算 +${value.result.reward} XP${value.result.levelAfter > value.result.levelBefore ? ` · 升至 Lv.${value.result.levelAfter}` : ''}${value.result.achievementIds.length ? ` · 解锁 ${value.result.achievementIds.length} 项成就` : ''}`,
      )
  }
  const send = useCallback(
    async (envelope: Envelope) => {
      if (active.current) return false
      active.current = true
      setBusy(true)
      setError('')
      setUncertain(false)
      try {
        const result = await adventureApi.send(
          identity.ownerId,
          envelope,
          AbortSignal.any([
            controller.current.signal,
            identity.signal,
            AbortSignal.timeout(15000),
          ]),
        )
        accept(result)
        pending.current = undefined
        return true
      } catch (failure) {
        if (!alive.current) return false
        const fault =
          failure instanceof AdventureError
            ? failure
            : new AdventureError('暂时无法保存，请重试。', 500, true)
        setError(fault.message)
        setUncertain(fault.uncertain)
        if (!fault.uncertain) pending.current = undefined
        return false
      } finally {
        active.current = false
        if (alive.current) setBusy(false)
      }
    },
    [identity.ownerId, identity.signal],
  )
  const command = useCallback(
    async (value: AdventureCommand) => {
      if (pending.current || !current.current || active.current) return false
      const envelope = {
        requestId: crypto.randomUUID(),
        expectedVersion: current.current.version,
        command: value,
      }
      pending.current = envelope
      return send(envelope)
    },
    [send],
  )
  const load = useCallback(async () => {
    if (pending.current || active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      accept(
        await adventureApi.load(
          identity.ownerId,
          AbortSignal.any([
            controller.current.signal,
            identity.signal,
            AbortSignal.timeout(15000),
          ]),
        ),
      )
    } catch {
      if (alive.current)
        setError('暂时无法读取人生冒险，请检查连接后重新读取。')
    } finally {
      active.current = false
      if (alive.current) setBusy(false)
    }
  }, [identity.ownerId, identity.signal])
  useEffect(() => {
    alive.current = true
    void load().then(() => {
      if (alive.current && current.current) void command({ type: 'refresh' })
    })
    const focus = () => {
      if (
        document.visibilityState === 'visible' &&
        current.current &&
        !pending.current &&
        !active.current
      )
        void command({ type: 'refresh' })
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      alive.current = false
      controller.current.abort()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [load, command])
  return {
    data,
    busy,
    error,
    uncertain,
    notice,
    command,
    load,
    retry: () =>
      pending.current ? send(pending.current) : Promise.resolve(false),
    clearNotice: () => setNotice(''),
  }
}
export type AdventureAction = ReturnType<typeof useAdventure>['command']
