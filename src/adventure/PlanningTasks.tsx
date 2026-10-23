import { useEffect, useState, type FormEvent } from 'react'
import { Check, ListTodo } from 'lucide-react'
import type { PlanningCommand, PlanningPage, PlanningTask, TaskRange, TaskScope } from '../shared/adventure-planning'

import { useVerifiedIdentity } from '../auth/identity'
import { planningApi } from './planning-api'
import { PlanningTaskHistory } from './PlanningReschedule'
import { PlanningCompletionOrigin } from './PlanningCompletionOrigin'
import { PlanningProgress } from './PlanningProgress'
import { PlanningRecord, PlanningMore } from './PlanningRecord'

type Action = (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>
export function TaskForm({ task, destination: initialDestination, data: workspace, action, busy, close, changeGoalPage }: {
  task?: PlanningTask; destination?: string; data: PlanningPage; action: Action; busy: boolean; close: () => void; changeGoalPage: (page: number) => void
}) {
  const identity = useVerifiedIdentity()
  const [separateCandidates] = useState(!task && (workspace.goalScope === 'focus' || !!workspace.mainlineDetail))
  const [candidates, setCandidates] = useState<PlanningPage>()
  const [candidatePage, setCandidatePage] = useState(1)
  const [candidateError, setCandidateError] = useState(false)
  const [candidateRetry, setCandidateRetry] = useState(0)
  useEffect(() => {
    if (!separateCandidates) return
    const controller = new AbortController()
    setCandidateError(false)
    setCandidates(undefined)
    void planningApi.load(identity.ownerId, { page: candidatePage, goalScope: 'all', taskRange: 'today', taskPage: 1, taskScope: 'all', search: '', goalTaskPage: 1, includeTerminal: false }, AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)]))
      .then(value => { if (!controller.signal.aborted) setCandidates(value) })
      .catch(() => { if (!controller.signal.aborted) setCandidateError(true) })
    return () => controller.abort()
  }, [separateCandidates, candidatePage, candidateRetry, identity.ownerId, identity.signal])
  const data = separateCandidates ? candidates ?? { ...workspace, goals: [], totalGoals: 0 } : workspace
  const candidateBusy = separateCandidates && !candidates
  const changeCandidates = separateCandidates ? setCandidatePage : changeGoalPage
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
        {data.goals.filter(goal => goal.capabilities.createTask?.allowed).map(goal => <option key={goal.id} value={goal.id}>{goal.independent ? '独立目标' : goal.mainlineName} / {goal.title}</option>)}
      </select></label>
      {candidateBusy && <p role="status">{candidateError ? '暂时无法读取任务归属，请重试。' : '正在读取任务归属…'}</p>}
      {candidateError && <button type="button" onClick={() => setCandidateRetry(value => value + 1)}>重试任务归属</button>}
      {data.totalGoals > data.pageSize && <div className="planning-pagination"><small>目标候选 · 第 {data.page} 页</small><div>
        <button type="button" disabled={data.page <= 1} onClick={() => changeCandidates(data.page - 1)}>上一页目标</button>
        <button type="button" disabled={data.page * data.pageSize >= data.totalGoals} onClick={() => changeCandidates(data.page + 1)}>下一页目标</button>
      </div></div>}
    </>}
    {task && <p className="adventure-hint">{task.plannedOn} · {task.independent ? '独立任务' : task.goalTitle}</p>}
    <div className="adventure-form-footer"><button type="button" onClick={close}>取消</button>
      <button className="adventure-primary" type="submit" disabled={busy || candidateBusy}>{busy ? '正在保存…' : task ? '保存任务' : '创建任务'}</button></div>
  </fieldset></form>
}

