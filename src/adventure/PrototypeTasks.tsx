import { useEffect, useState } from 'react'
import { ChevronDown, CircleCheck, ListTodo, Search } from 'lucide-react'
import type { PlanningPage, PlanningTask, TaskRange } from '../shared/adventure-planning'
import { PlanningTaskHistory } from './PlanningReschedule'
import { MoreActions, Progress, Record } from './PrototypeRecord'

export function PrototypeTasks({ data, blocked, openTask, toggleTask, changeRange, changeSearch, changePage, reschedule, migrate, edit, complete, cancel, end, remove }: {
  data: PlanningPage; blocked: boolean; openTask?: string; toggleTask: (id: string) => void
  changeRange: (range: TaskRange) => void; changeSearch: (search: string) => void; changePage: (page: number) => void
  reschedule: (task: PlanningTask) => void; migrate: (task: PlanningTask) => void; edit: (task: PlanningTask) => void; complete: (task: PlanningTask) => void
  cancel: (task: PlanningTask) => void; end: (task: PlanningTask) => void; remove: (task: PlanningTask) => void
}) {
  const [search, setSearch] = useState(data.search)
  useEffect(() => setSearch(data.search), [data.search])
  const label = data.taskRange === 'today' ? `今天 ${data.taskProgress.completed} / ${data.taskProgress.total}` : data.taskRange === 'future' ? '未来安排' : '过去安排'
  return <section className="content-section adventure-proto-task-section">
    <header className="section-heading task-section-heading">
      <div><span className="eyebrow">今天要做的事</span><h2><ListTodo size={18} />一次性任务</h2></div>
      <div className="task-heading-filters"><div className="date-filter" role="group" aria-label="任务日期范围">{(['today', 'future', 'past'] as const).map(range =>
        <button type="button" key={range} disabled={blocked} aria-pressed={data.taskRange === range} onClick={() => changeRange(range)}>{range === 'today' ? '今天' : range === 'future' ? '未来' : '过去'}</button>)}</div></div>
    </header>
    <div className="task-overview"><span role="group" aria-label="当前筛选任务进度">{data.taskProgress.ratio === null ? `${data.taskRange === 'today' ? '今天' : data.taskRange === 'future' ? '未来' : '过去'} · 暂无可统计任务` : label}</span>{data.taskProgress.ratio === null ? null : <Progress value={data.taskProgress.ratio} label="当前筛选任务进度" />}</div>
    <form className="task-tools" onSubmit={event => { event.preventDefault(); changeSearch(search) }}><label><Search size={14} /><span className="sr-only">搜索任务</span><input aria-label="搜索任务" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或说明" /></label></form>
    {data.tasks.length === 0 ? <p className="adventure-empty">这个日期范围暂无任务。</p> : <div className="record-list adventure-proto-task-list">{data.tasks.map(task => {
      const open = openTask === task.id
      return <Record key={task.id} label={`任务：${task.title}`} summaryLabel={`任务详情：${task.title}`} open={open} disabled={blocked} toggle={() => toggleTask(task.id)} className={`adventure-proto-task${task.status === 'completed' ? ' is-completed' : ''}`} summary={<>
        <span className={task.status === 'completed' ? 'task-state is-complete' : 'task-state'}>{task.status === 'completed' && <CircleCheck size={15} />}</span>
        <span className="record-copy"><span className="record-kicker">{task.independent ? '独立任务' : `${task.mainlineName} / ${task.goalTitle}`}</span><strong>{task.title}</strong><small>{task.plannedOn}{task.overdue ? ' · 逾期，仍待完成' : task.status === 'completed' ? ' · 已完成' : task.status === 'ended' ? ' · 已结束' : ' · 待完成'}</small></span>
        <span className="record-meta"><span>{task.reward ? `+${task.reward.amount} 经验` : task.overdue ? '待处理' : task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : '待完成'}</span><ChevronMarker open={open} /></span>
      </>}>
        <div className="task-detail-copy"><p>{task.description || '这次行动没有填写说明。'}</p>
          <dl className="plain-facts"><div><dt>安排</dt><dd>{task.plannedOn}</dd></div><div><dt>归属</dt><dd>{task.independent ? '独立任务' : `${task.mainlineName} / ${task.goalTitle}`}</dd></div><div><dt>状态</dt><dd>{task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : task.overdue ? '逾期待完成' : '待完成'}</dd></div></dl></div>
        <PlanningTaskHistory key={`${task.id}:${data.version}`} id={task.id} />
        <div className="record-actions">
          {task.status === 'completed' ? <>
            {task.reward && <span className="frozen-reward">本次奖励 {task.reward.amount} 点经验</span>}
            {task.capabilities.cancel?.allowed && <button disabled={blocked} onClick={() => cancel(task)}>取消完成</button>}
            <MoreActions><button disabled={blocked || !task.capabilities.migrate?.allowed} title={task.capabilities.migrate?.reason} onClick={() => migrate(task)}>迁移任务</button></MoreActions>
          </> : task.status === 'ended' ? <span className="terminal-note"><CircleCheck size={14} />任务已结束，只剩历史可以查看</span> : <>
            <button type="button" className="action-primary" disabled={blocked || !task.capabilities.complete?.allowed} title={task.capabilities.complete?.reason} onClick={() => complete(task)}>完成</button>
            <button disabled={blocked || !task.capabilities.reschedule?.allowed} title={task.capabilities.reschedule?.reason} onClick={() => reschedule(task)}>改期</button>
            <MoreActions>
              <button disabled={blocked || !task.capabilities.edit?.allowed} title={task.capabilities.edit?.reason} onClick={() => edit(task)}>编辑任务</button>
              <button disabled={blocked || !task.capabilities.migrate?.allowed} title={task.capabilities.migrate?.reason} onClick={() => migrate(task)}>迁移任务</button>
              <button disabled={blocked || !task.capabilities.end?.allowed} title={task.capabilities.end?.reason} onClick={() => end(task)}>结束任务</button>
              <button disabled={blocked || !task.capabilities.delete?.allowed} title={task.capabilities.delete?.reason} onClick={() => remove(task)}>删除误建</button>
            </MoreActions>
          </>}
        </div>
      </Record>
    })}</div>}
    {data.totalTasks > data.pageSize && <footer className="planning-pagination"><small>共 {data.totalTasks} 项 · 第 {data.taskPage} 页</small><div>
      <button disabled={blocked || data.taskPage <= 1} onClick={() => changePage(data.taskPage - 1)}>上一页</button>
      <button disabled={blocked || data.taskPage * data.pageSize >= data.totalTasks} onClick={() => changePage(data.taskPage + 1)}>下一页</button>
    </div></footer>}
  </section>
}

function ChevronMarker({ open }: { open: boolean }) { return <ChevronDown size={16} className={open ? 'record-chevron is-open' : 'record-chevron'} aria-hidden="true" /> }
