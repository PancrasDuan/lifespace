import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function PlanningRecord({ label, children, summary, open, toggle, disabled = false }: {
  label: string; children: ReactNode; summary: ReactNode; open: boolean; toggle: () => void; disabled?: boolean
}) {
  const id = useId()
  return <><button type="button" className="planning-record-summary" aria-label={label} aria-expanded={open} aria-controls={id} aria-describedby={`${id}-summary`} aria-disabled={disabled}
    onClick={() => { if (!disabled) toggle() }}><span id={`${id}-summary`} className="planning-record-summary-content">{summary}</span><ChevronDown size={17} className={open ? 'is-open' : ''} /></button>
    {open && <div id={id} className="planning-record-details">{children}</div>}</>
}

export function PlanningMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="planning-more"><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>更多<ChevronRight size={13} /></button>
    <div id={id} className="planning-more-items" hidden={!open}>{children}</div></div>
}
