import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'

export type Resource<T> = { data?: T; error?: unknown; loading: boolean }
export function useResource<T>(key: string, read: (owner: string, signal: AbortSignal) => Promise<T>): Resource<T> {
  const identity = useVerifiedIdentity()
  const [result, setResult] = useState<Resource<T> & { key: string }>({ key: '', loading: true })
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, identity.signal])
    setResult({ key, loading: true })
    void read(identity.ownerId, signal).then(data => {
      if (!signal.aborted) setResult({ key, data, loading: false })
    }, error => {
      if (!signal.aborted) setResult({ key, error, loading: false })
    })
    return () => controller.abort()
    // read is intentionally keyed by its complete query, with no previous-range placeholder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, identity])
  return result.key === key ? result : { loading: true }
}