export function PlanningTasks({ data, blocked, changeRange, changePage, changeScope, changeSearch, edit, complete, cancel, migrate, reschedule, end, remove }: {
  data: PlanningPage; blocked: boolean; changeRange: (range: TaskRange) => void; changePage: (page: number) => void;
  changeScope: (scope: TaskScope) => void; changeSearch: (search: string) => void;
  migrate: (task: PlanningTask) => void; edit: (task: PlanningTask) => void; complete: (task: PlanningTask) => void; cancel: (task: PlanningTask) => void;
  reschedule: (task: PlanningTask) => void; end: (task: PlanningTask) => void; remove: (task: PlanningTask) => void
}) {
  const [search, setSearch] = useState(data.search)
  const [expanded, setExpanded] = useState<string>()
  return <section className="planning-section planning-actions"><header><h2><ListTodo size={19} />一次性任务</h2>
    <div className="planning-task-ranges" aria-label="任务日期范围">{(['today', 'future', 'past'] as const).map((range, index) =>
      <button key={range} disabled={blocked} aria-pressed={data.taskRange === range} onClick={() => changeRange(range)}>{['今天', '未来', '过去'][index]}</button>)}</div>
  </header>
    <div className="planning-task-filters" title="按目标是否聚焦筛选任务；任务本身没有聚焦状态">
      <div className="planning-task-ranges" aria-label="任务视图">{(['all', 'focus'] as const).map(scope =>
        <button key={scope} disabled={blocked} aria-pressed={data.taskScope === scope} title={scope === 'all' ? '显示全部目标下的任务及独立任务' : '只显示聚焦目标下的任务，独立任务仍会保留'} onClick={() => changeScope(scope)}>{scope === 'all' ? '全部任务' : '只看聚焦目标'}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); changeSearch(search) }}>
        <label>搜索任务<input type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="名称或说明" /></label>
        <button type="submit" disabled={blocked}>搜索</button>
      </form>
    </div>
    <PlanningProgress value={data.taskProgress} label="当前筛选任务进度" />
    {data.tasks.length === 0 ? <p className="adventure-empty">这个日期范围暂无任务。</p> : <div className="planning-task-list">{data.tasks.map(task => <article key={task.id} aria-label={`任务：${task.title}`} className={task.status === 'completed' ? 'planning-task completed' : 'planning-task'}>
      <PlanningRecord label={`任务详情：${task.title}`} open={expanded === task.id} disabled={blocked} toggle={() => setExpanded(expanded === task.id ? undefined : task.id)} summary={<>
        <span className="planning-record-mark">{task.status === 'completed' ? <Check size={18} /> : <span className="planning-task-circle" />}</span>
        <span className="planning-record-copy"><small>{task.independent ? '独立任务' : `${task.mainlineName} / ${task.goalTitle}`}</small><strong>{task.title}</strong><small>{task.plannedOn} · {task.overdue ? '逾期，仍待完成' : task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : '待完成'}</small></span>
        <span className="planning-record-meta">{task.reward ? `+${task.reward.amount} 经验` : task.status === 'ended' ? '已结束' : '待完成'}</span>
      </>}>
        {task.description && <p>{task.description}</p>}
        {task.reward && <p>本次奖励 {task.reward.amount} 点经验</p>}
        {task.completionOrigin && <p><PlanningCompletionOrigin origin={task.completionOrigin} /></p>}
        <PlanningTaskHistory key={`${task.id}:${data.version}`} id={task.id} />
        <div className="planning-record-actions">
          {task.status === 'completed' ? <button disabled={blocked || !task.capabilities.cancel?.allowed} title={task.capabilities.cancel?.reason} onClick={() => cancel(task)}>取消完成</button>
            : <button className="adventure-primary" disabled={blocked || !task.capabilities.complete?.allowed} title={task.capabilities.complete?.reason} onClick={() => complete(task)}>完成</button>}
          <PlanningMore>
            <button disabled={blocked || !task.capabilities.reschedule?.allowed} title={task.capabilities.reschedule?.reason} onClick={() => reschedule(task)}>改期</button>
            <button disabled={blocked || !task.capabilities.migrate?.allowed} title={task.capabilities.migrate?.reason} onClick={() => migrate(task)}>迁移任务</button>
            <button disabled={blocked || !task.capabilities.edit?.allowed} title={task.capabilities.edit?.reason} onClick={() => edit(task)}>编辑任务</button>
            <button disabled={blocked || !task.capabilities.end?.allowed} title={task.capabilities.end?.reason} onClick={() => end(task)}>结束任务</button>
            <button disabled={blocked || !task.capabilities.delete?.allowed} title={task.capabilities.delete?.reason} onClick={() => remove(task)}>删除误建</button>
          </PlanningMore>
        </div>
      </PlanningRecord>
    </article>)}</div>}
    <footer className="planning-pagination"><small>共 {data.totalTasks} 项 · 第 {data.taskPage} 页</small><div>
      <button disabled={blocked || data.taskPage <= 1} onClick={() => changePage(data.taskPage - 1)}>上一页任务</button>
      <button disabled={blocked || data.taskPage * data.pageSize >= data.totalTasks} onClick={() => changePage(data.taskPage + 1)}>下一页任务</button>
    </div></footer>
  </section>
}
