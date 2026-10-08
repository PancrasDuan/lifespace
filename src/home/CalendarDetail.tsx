import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { calendarDetail, calendarMonth, calendarYearRange, changeCalendarMonth, solarFromKey, solarKey, type WeekStart } from './calendar'
import { dateKey } from './time'
import { CalendarPicker } from './CalendarPicker'
import './calendar.css'

const weekPreferenceKey = 'lifespace-calendar-week-start'
function loadWeekStart(): WeekStart {
  try { return localStorage.getItem(weekPreferenceKey) === '0' ? 0 : 1 }
  catch { return 1 }
}
function AlmanacRow({ label, kind, children }: { label: string; kind?: string; children: ReactNode }) {
  return <div className={`calendar-fact ${kind ?? ''}`}><dt>{label}</dt><dd>{children}</dd></div>
}

export function CalendarDetail({ now, timeZone }: { now: Date; timeZone: string }) {
  const todayKey = dateKey(now, timeZone)
  const [selection, setSelection] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<WeekStart>(loadWeekStart)
  const today = useMemo(() => solarFromKey(todayKey), [todayKey])
  const selectedKey = selection ?? todayKey
  const selected = useMemo(() => solarFromKey(selectedKey), [selectedKey])
  const cells = useMemo(() => calendarMonth(selected, weekStart), [selected, weekStart])
  const detail = useMemo(() => calendarDetail(selected, weekStart, today), [selected, weekStart, today])
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollTime = useRef(-Infinity)
  const year = selected.getYear(), month = selected.getMonth()
  const choose = (key: string) => setSelection(key === todayKey ? null : key)
  const moveMonth = (amount: number) => {
    if ((year === calendarYearRange.min && month === 1 && amount < 0) || (year === calendarYearRange.max && month === 12 && amount > 0)) return
    const target = selected.getSolarMonth().next(amount)
    choose(solarKey(target.getFirstDay()))
  }
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return
      event.preventDefault()
      const timestamp = performance.now()
      if (timestamp - scrollTime.current < 150) return
      scrollTime.current = timestamp
      moveMonth(event.deltaY < 0 ? -1 : 1)
    }
    grid.addEventListener('wheel', wheel, { passive: false })
    return () => grid.removeEventListener('wheel', wheel)
  })
  const switchWeek = () => {
    const value = weekStart === 1 ? 0 : 1
    setWeekStart(value)
    try { localStorage.setItem(weekPreferenceKey, String(value)) } catch { /* 存储不可用时仍可切换本次视图。 */ }
  }
  const weekdays = weekStart === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六']
  return <div className="calendar-detail-layout">
    <section className="calendar-month-panel" aria-label="月历">
      <div className="calendar-controls">
        <CalendarPicker kind="year" year={year} month={month} select={(nextYear, nextMonth) => choose(solarKey(changeCalendarMonth(nextYear, nextMonth)))} />
        <button aria-label="上个月" onClick={() => moveMonth(-1)} disabled={year === calendarYearRange.min && month === 1}><ChevronLeft size={18} /></button>
        <CalendarPicker kind="month" year={year} month={month} select={(nextYear, nextMonth) => choose(solarKey(changeCalendarMonth(nextYear, nextMonth)))} />
        <button aria-label="下个月" onClick={() => moveMonth(1)} disabled={year === calendarYearRange.max && month === 12}><ChevronRight size={18} /></button>
        <button className="calendar-today-button" onClick={() => setSelection(null)}>今</button>
        <button className="calendar-week-switch" role="switch" aria-label="一周从周一开始" aria-checked={weekStart === 1} title={`一周从周${weekStart === 1 ? '一' : '日'}开始`} onClick={switchWeek}><span />{weekStart === 1 ? '一' : '日'}</button>
      </div>
      <h3 className="calendar-month-heading">{year} 年 {month} 月</h3>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map(name => <span key={name} className={name === '六' || name === '日' ? 'weekend' : ''}>{name}</span>)}</div>
      <div className="calendar-month-grid" ref={gridRef} aria-label={`${year}年${month}月日期`}>
        <span className="calendar-month-watermark" aria-hidden="true">{month}</span>
        {cells.map((cell, index) => {
          if (!cell) return <span key={`empty-${index}`} />
          const { key, solar, label, special, holiday } = cell
          const classes = ['calendar-date', solar.getMonth() !== month ? 'outside' : '', solar.getWeek().getIndex() % 6 === 0 ? 'weekend' : '', holiday === '休' ? 'holiday' : '', holiday === '班' ? 'workday' : '', key === todayKey ? 'today' : '', key === selectedKey ? 'selected' : ''].filter(Boolean).join(' ')
          return <button key={key} className={classes} aria-label={`${key} ${label}${holiday ? ` ${holiday}` : ''}`} aria-pressed={key === selectedKey} aria-current={key === todayKey ? 'date' : undefined} onClick={() => choose(key)}>
            {holiday && <span className={`calendar-holiday-badge ${holiday === '班' ? 'work' : ''}`}>{holiday}</span>}
            <strong>{String(solar.getDay()).padStart(2, '0')}</strong><span className={special ? 'special' : ''}>{label}</span>
          </button>
        })}
      </div>
    </section>
    <section className="calendar-almanac" aria-label="所选日期详情" aria-live="polite">
      <div className="calendar-selected-summary"><p>{detail.key} {detail.weekday}</p><strong className="calendar-date-tile">{detail.day}</strong><p>{detail.lunar}<br />{detail.year}<br />本年第{detail.week}周，第{detail.dayOfYear}天</p></div>
      {detail.distance !== 0 && <p className="calendar-distance">{detail.distance > 0 ? `距离${detail.key.replace(/^(\d+)-(\d+)-(\d+)$/, '$1年$2月$3日')}还有${detail.distance}天` : `距离${detail.key.replace(/^(\d+)-(\d+)-(\d+)$/, '$1年$2月$3日')}已经过去${Math.abs(detail.distance)}天`}</p>}
      <dl className="calendar-facts">
        <AlmanacRow label="生肖" kind="zodiac">{detail.zodiac}</AlmanacRow>
        <AlmanacRow label="星座" kind="constellation">{detail.constellation} <span aria-hidden="true">{detail.constellationSymbol}</span></AlmanacRow>
        {detail.festivals.length > 0 && <AlmanacRow label="节日" kind="festival">{detail.festivals.join('，')}</AlmanacRow>}
        <AlmanacRow label="宜" kind="good">{detail.recommends}</AlmanacRow>
        <AlmanacRow label="忌" kind="avoid">{detail.avoids}</AlmanacRow>
        <div className="calendar-phase-row"><AlmanacRow label="月相">{detail.phase}</AlmanacRow><AlmanacRow label="物候">{detail.phenology}</AlmanacRow></div>
        <div className="calendar-directions">{detail.directions.map(([name, direction]) => <div key={name}><dt>{name}：</dt><dd>{direction}</dd></div>)}</div>
      </dl>
    </section>
  </div>
}
