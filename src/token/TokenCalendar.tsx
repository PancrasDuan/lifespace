import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TokenDashboardSummary } from '../shared/token-backend-contract'
import type { Resource } from './useResource'
import { datesBetween, offsetDate, sundayOffset } from './dates'
import { costText, fullCount } from './format'
import { Feedback } from './TokenDashboard'

type Props = { today: string; resource: Resource<TokenDashboardSummary>; selectedDate: string; selectDate: (date: string) => void; retry: () => void }
export function TokenCalendar({ today, resource, selectedDate, selectDate, retry }: Props) {
  const year = today.slice(0, 4), start = `${year}-01-01`, days = datesBetween(start, `${year}-12-31`), offset = sundayOffset(start)
  const scroll = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [hint, setHint] = useState<{ date: string; cell: HTMLButtonElement }>()
  const [tabDate, setTabDate] = useState(today)
  const [popover, setPopover] = useState<'hint' | 'auto' | undefined>(undefined)
  const daily = new Map(resource.data?.daily.map(day => [day.date, day]))
  const maximum = Math.max(1, ...[...daily.values()].map(day => day.metrics.total ?? 0))
  useEffect(() => {
    const probe = document.createElement('div')
    if ('popover' in HTMLElement.prototype && typeof probe.showPopover === 'function') {
      probe.setAttribute('popover', 'hint')
      setPopover(probe.popover === 'hint' ? 'hint' : 'auto')
    }
  }, [])
  useEffect(() => { setHint(undefined) }, [resource.data, resource.loading])
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const position = () => {
      const cell = element.querySelector<HTMLButtonElement>(`[data-date="${today}"]`)
      if (!cell || element.scrollWidth <= element.clientWidth) return
      element.scrollLeft += Math.max(0, cell.getBoundingClientRect().right - element.getBoundingClientRect().right + 24)
    }
    const observer = new ResizeObserver(position)
    observer.observe(element); position()
    return () => observer.disconnect()
  }, [today])
  const cancelHide = () => clearTimeout(timer.current)
  const close = () => { cancelHide(); setHint(undefined) }
  const show = (cell: HTMLButtonElement) => {
    if (cell.disabled) return
    cancelHide()
    const date = cell.dataset.date!
    setHint({ date, cell }); setTabDate(date); selectDate(date)
  }
  const delayHide = () => {
    cancelHide()
    timer.current = setTimeout(() => {
      if (tooltip.current?.matches(':hover') || hint?.cell.matches(':hover') || document.activeElement === hint?.cell) return
      setHint(undefined)
    }, 180)
  }
  useLayoutEffect(() => {
    const element = tooltip.current
    if (!element) return
    const opened = () => popover && element.matches(':popover-open')
    if (!hint) { if (opened()) element.hidePopover(); return }
    if (popover && !opened()) element.showPopover()
    const position = () => {
      const cell = hint.cell.getBoundingClientRect(), region = scroll.current!.getBoundingClientRect()
      if (cell.right <= region.left || cell.left >= region.right || cell.bottom <= 0 || cell.top >= innerHeight) { setHint(undefined); return }
      const box = element.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, cell.left + cell.width / 2 - box.width / 2))}px`
      element.style.top = `${Math.max(8, cell.top >= box.height + 18 ? cell.top - box.height - 10 : Math.min(innerHeight - box.height - 8, cell.bottom + 10))}px`
    }
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target) && !hint.cell.contains(event.target)) setHint(undefined) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHint(undefined) }
    position()
    document.addEventListener('scroll', position, true); window.addEventListener('resize', position)
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('scroll', position, true); window.removeEventListener('resize', position)
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape)
    }
  }, [hint, popover])
  useEffect(() => () => clearTimeout(timer.current), [])
  const hintDay = hint ? daily.get(hint.date) : undefined
  return <section className="panel activity-panel" aria-labelledby="activity-title">
    <div className="panel-heading"><div className="activity-title"><h2 id="activity-title">使用日历</h2><span className="year-label">{year} 全年</span></div></div>
    <Feedback resource={resource} retry={retry} label="正在读取全年用量…" />
    <div className="calendar-scroll" ref={scroll} tabIndex={0} role="region" aria-label={`${year}年每日用量日历，可横向滚动`}><div className="calendar">
      <div className="calendar-months" aria-hidden="true" style={{ gridTemplateColumns: `28px repeat(${Math.ceil((days.length + offset) / 7)}, var(--cell))` }}>{days.flatMap((date, index) => date.endsWith('-01') ? [<span key={date} style={{ gridColumn: Math.floor((index + offset) / 7) + 2 }}>{Number(date.slice(5, 7))}月</span>] : [])}</div>
      <div className="calendar-body"><div className="week-labels" aria-hidden="true"><span /><span>一</span><span /><span>三</span><span /><span>五</span><span /></div><div className="heat-grid" role="group" aria-label="每日 Token 用量">
        {Array.from({ length: offset }, (_, index) => <span key={`blank${index}`} className="heat-cell heat-blank" aria-hidden="true" />)}
        {days.map(date => {
          const day = daily.get(date), future = date > today
          const level = !day?.metrics.total ? 0 : Math.min(4, Math.ceil(day.metrics.total / maximum * 4))
          const description = future ? '未来日期' : resource.loading ? '正在读取' : resource.error ? '用量暂不可用' : day ? `${fullCount(day.metrics.total)} Token，${costText(day.costs)}` : '没有匹配的记录'
          return <button key={date} className={`heat-cell${future ? ' future' : ''}`} data-level={level} data-date={date} type="button" disabled={future || resource.loading || resource.error !== undefined} aria-label={`${date}，${description}`} aria-pressed={date === selectedDate} tabIndex={date === tabDate ? 0 : -1} onPointerEnter={event => { if (event.pointerType !== 'touch') show(event.currentTarget) }} onPointerLeave={delayHide} onFocus={event => show(event.currentTarget)} onBlur={delayHide} onClick={event => show(event.currentTarget)} onKeyDown={event => {
            const shifts: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
            let target = event.key in shifts ? offsetDate(date, shifts[event.key]) : event.key === 'Home' ? start : event.key === 'End' ? today : undefined
            if (!target) return
            event.preventDefault(); target = target < start ? start : target > today ? today : target
            scroll.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus()
          }} />
        })}
      </div></div>
    </div></div>
    <div className="calendar-footer"><div className="heat-legend"><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>多</span></div></div>
    <div className="calendar-tooltip" ref={tooltip} role="tooltip" popover={popover} hidden={!hint} onPointerEnter={cancelHide} onPointerLeave={delayHide} onToggle={event => { if (event.newState === 'closed') close() }}>
      {hint && <><strong>{hint.date.replaceAll('-', '/')}</strong>{hintDay ? <><span className="tooltip-total">{fullCount(hintDay.metrics.total)} Token</span><span>{costText(hintDay.costs)}</span></> : <span>当前筛选下没有记录</span>}</>}
    </div>
  </section>
}
