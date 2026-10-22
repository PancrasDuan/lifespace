import { useState, type FormEvent } from 'react'
import { Check, ListTodo } from 'lucide-react'
import type { PlanningCommand, PlanningPage, PlanningTask, TaskRange, TaskScope } from '../shared/adventure-planning'

import { PlanningArrangements } from './PlanningReschedule'
import { PlanningCompletionOrigin } from './PlanningCompletionOrigin'
import { PlanningProgress } from './PlanningProgress'

type Action = (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>
export function TaskForm({ task, destination: initialDestination, data, action, busy, close, changeGoalPage }: {
  task?: PlanningTask; destination?: string; data: PlanningPage; action: Action; busy: boolean; close: () => void; changeGoalPage: (page: number) => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [plannedOn, setPlannedOn] = useState(data.today)
  const [destination, setDestination] = useState(initialDestination ?? '')
  const [selectedLabel, setSelectedLabel] = useState(data.goals.find(goal => goal.id === initialDestination)?.title ?? '')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const command: PlanningCommand = task ? { type: 'editTask', id: task.id, title, description }
      : { type: 'createTask', title, description, plannedOn, destination }
    if (await action(command)) close()
  }
  return <form onSubmit={event => { void submit(event) }}><fieldset disabled={busy}>
    <label>任务名称<input required maxLength={data.limits.name} autoComplete="off" value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>任务说明<textarea aria-label="任务说明" maxLength={4000} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {!task && <>
      <label>执行日期<input required type="date" value={plannedOn} onChange={event => setPlannedOn(event.target.value)} /></label>
      <label>任务归属<select aria-label="任务归属" className={destination ? undefined : 'planning-destination-placeholder'} value={destination} onChange={event => { setDestination(event.target.value); setSelectedLabel(event.target.selectedOptions[0].text) }}>
        <option value="">默认独立任务</option>
        {destination && !data.goals.some(goal => goal.id === destination) && <option value={destination}>{selectedLabel}</option>}
        {data.goals.map(goal => <option key={goal.id} value={goal.id} disabled={!goal.capabilities.createTask?.allowed}>{goal.independent ? '独立目标' : goal.mainlineName} / {goal.title}{goal.capabilities.createTask?.allowed ? '' : ' · 只读'}</option>)}
      </select></label>
      {data.totalGoals > data.pageSize && <div className="planning-pagination"><small>目标候选 · 第 {data.page} 页</small><div>
        <button type="button" disabled={data.page <= 1} onClick={() => changeGoalPage(data.page - 1)}>上一页目标</button>
        <button type="button" disabled={data.page * data.pageSize >= data.totalGoals} onClick={() => changeGoalPage(data.page + 1)}>下一页目标</button>
      </div></div>}
    </>}
    {task && <p className="adventure-hint">{task.plannedOn} · {task.independent ? '独立任务' : task.goalTitle}</p>}
    <div className="adventure-form-footer"><button type="button" onClick={close}>取消</button>
      <button className="adventure-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : task ? '保存任务' : '创建任务'}</button></div>
  </fieldset></form>
}

export function PlanningTasks({ data, blocked, changeRange, changePage, changeScope, changeSearch, openGoal, edit, complete, cancel, migrate, reschedule, end, remove }: {
  data: PlanningPage; blocked: boolean; changeRange: (range: TaskRange) => void; changePage: (page: number) => void;
  changeScope: (scope: TaskScope) => void; changeSearch: (search: string) => void;
  openGoal: (id: string) => void;
  migrate: (task: PlanningTask) => void; edit: (task: PlanningTask) => void; complete: (task: PlanningTask) => void; cancel: (task: PlanningTask) => void;
  reschedule: (task: PlanningTask) => void; end: (task: PlanningTask) => void; remove: (task: PlanningTask) => void
}) {
  const [search, setSearch] = useState(data.search)
  return <section className="planning-section planning-actions"><header><h2><ListTodo size={19} />一次性任务</h2>
    <div className="planning-task-ranges" aria-label="任务日期范围">{(['today', 'future', 'past'] as const).map((range, index) =>
      <button key={range} disabled={blocked} aria-pressed={data.taskRange === range} onClick={() => changeRange(range)}>{['今天', '未来', '过去'][index]}</button>)}</div>
  </header>
    <div className="planning-task-filters">
      <div className="planning-task-ranges" aria-label="任务视图">{(['all', 'focus'] as const).map(scope =>
        <button key={scope} disabled={blocked} aria-pressed={data.taskScope === scope} onClick={() => changeScope(scope)}>{scope === 'all' ? '全部任务' : '聚焦任务'}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); changeSearch(search) }}>
        <label>搜索任务<input type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="名称或说明" /></label>
        <button type="submit" disabled={blocked}>搜索</button>
      </form>
    </div>
    <PlanningProgress value={data.taskProgress} label="当前筛选任务进度" />
    {data.tasks.length === 0 ? <p className="adventure-empty">这个日期范围暂无任务。</p> : <div className="planning-task-list">{data.tasks.map(task => <article key={task.id} aria-label={`任务：${task.title}`} className={task.status === 'completed' ? 'planning-task completed' : 'planning-task'}>
      <div><small className="planning-destination">{task.independent ? '独立任务' : `${task.mainlineName} / ${task.goalTitle}`}</small>
        {task.goalId && <button disabled={blocked} className="planning-goal-link" onClick={() => openGoal(task.goalId!)}>查看所属目标</button>}
        <h3>{task.status === 'completed' && <Check size={16} aria-hidden="true" />}{task.title}</h3>
        {task.description && <p>{task.description}</p>}
        <small>{task.plannedOn} · {task.overdue ? '逾期，仍待完成' : task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : '待完成'}</small>
        <PlanningArrangements task={task} />
        {task.reward && <small>本次奖励 {task.reward.amount} 点经验</small>}
        {task.completionOrigin && <small><PlanningCompletionOrigin origin={task.completionOrigin} /></small>}
      </div><div className="planning-task-buttons">
        <button disabled={blocked || !task.capabilities.reschedule?.allowed} title={task.capabilities.reschedule?.reason} onClick={() => reschedule(task)}>改期</button>
        <button disabled={blocked || !task.capabilities.migrate?.allowed} title={task.capabilities.migrate?.reason} onClick={() => migrate(task)}>迁移任务</button>
        <button disabled={blocked || !task.capabilities.edit?.allowed} title={task.capabilities.edit?.reason} onClick={() => edit(task)}>编辑任务</button>
        <button disabled={blocked || !task.capabilities.end?.allowed} title={task.capabilities.end?.reason} onClick={() => end(task)}>结束任务</button>
        <button disabled={blocked || !task.capabilities.delete?.allowed} title={task.capabilities.delete?.reason} onClick={() => remove(task)}>删除误建</button>
        {task.status === 'completed' ? <button disabled={blocked || !task.capabilities.cancel?.allowed} title={task.capabilities.cancel?.reason} onClick={() => cancel(task)}>取消完成</button>
          : <button className="adventure-primary" disabled={blocked || !task.capabilities.complete?.allowed} title={task.capabilities.complete?.reason} onClick={() => complete(task)}>完成</button>}
      </div>
    </article>)}</div>}
    <footer className="planning-pagination"><small>共 {data.totalTasks} 项 · 第 {data.taskPage} 页</small><div>
      <button disabled={blocked || data.taskPage <= 1} onClick={() => changePage(data.taskPage - 1)}>上一页任务</button>
      <button disabled={blocked || data.taskPage * data.pageSize >= data.totalTasks} onClick={() => changePage(data.taskPage + 1)}>下一页任务</button>
    </div></footer>
  </section>
}
