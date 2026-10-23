import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function Record({ open, toggle, disabled = false, label, summaryLabel = label, className = '', summary, children }: {
  open: boolean; toggle: () => void; disabled?: boolean; label: string; summaryLabel?: string; className?: string
  summary: ReactNode; children: ReactNode
}) {
  const id = useId()
  return <article className={`record ${className}${open ? ' is-open' : ''}`} aria-label={label}>
    <button type="button" className="record-summary" aria-label={summaryLabel} aria-expanded={open} aria-controls={id} aria-disabled={disabled}
      onClick={() => { if (!disabled) toggle() }}>{summary}</button>
    {open && <div className="record-details" id={id}>{children}</div>}
  </article>
}

export function MoreActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="more-actions" data-open={open ? 'true' : undefined}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} aria-label="更多">更多</button>
    <div id={id} hidden={!open}>{children}</div>
  </div>
}

export function Progress({ value, label }: { value: number | null; label: string }) {
  const percent = Math.max(0, Math.min(100, (value ?? 0) * 100))
  return <div className="adventure-proto-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>
}
