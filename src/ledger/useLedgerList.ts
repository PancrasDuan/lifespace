import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVerifiedIdentity } from '../auth/identity'
import { LedgerError, readLedger } from './api'
import type { DateRange } from './dates'

// One browsing session pins a revision across pages and refreshes. Changing the
// filter or detecting a write starts a fresh session, without touching forms.
export function useLedgerList() {
  const identity = useVerifiedIdentity()
  const [view, setView] = useState<{ range: DateRange | null; page: number; session: number }>({ range: null, page: 1, session: 0 })
  const version = useRef<number | undefined>(undefined)
  const [updated, setUpdated] = useState(false)
  function selectRange(range: DateRange | null) {
    version.current = undefined
    setUpdated(false)
    setView(current => ({ range, page: 1, session: current.session + 1 }))
  }
  const entries = useQuery({
    queryKey: ['ledger', identity.ownerId, 'entries', view.range, view.page, view.session],
    queryFn: ({ signal }) => readLedger(identity.ownerId, view.page, AbortSignal.any([signal, identity.signal]), view.range, version.current),
    retry: false, staleTime: 0, refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (entries.data) version.current = entries.data.version
  }, [entries.data])
  useEffect(() => {
    if (!(entries.error instanceof LedgerError) || entries.error.code !== 'LIST_CHANGED') return
    version.current = undefined
    setUpdated(true)
    setView(current => ({ ...current, page: 1, session: current.session + 1 }))
  }, [entries.error])
  return { entries, page: view.page, range: view.range, updated, selectRange, setPage: (page: number) => setView(current => ({ ...current, page })) }
}
