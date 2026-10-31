// Throwaway prototype: native segmented editing plus a finite calendar/time picker.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { fromDateTimeInput, toDateTimeInput } from './model'
import './transaction-date-time-field.css'

type Props = { value: string; onChange: (value: string) => void; min?: string }
type TimePart = 'hour' | 'minute' | 'second'
const rowHeight = 36
const pad = (value: number) => String(value).padStart(2, '0')
const seconds = (value: string) => Number(value.slice(11, 13)) * 3600 + Number(value.slice(14, 16)) * 60 + Number(value.slice(17, 19))

function normalized(value: string) {
  try { return toDateTimeInput(fromDateTimeInput(value)) } catch { return '' }
}

function clamped(value: string, min: string, now: string) {
  const valid = normalized(value) || now
  return valid < min ? min : valid > now ? now : valid
}

function monthDate(month: string) {
  const date = new Date(0)
  date.setUTCFullYear(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

function shiftMonth(month: string, delta: number) {
  const date = monthDate(month)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}`
}

function TimeColumn({ label, value, max, allowed, select, pendingChange }: {
  label: string; value: number; max: number; allowed: number[]; select: (value: number) => void; pendingChange: (pending: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const target = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const current = useRef({ allowed, select, pendingChange })
  current.current = { allowed, select, pendingChange }

  function center(next: number) {
    const element = ref.current
    if (!element || Math.abs(element.scrollTop - next * rowHeight) < 0.5) return
    target.current = next * rowHeight
    element.scrollTop = next * rowHeight
  }

  useLayoutEffect(() => {
    // The containing popover enters the top layer in its parent's layout effect.
    const frame = requestAnimationFrame(() => center(value))
    return () => cancelAnimationFrame(frame)
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  function choose(next: number) {
    clearTimeout(timer.current)
    current.current.select(next)
    center(next)
    current.current.pendingChange(false)
  }

  return <div className="lp-tp-column"><span>{label}</span>
    <div className="lp-tp-roller" ref={ref} role="listbox" tabIndex={0} aria-label={label}
      onScroll={() => {
        const element = ref.current!
        if (target.current !== null && Math.abs(element.scrollTop - target.current) < 0.5) { target.current = null; return }
        target.current = null
        clearTimeout(timer.current)
        current.current.pendingChange(true)
        timer.current = setTimeout(() => {
          const options = current.current.allowed
          if (!options.length || !ref.current) { current.current.pendingChange(false); return }
          const index = Math.max(0, Math.min(max, Math.round(ref.current.scrollTop / rowHeight)))
          const nearest = options.reduce((best, option) => Math.abs(option - index) < Math.abs(best - index) ? option : best, options[0])
          current.current.select(nearest)
          center(nearest)
          current.current.pendingChange(false)
        }, 120)
      }}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !allowed.length) return
        event.preventDefault()
        event.stopPropagation()
        const index = Math.max(0, allowed.indexOf(value))
        const next = event.key === 'Home' ? allowed[0] : event.key === 'End' ? allowed[allowed.length - 1]
          : allowed[Math.max(0, Math.min(allowed.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        choose(next)
      }}>
      <div className="lp-tp-spacer" aria-hidden="true" />
      {Array.from({ length: max + 1 }, (_, option) => <button type="button" key={option} tabIndex={-1}
        role="option" aria-label={pad(option)} aria-selected={value === option} disabled={!allowed.includes(option)}
        className={`lp-tp-option ${value === option ? 'is-selected' : ''}`} onClick={() => choose(option)}>{pad(option)}</button>)}
      <div className="lp-tp-spacer" aria-hidden="true" />
    </div>
  </div>
}

function DateTimePopover({ value, min, control, close, apply }: Omit<Props, 'onChange'> & {
  control: HTMLDivElement; close: (restoreFocus?: boolean) => void; apply: (value: string) => void
}) {
  const minimum = normalized(min || '')
  const [now, setNow] = useState(toDateTimeInput)
  const [draft, setDraft] = useState(() => clamped(value, minimum, toDateTimeInput()))
  const [month, setMonth] = useState(() => draft.slice(0, 7))
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: window.innerHeight - 24 })
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Record<TimePart, boolean>>({ hour: false, minute: false, second: false })
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  const date = draft.slice(0, 10)
  const today = now.slice(0, 10)
  const hour = Number(draft.slice(11, 13))
  const minute = Number(draft.slice(14, 16))
  const second = Number(draft.slice(17, 19))
  const lower = minimum && date === minimum.slice(0, 10) ? seconds(minimum) : 0
  const upper = date === today ? seconds(now) : 86399
  const hours = Array.from({ length: 24 }, (_, index) => index).filter(index => index * 3600 <= upper && index * 3600 + 3599 >= lower)
  const minutes = Array.from({ length: 60 }, (_, index) => index).filter(index => hour * 3600 + index * 60 <= upper && hour * 3600 + index * 60 + 59 >= lower)
  const secondOptions = Array.from({ length: 60 }, (_, index) => index).filter(index => hour * 3600 + minute * 60 + index >= lower && hour * 3600 + minute * 60 + index <= upper)
  const firstDay = monthDate(month)
  const offset = (firstDay.getUTCDay() + 6) % 7
  const monthEnd = monthDate(shiftMonth(month, 1))
  monthEnd.setUTCDate(0)
  const count = monthEnd.getUTCDate()
  const scrolling = pending.hour || pending.minute || pending.second

  function changePending(part: TimePart, next: boolean) {
    setPending(current => current[part] === next ? current : { ...current, [part]: next })
  }

  useEffect(() => {
    const interval = window.setInterval(() => setNow(toDateTimeInput()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useLayoutEffect(() => {
    const element = ref.current!
    element.showPopover()
    function reposition() {
      const anchor = control.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const below = Math.max(0, window.innerHeight - anchor.bottom - 20)
      const above = Math.max(0, anchor.top - 20)
      const naturalHeight = Math.max(element.scrollHeight, box.height)
      const centered = naturalHeight > below && naturalHeight > above
      const useAbove = !centered && naturalHeight > below
      const maxHeight = centered ? window.innerHeight - 24 : useAbove ? above : below
      setPosition({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)),
        top: centered ? Math.max(12, (window.innerHeight - Math.min(naturalHeight, maxHeight)) / 2)
          : useAbove ? anchor.top - 8 - Math.min(naturalHeight, maxHeight) : anchor.bottom + 8,
        maxHeight,
      })
    }
    function outside(event: PointerEvent) {
      const node = event.target as Node
      if (element.contains(node)) return
      if (control.contains(node)) {
        if (node instanceof HTMLInputElement) closeRef.current(false)
        return
      }
      // Consume the outside gesture so a dialog-backdrop click closes this picker only.
      event.preventDefault()
      event.stopPropagation()
      function consumeClick(click: MouseEvent) {
        if (click.target === node || node.contains(click.target as Node)) {
          click.preventDefault()
          click.stopImmediatePropagation()
        }
        document.removeEventListener('click', consumeClick, true)
      }
      document.addEventListener('click', consumeClick, true)
      window.setTimeout(() => document.removeEventListener('click', consumeClick, true), 1000)
      closeRef.current()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeRef.current()
    }
    function scroll(event: Event) {
      if (!element.contains(event.target as Node)) reposition()
    }
    reposition()
    element.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', scroll, true)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [control])

  function selectDate(next: string) {
    setError('')
    setDraft(current => clamped(`${next}T${current.slice(11)}`, minimum, toDateTimeInput()))
  }

  function selectTime(part: TimePart, next: number) {
    setError('')
    setDraft(current => {
      const values = { hour: Number(current.slice(11, 13)), minute: Number(current.slice(14, 16)), second: Number(current.slice(17, 19)), [part]: next }
      return clamped(`${current.slice(0, 10)}T${pad(values.hour)}:${pad(values.minute)}:${pad(values.second)}`, minimum, toDateTimeInput())
    })
  }

  function confirm() {
    if (scrolling) return
    const currentTime = toDateTimeInput()
    if (!normalized(draft) || draft > currentTime || (minimum && draft < minimum)) {
      setError('请选择有效范围内的交易时间。')
      return
    }
    apply(draft)
    close()
  }

  return <div ref={ref} popover="manual" role="dialog" tabIndex={-1} aria-label="选择交易时间" className="lp-time-popover" style={position}>
    <header className="lp-tp-header"><h3>选择交易时间</h3><button type="button" aria-label="关闭时间选择" onClick={() => close()}><X size={17} /></button></header>
    <div className="lp-tp-body"><section className="lp-tp-calendar" aria-label="交易日期">
      <div className="lp-tp-month-nav"><button type="button" aria-label="上个月" disabled={!!minimum && shiftMonth(month, -1) < minimum.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <input type="month" aria-label="显示月份" value={month} min={minimum ? minimum.slice(0, 7) : '0001-01'} max={now.slice(0, 7)} onChange={event => {
          const next = event.target.value
          if (/^\d{4}-\d{2}$/.test(next) && next >= (minimum.slice(0, 7) || '0001-01') && next <= now.slice(0, 7)) setMonth(next)
        }} />
        <button type="button" aria-label="下个月" disabled={shiftMonth(month, 1) > now.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button></div>
      <div className="lp-tp-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="lp-tp-days">{Array.from({ length: 42 }, (_, index) => {
        const day = index - offset + 1
        if (day < 1 || day > count) return <span key={index} aria-hidden="true" />
        const dayKey = `${month}-${pad(day)}`
        return <button key={dayKey} type="button" aria-label={dayKey} aria-pressed={date === dayKey} aria-current={dayKey === today ? 'date' : undefined}
          disabled={dayKey > today || (!!minimum && dayKey < minimum.slice(0, 10))}
          className={`lp-tp-day ${dayKey === date ? 'is-selected' : ''} ${dayKey === today ? 'is-today' : ''}`} onClick={() => selectDate(dayKey)}>{day}</button>
      })}</div>
    </section><section className="lp-tp-time"><h4>时间</h4><div className="lp-tp-rollers">
      <TimeColumn label="小时" value={hour} max={23} allowed={hours} select={next => selectTime('hour', next)} pendingChange={next => changePending('hour', next)} />
      <TimeColumn label="分钟" value={minute} max={59} allowed={minutes} select={next => selectTime('minute', next)} pendingChange={next => changePending('minute', next)} />
      <TimeColumn label="秒" value={second} max={59} allowed={secondOptions} select={next => selectTime('second', next)} pendingChange={next => changePending('second', next)} />
    </div></section></div>
    {error && <p className="lp-tp-error" role="alert">{error}</p>}
    <footer className="lp-tp-footer"><strong>{draft.replace('T', ' ')}</strong><button type="button" className="lp-tp-cancel" onClick={() => close()}>取消</button><button type="button" className="lp-tp-confirm" disabled={scrolling} onClick={confirm}>确认时间</button></footer>
  </div>
}

export function TransactionDateTimeField({ value, onChange, min }: Props) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  return <div className="lp-field lp-time-field"><label htmlFor={id}>交易时间</label>
    <div className="lp-time-control" ref={control} onClick={event => { if (event.target === event.currentTarget) setOpen(current => !current) }}>
      <input id={id} className="lp-time-native" type="datetime-local" step="1" required value={value} min={min} max={toDateTimeInput()}
        onPointerDown={() => { if (open) close(false) }} onChange={event => onChange(event.target.value)} />
      <button type="button" ref={trigger} className="lp-time-trigger" aria-label="选择交易时间" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><CalendarDays size={16} /></button>
    </div>
    {open && control.current && <DateTimePopover value={value} min={min} control={control.current} close={close} apply={onChange} />}
  </div>
}
