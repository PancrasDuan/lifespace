// Native segmented editing and the confirmed finite calendar/time picker.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { fromDateTimeInput, normalizeDateTimeInput, toDateTimeInput } from './time'
import './transaction-date-time-field.css'

type Props = { value: string; onChange: (value: string) => void; minInstant?: string; disabled?: boolean }
type TimePart = 'hour' | 'minute' | 'second'
const rowHeight = 36
const pad = (value: number) => String(value).padStart(2, '0')

function normalized(value: string) {
  try { return normalizeDateTimeInput(value) } catch { return '' }
}

function clamped(value: string, min: number, now: number) {
  const valid = normalized(value) || toDateTimeInput(now)
  try {
    const instant = Date.parse(fromDateTimeInput(valid))
    return instant < min ? toDateTimeInput(min) : instant > now ? toDateTimeInput(now) : valid
  } catch { return valid } // Keep invalid wall-clock drafts visible for correction.
}

function invalidTime(value: string, min: number, now: number) {
  try {
    const instant = Date.parse(fromDateTimeInput(value))
    return instant < min || instant > now ? '请选择有效范围内的交易时间。' : ''
  } catch (error) { return error instanceof Error ? error.message : '交易时间无效。' }
}

function overlaps(start: string, end: string, min: number, now: number) {
  if (!normalized(start) || !normalized(end)) return false
  try { return Date.parse(fromDateTimeInput(start)) <= now && Date.parse(fromDateTimeInput(end)) >= min }
  // Gaps may be selected as drafts, but invalidTime always blocks confirmation.
  catch { return true }
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

function DateTimePopover({ value, minInstant, control, close, apply }: Omit<Props, 'onChange'> & {
  control: HTMLDivElement; close: (restoreFocus?: boolean) => void; apply: (value: string) => void
}) {
  const minimum = minInstant ? Date.parse(minInstant) : Number.NEGATIVE_INFINITY
  const [now, setNow] = useState(Date.now)
  const [draft, setDraft] = useState(() => clamped(value, minimum, Date.now()))
  const [month, setMonth] = useState(() => draft.slice(0, 7))
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: window.innerHeight - 24 })
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Record<TimePart, boolean>>({ hour: false, minute: false, second: false })
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  const date = draft.slice(0, 10)
  const today = toDateTimeInput(now).slice(0, 10)
  const hour = Number(draft.slice(11, 13))
  const minute = Number(draft.slice(14, 16))
  const second = Number(draft.slice(17, 19))
  const stamp = (h: number, m: number, s: number) => `${date}T${pad(h)}:${pad(m)}:${pad(s)}`
  const allowed = (start: string, end: string) => overlaps(start, end, minimum, now)
  const hours = Array.from({ length: 24 }, (_, index) => index).filter(index => allowed(stamp(index, 0, 0), stamp(index, 59, 59)))
  const minutes = Array.from({ length: 60 }, (_, index) => index).filter(index => allowed(stamp(hour, index, 0), stamp(hour, index, 59)))
  const secondOptions = Array.from({ length: 60 }, (_, index) => index).filter(index => allowed(stamp(hour, minute, index), stamp(hour, minute, index)))
  const firstDay = monthDate(month)
  const offset = (firstDay.getUTCDay() + 6) % 7
  const monthEnd = monthDate(shiftMonth(month, 1))
  monthEnd.setUTCDate(0)
  const count = monthEnd.getUTCDate()
  const scrolling = pending.hour || pending.minute || pending.second
  const invalid = invalidTime(draft, minimum, now)
  function monthAllowed(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return false
    const last = monthDate(shiftMonth(value, 1))
    last.setUTCDate(0)
    return allowed(`${value}-01T00:00:00`, `${value}-${pad(last.getUTCDate())}T23:59:59`)
  }

  function changePending(part: TimePart, next: boolean) {
    setPending(current => current[part] === next ? current : { ...current, [part]: next })
  }

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
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
    setDraft(current => clamped(`${next}T${current.slice(11)}`, minimum, Date.now()))
  }

  function selectTime(part: TimePart, next: number) {
    setError('')
    setDraft(current => {
      const values = { hour: Number(current.slice(11, 13)), minute: Number(current.slice(14, 16)), second: Number(current.slice(17, 19)), [part]: next }
      return clamped(`${current.slice(0, 10)}T${pad(values.hour)}:${pad(values.minute)}:${pad(values.second)}`, minimum, Date.now())
    })
  }

  function confirm() {
    if (scrolling) return
    const invalid = invalidTime(draft, minimum, Date.now())
    if (invalid) {
      setError(invalid)
      return
    }
    apply(draft)
    close()
  }

  return <div ref={ref} popover="manual" role="dialog" tabIndex={-1} aria-label="选择交易时间" className="lp-time-popover" style={position}>
    <header className="lp-tp-header"><h3>选择交易时间</h3><button type="button" aria-label="关闭时间选择" onClick={() => close()}><X size={17} /></button></header>
    <div className="lp-tp-body"><section className="lp-tp-calendar" aria-label="交易日期">
      <div className="lp-tp-month-nav"><button type="button" aria-label="上个月" disabled={!monthAllowed(shiftMonth(month, -1))} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <input type="month" aria-label="显示月份" value={month} min="0001-01" max={today.slice(0, 7)} onChange={event => {
          const next = event.target.value
          if (monthAllowed(next)) setMonth(next)
        }} />
        <button type="button" aria-label="下个月" disabled={!monthAllowed(shiftMonth(month, 1))} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button></div>
      <div className="lp-tp-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="lp-tp-days">{Array.from({ length: 42 }, (_, index) => {
        const day = index - offset + 1
        if (day < 1 || day > count) return <span key={index} aria-hidden="true" />
        const dayKey = `${month}-${pad(day)}`
        return <button key={dayKey} type="button" aria-label={dayKey} aria-pressed={date === dayKey} aria-current={dayKey === today ? 'date' : undefined}
          disabled={!allowed(`${dayKey}T00:00:00`, `${dayKey}T23:59:59`)}
          className={`lp-tp-day ${dayKey === date ? 'is-selected' : ''} ${dayKey === today ? 'is-today' : ''}`} onClick={() => selectDate(dayKey)}>{day}</button>
      })}</div>
    </section><section className="lp-tp-time"><h4>时间</h4><div className="lp-tp-rollers">
      <TimeColumn label="小时" value={hour} max={23} allowed={hours} select={next => selectTime('hour', next)} pendingChange={next => changePending('hour', next)} />
      <TimeColumn label="分钟" value={minute} max={59} allowed={minutes} select={next => selectTime('minute', next)} pendingChange={next => changePending('minute', next)} />
      <TimeColumn label="秒" value={second} max={59} allowed={secondOptions} select={next => selectTime('second', next)} pendingChange={next => changePending('second', next)} />
    </div></section></div>
    {(error || invalid) && <p className="lp-tp-error" role="alert">{error || invalid}</p>}
    <footer className="lp-tp-footer"><strong>{draft.replace('T', ' ')}</strong><button type="button" className="lp-tp-cancel" onClick={() => close()}>取消</button><button type="button" className="lp-tp-confirm" disabled={scrolling || !!invalid} onClick={confirm}>确认时间</button></footer>
  </div>
}

