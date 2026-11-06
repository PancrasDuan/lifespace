// Three throwaway variants of the adventure Today view, using synthetic data only.
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Compass, Flag, Home, ListTodo, Pencil, Plus, Search, Sprout, Star } from 'lucide-react'
import { Modal } from '../ui'
import { TaskDateField } from './TaskDateField'
import explorer from '../pixel-explorer.png'
import '../adventure.css'
import './prototype.css'

type Task = { id: number; title: string; place: string; planned: number; completed: number | null; description?: string; completedPlace?: string }
const original: Task[] = [
  { id: 1, title: '整理书桌和工作区', place: '独立任务', planned: -3, completed: null },
  { id: 2, title: '读完《也许你该找个人聊聊》一章', place: '丰富内心 / 保持阅读', planned: -1, completed: null },
  { id: 3, title: '出门散步三十分钟', place: '健康生活 / 找回好状态', planned: 0, completed: null },
  { id: 4, title: '写下今天的三个想法', place: '独立任务', planned: 0, completed: null },
  { id: 5, title: '准备一顿喜欢的早餐', place: '健康生活 / 好好生活', planned: 0, completed: 0 },
  { id: 6, title: '整理本周收获', place: '独立任务', planned: 1, completed: null },
  { id: 7, title: '完成一次力量训练', place: '健康生活 / 找回好状态', planned: 2, completed: null },
  { id: 8, title: '读书二十分钟', place: '丰富内心 / 保持阅读', planned: -2, completed: -2 },
  { id: 9, title: '给朋友打个电话', place: '独立任务', planned: -4, completed: -1 },
]
const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const today = new Date(`${now}T00:00:00Z`)
const dateAt = (offset: number) => new Date(today.getTime() + offset * 86400000)
const monthDay = (offset: number) => `${dateAt(offset).getUTCMonth() + 1}月${dateAt(offset).getUTCDate()}日`
const dayNames = ['一', '二', '三', '四', '五', '六', '日']
const names = ['A · 周历与任务', 'B · 紧凑日期栏', 'C · 日程侧栏']
function getVariant() { const v = new URLSearchParams(location.search).get('variant'); return v === 'B' || v === 'C' ? v : 'A' }
function App() {
  const [variant, setVariant] = useState(getVariant)
  const [selected, setSelected] = useState(0)
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState(original)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftDate, setDraftDate] = useState(now)
  const [draftPlace, setDraftPlace] = useState('独立任务')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [heightFloor, setHeightFloor] = useState(0)
  const preserveScrollSpace = () => {
    if (variant === 'A' && window.scrollY > 0) setHeightFloor(document.documentElement.scrollHeight)
  }
  useEffect(() => {
    const release = () => { if (window.scrollY <= 1) setHeightFloor(0) }
    window.addEventListener('scroll', release)
    return () => window.removeEventListener('scroll', release)
  }, [])
  const weekStart = selected - ((dateAt(selected).getUTCDay() + 6) % 7)
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i)
  const moveVariant = (direction: number) => {
    const variants = ['A', 'B', 'C']
    const next = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length]
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url); setVariant(next)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (editing !== null || deleting !== null || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return; if (event.key === 'ArrowLeft') moveVariant(-1); if (event.key === 'ArrowRight') moveVariant(1) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [variant, editing, deleting])
  const todayTasks = tasks.filter(t => (t.completed === 0 || (t.completed === null && t.planned <= 0)))
  const done = todayTasks.filter(t => t.completed === 0).length
  const visible = useMemo(() => tasks.filter(t => {
    const matchDate = (selected < 0 ? t.completed === selected : selected > 0 ? t.completed === null && t.planned === selected : t.completed === 0 || (t.completed === null && t.planned <= 0))
    return matchDate && `${t.title} ${t.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  }), [tasks, selected, search])
  const groups = selected === 0 ? [
    { title: '逾期待完成', tasks: visible.filter(t => t.completed === null && t.planned < 0).sort((a, b) => a.planned - b.planned) },
    { title: '今日待完成', tasks: visible.filter(t => t.completed === null && t.planned === 0) },
    { title: '今日已完成', tasks: visible.filter(t => t.completed === 0) },
  ] : [{ title: selected < 0 ? '当天已完成' : '当天待完成', tasks: visible }]
  const chooseDate = (day: number) => { preserveScrollSpace(); setExpanded(null); setEditing(null); setSelected(day) }
  const openEditor = (task?: Task) => {
    setDraftTitle(task?.title ?? '')
    setDraftDescription(task?.description ?? '')
    setDraftDate(task ? dateAt(task.planned).toISOString().slice(0, 10) : now)
    setDraftPlace(task?.place ?? '独立任务')
    setEditing(task ? task.id : 'new')
  }
  const editingTask = typeof editing === 'number' ? tasks.find(task => task.id === editing) : undefined
  const deletingTask = deleting === null ? undefined : tasks.find(task => task.id === deleting)
  const toggleDetails = (id: number) => { preserveScrollSpace(); setExpanded(current => current === id ? null : id) }
  const calendar = <div className="calendar"><div className="calendar-head"><div><strong>{dateAt(weekStart).getUTCFullYear()}年 {dateAt(weekStart).getUTCMonth() + 1}月</strong><span>{monthDay(weekStart)} — {monthDay(weekStart + 6)}</span></div><div className="calendar-actions"><button onClick={() => chooseDate(selected - 7)} aria-label="上一周"><ChevronLeft size={17}/></button><button onClick={() => chooseDate(selected + 7)} aria-label="下一周"><ChevronRight size={17}/></button><button className="back-today" onClick={() => chooseDate(0)}>回到今天</button></div></div><div className="days">{days.map((day, i) => <button key={day} className={`day ${selected === day ? 'selected' : ''}`} onClick={() => chooseDate(day)} aria-pressed={selected === day}><span>周{dayNames[i]}</span><strong>{dateAt(day).getUTCDate()}</strong>{day === 0 && <small>今天</small>}</button>)}</div></div>
  const progress = selected === 0 && <div className="task-progress"><div><span>今日进度</span><strong>{done} / {todayTasks.length}</strong></div><div className="progress-track"><span style={{ width: `${todayTasks.length ? done / todayTasks.length * 100 : 0}%` }}/></div></div>
  const rows = <div className="list-content">
    <div className="list-title"><div><h2>{selected === 0 ? '今天的行动' : `${monthDay(selected)}的行动`}</h2><p>{selected === 0 ? '把注意力放在眼前，一步一步来。' : selected < 0 ? '回看这一天完成的行动。' : '看看这一天计划要做什么。'}</p></div><label className="search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务" aria-label="搜索任务"/></label></div>
    {progress}
    {visible.length === 0 ? <div className="empty">{search ? '没有找到匹配的任务。' : selected < 0 ? '这一天没有完成记录。' : '这一天没有待完成的任务。'}</div> : groups.filter(group => group.tasks.length > 0).map(group => <section className="task-group" key={group.title}>
      <h3>{group.title}<span>{group.tasks.length}</span></h3><div className="task-list">{group.tasks.map(task => <article className={`task-record ${task.completed !== null ? 'done' : ''}`} key={task.id}>
        <div className={`task ${task.completed !== null ? 'done' : ''}`}>
          <button className="task-check" aria-label={`${task.completed === 0 ? '撤销完成' : '完成'} ${task.title}`} disabled={selected !== 0} onClick={() => { preserveScrollSpace(); setTasks(items => items.map(t => t.id === task.id ? { ...t, completed: t.completed === 0 ? null : 0, completedPlace: t.completed === 0 ? undefined : t.place } : t)) }}>{task.completed !== null ? <Check size={15}/> : <Circle size={19}/>}</button>
          <button className="task-copy" onClick={() => toggleDetails(task.id)} aria-expanded={expanded === task.id}><span>{task.completed !== null ? task.completedPlace ?? task.place : task.place}</span><strong>{task.title}</strong>{variant !== 'A' && <small>计划 {monthDay(task.planned)}{task.completed !== null && task.planned !== task.completed ? ` · 完成 ${monthDay(task.completed)}` : ''}</small>}</button>
          {variant === 'A' && <span className="task-dates"><span>计划 {monthDay(task.planned)}</span>{task.completed !== null && <span>完成 {monthDay(task.completed)}</span>}</span>}
          {task.completed === null && selected >= 0 && <button type="button" className="task-edit-button" aria-label={`编辑任务 ${task.title}`} onClick={() => openEditor(task)}><Pencil size={14}/><span>编辑</span></button>}<button type="button" className="task-expand" aria-label={`${expanded === task.id ? '收起' : '展开'}任务详情 ${task.title}`} aria-expanded={expanded === task.id} onClick={() => toggleDetails(task.id)}><ChevronDown size={16} className={expanded === task.id ? 'is-open' : ''}/></button>
        </div>
        {expanded === task.id && <div className="task-details"><p>{task.description || '这次行动没有填写说明。'}</p></div>}
      </article>)}</div>
    </section>)}
  </div>
  return <div className={`app variant-${variant}`} style={variant === 'A' && heightFloor ? { minHeight: heightFloor } : undefined}><aside className="sidebar"><div className="brand"><Compass size={23}/><div><b>LifeSpace</b><small>让生活有序生长</small></div></div><div className="side-label">工作台</div><div className="side-nav"><span><Home size={17}/> 首页</span><span><ListTodo size={17}/> 新闻</span><span className="active"><Compass size={17}/> 人生冒险</span></div><div className="side-foot">给生活留一点探索的空间</div></aside><main className="main"><header className="page-head"><h1>人生冒险</h1><p>把想做的事，慢慢变成现实。</p></header><div className="toolbar"><div><strong>新建</strong><small>从方向、目标或行动开始</small></div><div className="toolbar-actions"><span><Flag size={15}/> 新建主线</span><span><Sprout size={15}/> 新建目标</span><button type="button" className="primary" onClick={() => openEditor()}><Plus size={15}/> 新建行动</button></div></div><div className="growth"><div className="growth-level"><b>03</b><div><strong>当前等级</strong><small>再获得 12 点经验进入下一级</small><div className="level-line"><i/></div></div></div><div className="growth-stats"><span><b>28</b><small>累计经验</small></span><span><b>18</b><small>真实行动</small></span><span><b>2</b><small>达成目标</small></span></div></div><nav className="tabs"><span className="active">今日聚焦</span><span>主线与目标</span><span>成长记录</span></nav><div className="workspace"><div className="primary-col">{variant === 'A' && <>{calendar}{rows}</>}{variant === 'B' && <><div className="compact-header"><h2>一次性任务</h2><p>为每一天留一点行动的空间。</p></div>{calendar}{rows}</>}{variant === 'C' && <div className="split-layout"><div className="split-calendar">{calendar}</div>{rows}</div>}</div><aside className="aside"><div className="aside-box"><h3>下一处风景</h3><div><Star size={18}/><span><b>行动的力量</b><small>还差 2 次真实行动</small></span></div><div><Sprout size={18}/><span><b>新的起点</b><small>还差 1 个达成目标</small></span></div><a>查看完整成长记录 →</a></div><div className="aside-note"><img src={explorer} alt=""/><p>先走稳眼前这一步，<br/>远方自然会靠近。</p></div></aside></div><footer className="demo-note">示例数据 · 原型仅用于讨论界面</footer></main>{editing !== null && deleting === null && <Modal title={editing === 'new' ? '创建任务' : '编辑任务'} close={() => setEditing(null)}>
      <form onSubmit={event => { event.preventDefault(); if (!draftTitle.trim()) return; const planned = Math.round((new Date(`${draftDate}T00:00:00Z`).getTime() - today.getTime()) / 86400000); preserveScrollSpace(); if (editing === 'new') { setTasks(items => [...items, { id: Date.now(), title: draftTitle.trim(), description: draftDescription.trim(), place: draftPlace, planned, completed: null }]) } else { setTasks(items => items.map(task => task.id === editing ? { ...task, title: draftTitle.trim(), description: draftDescription.trim(), place: draftPlace, planned } : task)) } setEditing(null) }}><fieldset>
        <label>任务名称<input required maxLength={100} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}/></label>
        <label>任务说明<textarea rows={3} value={draftDescription} onChange={event => setDraftDescription(event.target.value)}/></label>
        <TaskDateField value={draftDate} onChange={setDraftDate} today={now} originalDate={editingTask ? dateAt(editingTask.planned).toISOString().slice(0, 10) : undefined}/>
        <label>任务归属<select value={draftPlace} onChange={event => setDraftPlace(event.target.value)}><option>独立任务</option><option>健康生活 / 找回好状态</option><option>健康生活 / 好好生活</option><option>丰富内心 / 保持阅读</option></select></label>
        <div className="adventure-form-footer task-editor-footer">{editingTask && <button type="button" className="delete-task" onClick={() => setDeleting(editingTask.id)}>删除任务</button>}<button type="button" onClick={() => setEditing(null)}>取消</button><button className="adventure-primary" type="submit">{editing === 'new' ? '创建任务' : '保存任务'}</button></div>
      </fieldset></form>
    </Modal>}{deletingTask && <Modal title="删除任务" close={() => setDeleting(null)}><p>确定删除“{deletingTask.title}”吗？删除后任务将从列表中移除。</p><div className="adventure-form-footer"><button type="button" onClick={() => setDeleting(null)}>取消</button><button type="button" className="adventure-primary" onClick={() => { preserveScrollSpace(); setTasks(items => items.filter(task => task.id !== deletingTask.id)); setDeleting(null); setEditing(null); setExpanded(null) }}>确认删除</button></div></Modal>}<div className="variant-switch" aria-label="原型方案切换"><button onClick={() => moveVariant(-1)} aria-label="上一个方案"><ArrowLeft size={16}/></button><span>{names['ABC'.indexOf(variant)]}</span><button onClick={() => moveVariant(1)} aria-label="下一个方案"><ArrowRight size={16}/></button></div></div>
}

createRoot(document.getElementById('root')!).render(<App />)
