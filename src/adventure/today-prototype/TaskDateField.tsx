// Prototype date-only adaptation of the transaction time picker's calendar.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import '../../ledger/transaction-date-time-field.css'

const pad = (n: number) => String(n).padStart(2, '0')
function shiftMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

export function TaskDateField({ value, onChange, today, originalDate }: { value: string; onChange: (value: string) => void; today: string; originalDate?: string }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [month, setMonth] = useState(value.slice(0, 7))
  const control = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })) }
  useLayoutEffect(() => {
    if (!open || !popover.current || !control.current) return
    const element = popover.current
    element.showPopover()
    const position = () => {
      const rect = control.current!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const margin = 12
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - box.width - margin))
      const below = rect.bottom + 8
      const above = rect.top - box.height - 8
      const top = below + box.height <= window.innerHeight - margin ? below : above >= margin ? above : Math.max(margin, (window.innerHeight - box.height) / 2)
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    }
    position()
    if (document.activeElement !== input.current) element.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node) && !control.current?.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); close() }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() } }
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !element.contains(event.target as Node)) return
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      event.stopPropagation()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('keydown', trapTab, true)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); document.removeEventListener('keydown', trapTab, true); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); if (element.matches(':popover-open')) element.hidePopover() }
  }, [open])
  useEffect(() => { if (!open) return; setDraft(value || today); setMonth((value || today).slice(0, 7)) }, [open])
  useEffect(() => { if (open && /^\d{4}-\d{2}-\d{2}$/.test(value)) { setDraft(value); setMonth(value.slice(0, 7)) } }, [value])
  const first = new Date(`${month}-01T12:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return <div className="task-date-field"><label htmlFor="task-planned-date">执行日期</label><div className="lp-time-control" ref={control} onClick={event => { if (event.target === event.currentTarget) setOpen(current => !current) }}>
    <input ref={input} id="task-planned-date" className="lp-time-native" type="date" required value={value} min={originalDate && originalDate < today ? undefined : today} onClick={() => setOpen(true)} onChange={event => { const next = event.target.value; event.target.setCustomValidity(next && next < today && next !== originalDate ? '请选择今天或未来的日期' : ''); onChange(next) }}/>
    <button type="button" ref={trigger} className="lp-time-trigger" aria-label="选择执行日期" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><CalendarDays size={16}/></button>
  </div>{open && createPortal(<div ref={popover} popover="manual" role="dialog" tabIndex={-1} aria-label="选择执行日期" className="lp-time-popover task-date-picker">
    <header className="lp-tp-header"><h3>选择执行日期</h3><button type="button" aria-label="关闭日期选择" onClick={close}><X size={17}/></button></header>
    <div className="lp-tp-body"><section className="lp-tp-calendar" aria-label="执行日期日历"><div className="lp-tp-month-nav"><button type="button" aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16}/></button><input type="month" aria-label="显示月份" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value) }}/><button type="button" aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16}/></button></div>
      <div className="lp-tp-weekdays" aria-hidden="true">{['一','二','三','四','五','六','日'].map(day => <span key={day}>{day}</span>)}</div><div className="lp-tp-days">{Array.from({ length: 42 }, (_, index) => { const day = index - offset + 1; if (day < 1 || day > count) return <span key={index} aria-hidden="true"/>; const date = `${month}-${pad(day)}`; return <button key={date} type="button" className={`lp-tp-day ${date === draft ? 'is-selected' : ''} ${date === today ? 'is-today' : ''}`} aria-label={date} aria-pressed={date === draft} aria-current={date === today ? 'date' : undefined} disabled={date < today && date !== originalDate} onClick={() => setDraft(date)}>{day}</button> })}</div>
    </section></div><footer className="lp-tp-footer"><strong>{draft}</strong><button type="button" className="lp-tp-cancel" onClick={close}>取消</button><button type="button" className="lp-tp-confirm" onClick={() => { input.current?.setCustomValidity(''); onChange(draft); close() }}>确认日期</button></footer>
  </div>, document.body)}</div>
}
