import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { calendarYearRange } from './calendar'

type PickerKind = 'year' | 'month'
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

export function CalendarPicker({ kind, year, month, select }: { kind: PickerKind; year: number; month: number; select: (year: number, month: number) => void }) {
  const isYear = kind === 'year'
  const label = isYear ? '年份' : '月份'
  const displayedValue = isYear ? String(year) : String(month).padStart(2, '0')
  const [open, setOpen] = useState(false)
  const [panelYear, setPanelYear] = useState(year)
  const [draft, setDraft] = useState(displayedValue)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLInputElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const startYear = Math.floor(panelYear / 10) * 10
  const values = isYear ? Array.from({ length: 10 }, (_, index) => startYear + index) : Array.from({ length: 12 }, (_, index) => index + 1)
  const close = (restoreFocus = false) => {
    setOpen(false)
    setPanelYear(year)
    setDraft(displayedValue)
    if (restoreFocus) trigger.current?.focus()
  }
  const show = () => { if (!open) { setPanelYear(year); setDraft(displayedValue); setOpen(true) } }
  useEffect(() => { setDraft(displayedValue) }, [displayedValue])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  })
  const choose = (value: number) => {
    const targetYear = isYear ? value : open ? panelYear : year
    const changed = targetYear !== year || (!isYear && value !== month)
    if (changed) select(targetYear, isYear ? 1 : value)
    setOpen(false)
    setDraft(isYear ? String(value) : String(value).padStart(2, '0'))
    trigger.current?.focus()
  }
  const triggerKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true) }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) show()
      else {
        const active = options.current.find(option => option?.getAttribute('aria-pressed') === 'true') ?? options.current.find(option => option && !option.disabled)
        active?.focus()
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const value = Number(draft)
      const valid = /^\d+$/.test(draft.trim()) && Number.isInteger(value) && (isYear ? value >= calendarYearRange.min && value <= calendarYearRange.max : value >= 1 && value <= 12)
      if (valid) choose(value)
      else close()
    }
  }
  const optionKey = (event: KeyboardEvent, index: number) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }
    const delta = steps[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      const target = options.current[Math.min(values.length - 1, Math.max(0, index + delta))]
      if (target && !target.disabled) target.focus()
    }
  }
  const pageDelta = isYear ? 10 : 1
  return <div className="calendar-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true) }
  }}>
    <label className={isYear ? 'calendar-year' : 'calendar-month-select'}><CalendarDays size={15} /><input ref={trigger} aria-label={label} role="combobox" aria-haspopup="dialog" aria-expanded={open} aria-controls={`calendar-${kind}-picker`} inputMode="numeric" value={draft} onClick={show} onChange={event => { if (!open) setPanelYear(year); setDraft(event.target.value); setOpen(true) }} onKeyDown={triggerKey} /></label>
    {open && <div className="calendar-picker-popover" id={`calendar-${kind}-picker`} role="dialog" aria-label={`${label}选择`}>
      <div className="calendar-picker-header">
        <button aria-label={isYear ? '前十年' : '月份面板上一年'} disabled={isYear ? startYear <= calendarYearRange.min : panelYear <= calendarYearRange.min} onClick={() => setPanelYear(value => Math.max(calendarYearRange.min, value - pageDelta))}><ChevronsLeft size={17} /></button>
        <span>{isYear ? `${startYear} 年 - ${startYear + 9} 年` : `${panelYear} 年`}</span>
        <button aria-label={isYear ? '后十年' : '月份面板下一年'} disabled={isYear ? startYear + 10 > calendarYearRange.max : panelYear >= calendarYearRange.max} onClick={() => setPanelYear(value => Math.min(calendarYearRange.max, value + pageDelta))}><ChevronsRight size={17} /></button>
      </div>
      <div className="calendar-picker-options" aria-label={`选择${label}`}>
        {values.map((value, index) => <button key={value} ref={element => { options.current[index] = element }} aria-label={isYear ? `${value} 年` : `${value} 月`} aria-pressed={isYear ? value === year : panelYear === year && value === month} disabled={isYear && (value < calendarYearRange.min || value > calendarYearRange.max)} onClick={() => choose(value)} onKeyDown={event => optionKey(event, index)}>{isYear ? value : monthNames[index]}</button>)}
      </div>
    </div>}
  </div>
}