export function TransactionDateTimeField({ value, onChange, minInstant, disabled }: Props) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const arrow = useRef<{ key: string; value: string } | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  return <div className="lp-field lp-time-field"><label htmlFor={id}>交易时间</label>
    <div className="lp-time-control" ref={control} onClick={event => { if (!disabled && event.target === event.currentTarget) setOpen(current => !current) }}>
      <input disabled={disabled} id={id} className="lp-time-native" type="datetime-local" step="1" required value={value} max={toDateTimeInput()}
        onPointerDown={() => { arrow.current = null; if (open) close(false) }}
        onKeyDown={event => { arrow.current = ['ArrowUp', 'ArrowDown'].includes(event.key) ? { key: event.key, value: event.currentTarget.value } : null }}
        onKeyUp={() => { arrow.current = null }} onBlur={() => { arrow.current = null }}
        onChange={event => {
          const previous = arrow.current
          arrow.current = null
          const next = event.currentTarget.value
          // Native controls do not expose the selected segment. Compare the
          // arrow's actual edit, allowing dates and digits but rejecting time wrap.
          if (previous && next.slice(0, 10) === previous.value.slice(0, 10) && [11, 14, 17].some(start => {
            const before = Number(previous.value.slice(start, start + 2) || '0')
            const after = Number(next.slice(start, start + 2) || '0')
            return previous.key === 'ArrowUp' ? after < before : after > before
          })) { event.currentTarget.value = previous.value; return }
          onChange(next)
        }} />
      <button disabled={disabled} type="button" ref={trigger} className="lp-time-trigger" aria-label="选择交易时间" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><CalendarDays size={16} /></button>
    </div>
    {open && control.current && <DateTimePopover value={value} minInstant={minInstant} control={control.current} close={close} apply={onChange} />}
  </div>
}
