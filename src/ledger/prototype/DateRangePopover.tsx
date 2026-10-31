import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { beijingDateKey, getDateRange } from './model'
import './date-range-popover.css'

type DateRangePopoverProps = {
  start: string
  end: string
  anchor: DOMRect
  trigger: HTMLButtonElement | null
  apply: (start: string, end: string) => void
  close: () => void
}

function monthStart(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, monthNumber - 1, 1)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

function monthKey(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number) {
  const date = monthStart(month)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return monthKey(date)
}

function Calendar({ title, month, setMonth, value, start, end, select }: {
  title: string
  month: string
  setMonth: (value: string) => void
  value: string
  start: string
  end: string
  select: (value: string) => void
}) {
  const firstDay = monthStart(month)
  const offset = (firstDay.getUTCDay() + 6) % 7
  const lastDay = monthStart(shiftMonth(month, 1))
  lastDay.setUTCDate(0)
  const count = lastDay.getUTCDate()
  const today = beijingDateKey()
  const validRange = start <= end

  return <section className="lp-dr-calendar" aria-label={`${title}日历`}>
    <div className="lp-dr-date-label"><span>{title}</span><strong>{value.replaceAll('-', ' / ')}</strong></div>
    <div className="lp-dr-month-nav">
      <button type="button" aria-label={`${title}上个月`} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button>
      <input type="month" aria-label={`${title}的显示月份`} value={month} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} />
      <button type="button" aria-label={`${title}下个月`} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button>
    </div>
    <div className="lp-dr-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="lp-dr-days">
      {Array.from({ length: 42 }, (_, index) => {
        const day = index - offset + 1
        if (day < 1 || day > count) return <span className="lp-dr-blank" key={index} aria-hidden="true" />
        const date = `${month}-${String(day).padStart(2, '0')}`
        const selected = date === value
        const boundary = date === start || date === end
        const inside = validRange && date >= start && date <= end
        return <button type="button" key={date} aria-label={`${title} ${date}`} aria-pressed={selected} aria-current={date === today ? 'date' : undefined}
          className={[
            'lp-dr-day', inside ? 'is-in-range' : '', boundary ? 'is-boundary' : '',
            selected ? 'is-selected' : '', date === today ? 'is-today' : '',
          ].filter(Boolean).join(' ')} onClick={() => select(date)}>{day}</button>
      })}
    </div>
  </section>
}

// Throwaway UI: dates remain a local draft until the user applies the range.
export function DateRangePopover({ start, end, anchor, trigger, apply, close }: DateRangePopoverProps) {
  const today = beijingDateKey()
  const [draftStart, setDraftStart] = useState(start || today)
  const [draftEnd, setDraftEnd] = useState(end || today)
  const [leftMonth, setLeftMonth] = useState((start || today).slice(0, 7))
  const [rightMonth, setRightMonth] = useState((end || today).slice(0, 7))
  const [position, setPosition] = useState({
    left: 12,
    top: Math.max(12, anchor.bottom + 8),
    maxHeight: Math.max(0, window.innerHeight - anchor.bottom - 20),
  })
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  const invalid = !draftStart || !draftEnd || draftStart > draftEnd

  useLayoutEffect(() => {
    const element = ref.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showPopover()
    function reposition() {
      const target = trigger?.getBoundingClientRect() ?? anchor
      const box = element.getBoundingClientRect()
      const left = Math.max(12, Math.min(target.left, window.innerWidth - box.width - 12))
      const below = Math.max(0, window.innerHeight - target.bottom - 20)
      const above = Math.max(0, target.top - 20)
      const useAbove = below < 280 && above > below
      const maxHeight = useAbove ? above : below
      const naturalHeight = Math.max(element.scrollHeight, box.height)
      const top = useAbove ? target.top - 8 - Math.min(naturalHeight, maxHeight) : target.bottom + 8
      setPosition({ left, top, maxHeight })
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node
      if (!element.contains(target) && !trigger?.contains(target)) closeRef.current()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    function scroll(event: Event) {
      if (!element.contains(event.target as Node)) closeRef.current()
    }
    reposition()
    element.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', scroll, true)
      if (element.matches(':popover-open')) element.hidePopover()
      previousFocus?.focus({ preventScroll: true })
    }
  }, [anchor, trigger])

  function shortcut(filter: 'this-week' | 'this-month') {
    const next = getDateRange(filter)!
    setDraftStart(next.start)
    setDraftEnd(next.end)
    setLeftMonth(next.start.slice(0, 7))
    setRightMonth(next.end.slice(0, 7))
  }

  return <div className="lp-date-popover" popover="manual" ref={ref} tabIndex={-1} role="dialog" aria-label="自定义日期范围"
    style={position} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation()
    }}>
    <header className="lp-dr-header"><h2>自定义日期</h2><button type="button" aria-label="关闭日期范围" onClick={close}><X size={17} /></button></header>
    <div className="lp-dr-shortcuts"><button type="button" onClick={() => shortcut('this-week')}>本周</button><button type="button" onClick={() => shortcut('this-month')}>本月</button></div>
    <div className="lp-dr-calendars">
      <Calendar title="开始日期" month={leftMonth} setMonth={setLeftMonth} value={draftStart} start={draftStart} end={draftEnd} select={setDraftStart} />
      <Calendar title="结束日期" month={rightMonth} setMonth={setRightMonth} value={draftEnd} start={draftStart} end={draftEnd} select={setDraftEnd} />
    </div>
    <footer className="lp-dr-footer"><div>{invalid ? <span className="lp-dr-error" role="alert">开始日期不能晚于结束日期</span> : <strong>{draftStart} — {draftEnd}</strong>}</div>
      <button type="button" className="lp-dr-cancel" onClick={close}>取消</button><button type="button" className="lp-dr-apply" disabled={invalid} onClick={() => { apply(draftStart, draftEnd); close() }}>应用</button></footer>
  </div>
}
