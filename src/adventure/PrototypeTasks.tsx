import { useEffect, useRef, useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Pencil, Search } from 'lucide-react'
import type { PlanningPage, PlanningTask } from '../shared/adventure-planning'
import { Progress } from './PrototypeRecord'
import { useDateTasks } from './useDateTasks'
import './today-tasks.css'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const monthDay = (day: Temporal.PlainDate) => `${day.month}月${day.day}日`
const taskDate = (value: string) => monthDay(Temporal.PlainDate.from(value))

export function PrototypeTasks({ data, blocked, reload, openTask, toggleTask, edit, complete, cancel }: {
  data: PlanningPage; blocked: boolean; reload: () => Promise<void>; openTask?: string; toggleTask: (id: string) => void
  edit: (task: PlanningTask) => void; complete: (task: PlanningTask) => void; cancel: (task: PlanningTask) => void
}) {
  const [date, setDate] = useState(data.today)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [minimumHeight, setMinimumHeight] = useState(0)
  const section = useRef<HTMLElement>(null)
  const list = useDateTasks(data, date)
  const selected = Temporal.PlainDate.from(date)
  const start = selected.subtract({ days: selected.dayOfWeek - 1 })
  const isToday = date === data.today
  const preserveSpace = () => {
    if (window.scrollY <= 1) { setMinimumHeight(0); return }
    const height = section.current?.getBoundingClientRect().height ?? 0
    const roomBelow = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)
    setMinimumHeight(current => Math.max(current, Math.ceil(Math.max(0, height - roomBelow))))
  }
  useEffect(() => {
    if (!minimumHeight) return
    const release = () => {
      if (window.scrollY <= 1) { setMinimumHeight(0); return }
      const roomBelow = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)
      if (roomBelow >= 1) setMinimumHeight(current => Math.max(0, current - Math.floor(roomBelow)))
    }
    window.addEventListener('scroll', release, { passive: true })
    window.addEventListener('resize', release)
    return () => { window.removeEventListener('scroll', release); window.removeEventListener('resize', release) }
  }, [minimumHeight])
  const chooseDate = (value: string) => { preserveSpace(); setDate(value); setPage(1); if (openTask) toggleTask(openTask) }
  const toggle = (id: string) => { preserveSpace(); toggleTask(id) }
  const term = search.trim().toLowerCase()
  const filtered = list.result?.tasks.filter(task => !term || task.title.toLowerCase().includes(term) || task.description.toLowerCase().includes(term)) ?? []
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20))
  const activePage = Math.min(page, pageCount)
  const visible = filtered.slice((activePage - 1) * 20, activePage * 20)
  const groupDefinitions = isToday ? [
    { title: '逾期待完成', matches: (task: PlanningTask) => task.status === 'pending' && task.plannedOn < data.today },
    { title: '今日待完成', matches: (task: PlanningTask) => task.status === 'pending' && task.plannedOn === data.today },
    { title: '今日已完成', matches: (task: PlanningTask) => task.status === 'completed' },
  ] : [{ title: date < data.today ? '当天已完成' : '当天待完成', matches: () => true }]
  const groups = groupDefinitions.map(group => ({ title: group.title, tasks: visible.filter(group.matches), total: filtered.filter(group.matches).length }))
  const rowBlocked = blocked || !list.result
  return <section ref={section} className="today-tasks" style={minimumHeight ? { minHeight: minimumHeight } : undefined}>
    <div className="today-calendar" role="group" aria-label="任务周历">
      <div className="today-calendar-head"><div><strong>{start.year}年 {start.month}月</strong><span>{monthDay(start)} — {monthDay(start.add({ days: 6 }))}</span></div>
        <div className="today-calendar-actions"><button type="button" aria-label="上一周" onClick={() => chooseDate(selected.subtract({ days: 7 }).toString())}><ChevronLeft size={17} /></button><button type="button" aria-label="下一周" onClick={() => chooseDate(selected.add({ days: 7 }).toString())}><ChevronRight size={17} /></button><button type="button" className="today-back" onClick={() => chooseDate(data.today)}>回到今天</button></div></div>
      <div className="today-days">{weekdays.map((name, index) => {
        const day = start.add({ days: index }).toString()
        return <button key={day} type="button" aria-label={`选择日期 ${day}`} aria-pressed={day === date} onClick={() => chooseDate(day)}><span>周{name}</span><strong>{start.add({ days: index }).day}</strong>{day === data.today && <small>今天</small>}</button>
      })}</div>
    </div>
    <div className="today-list">
      <header className="today-list-heading"><div><h2>{isToday ? '今天的行动' : `${monthDay(selected)}的行动`}</h2><p>{isToday ? '把注意力放在眼前，一步一步来。' : date < data.today ? '回看这一天完成的行动。' : '看看这一天计划要做什么。'}</p></div>
        <label className="today-search"><Search size={16} /><input type="search" aria-label="搜索任务" maxLength={100} value={search} onChange={event => { preserveSpace(); setSearch(event.target.value); setPage(1) }} placeholder="搜索任务" /></label></header>
      {!list.result && !list.error && <p role="status">正在读取当天任务{list.loaded ? `，已读取 ${list.loaded} 项` : ''}…</p>}
      {list.error && <div role="alert" className="planning-recovery"><p>{list.error}</p><button type="button" disabled={blocked} onClick={() => { void reload().then(list.retry) }}>重新读取任务</button></div>}
      {list.result && <>
        {isToday && <div className="today-progress"><div role="group" aria-label="今日任务进度"><span>今日进度</span><strong>{list.result.progress.completed} / {list.result.progress.total}</strong></div>{list.result.progress.ratio === null ? <small>暂无可统计任务</small> : <Progress value={list.result.progress.ratio} label="今日任务进度" />}</div>}
        {filtered.length === 0 ? <p className="today-empty">{term ? '没有找到匹配的任务。' : date < data.today ? '这一天没有完成记录。' : '这一天没有待完成的任务。'}</p> : groups.filter(group => group.tasks.length).map(group => <section className="today-task-group" key={group.title}><h3>{group.title}<span>{group.total}</span></h3><div className="today-task-list">{group.tasks.map(task => {
          const open = openTask === task.id
          const completed = task.status === 'completed'
          const capability = completed ? task.capabilities.cancel : task.capabilities.complete
          const detailsId = `today-task-${task.id}`
          return <article key={task.id} aria-label={`任务：${task.title}`} className={`adventure-proto-task today-task-record${completed ? ' is-completed' : ''}`}>
            <div className="today-task-row">
              <button type="button" className="today-task-check" aria-label={completed ? '取消完成' : '完成'} aria-describedby={`${detailsId}-title`} disabled={rowBlocked || !isToday || !capability?.allowed} title={capability?.reason} onClick={() => { preserveSpace(); if (completed) cancel(task); else complete(task) }}>{completed ? <Check size={15} /> : <Circle size={19} />}</button>
              <button type="button" className="today-task-copy" aria-label={`任务详情：${task.title}`} aria-expanded={open} aria-controls={detailsId} disabled={rowBlocked} onClick={() => toggle(task.id)}><span>{task.independent ? '独立任务' : task.goalTitle}</span><strong id={`${detailsId}-title`}>{task.title}</strong></button>
              <span className="today-task-dates"><span title={task.plannedOn}>计划 {taskDate(task.plannedOn)}</span>{task.completedOn && <span title={task.completedOn}>完成 {taskDate(task.completedOn)}</span>}</span>
              {!completed && date >= data.today && <button type="button" className="today-task-edit" aria-label="编辑任务" aria-describedby={`${detailsId}-title`} disabled={rowBlocked || !task.capabilities.edit?.allowed} title={task.capabilities.edit?.reason} onClick={() => edit(task)}><Pencil size={14} /><span>编辑</span></button>}
              <button type="button" className="today-task-expand" aria-label={`${open ? '收起' : '展开'}任务详情 ${task.title}`} aria-expanded={open} aria-controls={detailsId} disabled={rowBlocked} onClick={() => toggle(task.id)}><ChevronDown size={16} className={open ? 'is-open' : ''} /></button>
            </div>
            {open && <div className="today-task-details" id={detailsId}><p>{task.description || '这次行动没有填写说明。'}</p></div>}
          </article>
        })}</div></section>)}
        {filtered.length > 20 && <footer className="planning-pagination"><small>共 {filtered.length} 项 · 第 {activePage} 页</small><div><button disabled={activePage <= 1} onClick={() => { preserveSpace(); setPage(activePage - 1) }}>上一页任务</button><button disabled={activePage >= pageCount} onClick={() => { preserveSpace(); setPage(activePage + 1) }}>下一页任务</button></div></footer>}
      </>}
    </div>
  </section>
}
