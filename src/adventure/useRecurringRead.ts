import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningPage } from '../shared/adventure-planning'

// Each caller includes its complete read basis and filters in key. Old responses
// never render after a date/version, account or page change.
export function useRecurringRead<T>(workspace: PlanningPage, key: string, read: (owner: string, signal: AbortSignal) => Promise<T>, enabled = true) {
  const identity = useVerifiedIdentity()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>()
  const requestKey = `${identity.ownerId}:${workspace.version}:${workspace.today}:${key}:${attempt}`
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)])
    setState({ key: requestKey })
    void read(identity.ownerId, signal).then(value => {
      if (!signal.aborted) setState({ key: requestKey, value })
    }).catch(error => {
      if (!controller.signal.aborted && !identity.signal.aborted) setState({ key: requestKey, error: error instanceof Error ? error.message : '暂时无法读取，请重试。' })
    })
    return () => controller.abort()
  }, [requestKey, enabled, identity.ownerId, identity.signal, read])
  return { value: enabled && state?.key === requestKey ? state.value : undefined,
    error: enabled && state?.key === requestKey ? state.error : undefined, retry: () => setAttempt(value => value + 1) }
}
