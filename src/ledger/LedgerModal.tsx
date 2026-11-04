import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function LedgerModal({ title, children, close, form = false, compact = false }: { title: string; children: ReactNode; close: () => void; form?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
  }, [])
  return <dialog ref={ref} className={`lp-dialog ${form ? 'entry-card' : ''} ${compact ? 'compact' : ''}`} aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><h2>{title}</h2><button aria-label="关闭" onClick={close}><X size={19} /></button></header>{children}
  </dialog>
}
