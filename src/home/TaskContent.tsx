import type { UseQueryResult } from '@tanstack/react-query'
import { ChevronRight, Sun } from 'lucide-react'
import type { TasksResult } from '../shared/contracts'
import { clock, dayText } from './time'

export function TaskContent({ query, localZone }: { query: UseQueryResult<TasksResult, Error>; localZone: string }) {
  if (!query.data) return <div className="data-message" role="status">{query.isPending ? '正在获取今日待办…' : query.error?.message ?? '待办获取失败'}</div>
  const tasks = query.data.tasks
  return <><div className={tasks.length ? 'task-content' : 'empty-tasks'}>{tasks.length ? <>
    <div className="task-count"><strong>{String(tasks.length).padStart(2, '0')}</strong><span>件事，慢慢做好</span></div>
    <div className="task-list">{tasks.slice(0, 3).map((task, index) => <div className="task-row" key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task.title}</strong><span>{clock(new Date(task.plannedAt * 1000), localZone)}<i />{task.area}{task.dueAt !== null && <small>截止 {clock(new Date(task.dueAt * 1000), localZone)}</small>}</span></div><ChevronRight size={15} /></div>)}</div>
  </> : <><Sun size={36} strokeWidth={1.1} /><strong>今天没有待办</strong><span>给自己留一点自由时间</span></>}</div>{query.isError && <p className="inline-error">更新失败 · 正在显示上次结果</p>}</>
}
export function TaskDetail({ query, localZone }: { query: UseQueryResult<TasksResult, Error>; localZone: string }) {
  return <><p className="detail-note">今日待办 · 只读</p>{query.data?.tasks.length ? <ol className="detail-task-list">{query.data.tasks.map(task => <li key={task.id}><strong>{task.title}</strong><p>计划 · {dayText(new Date(task.plannedAt * 1000), localZone)} {clock(new Date(task.plannedAt * 1000), localZone)}{task.dueAt !== null && <><br />截止 · {dayText(new Date(task.dueAt * 1000), localZone)} {clock(new Date(task.dueAt * 1000), localZone)}</>}</p><span>{task.area} · 待办</span></li>)}</ol> : <TaskContent query={query} localZone={localZone} />}{query.isError && query.data?.tasks.length ? <p className="inline-error">更新失败 · 正在显示上次结果</p> : null}</>
}
