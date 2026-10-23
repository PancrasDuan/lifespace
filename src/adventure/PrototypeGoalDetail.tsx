import { CircleCheck } from 'lucide-react'
import type { PlanningGoal, PlanningPage } from '../shared/adventure-planning'
import { MoreActions } from './PrototypeRecord'
import { PlanningCompletionOrigin } from './PlanningCompletionOrigin'
import { PlanningTaskHistory } from './PlanningReschedule'

export function PrototypeGoalDetail({ goal, history, pageSize, blocked, edit, addTask, focus, achieve, migrate, end, changePage, reorder }: {
  goal: PlanningGoal; history: PlanningPage['goalDetail']; pageSize: number; blocked: boolean
  edit: () => void; addTask: () => void; focus: () => void; achieve: () => void; migrate: () => void; end: () => void; changePage: (page: number) => void
  reorder?: React.ReactNode
}) {
  const active = goal.status === 'active'
  return <>
    <p className="muted">创建时间：{new Date(goal.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
    <p>{goal.status === 'achieved' ? '已达成 · 结果已冻结' : goal.status === 'ended' ? '已结束 · 只读' : '进行中'}</p>{goal.terminatedAt && <p className="muted">终态时间：{new Date(goal.terminatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
    <div className="details-columns"><section><h3>完成标准</h3><ul className="plain-list">{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul></section>
      <section><h3>当前进度</h3><p>{goal.progress.completed} 项完成，共 {goal.progress.total} 项行动。</p><p className="muted">任务全部完成不等于目标已经达成，由你确认实际结果。</p>
        {goal.achievement && <><p>目标奖励 {goal.achievement.reward.amount} 点经验 · 计奖行动 {goal.achievement.reward.calculation.count} 次 · 系数 {goal.achievement.reward.calculation.coefficient}</p>{goal.achievement.reward.calculation.fallback && <p className="muted">无有效计奖行动，使用 1 点保底奖励。</p>}<p>达成感想：{goal.achievement.reflection || '未填写'}</p></>}
      </section></div>
    <div className="record-actions">
      {active ? <><button type="button" className="action-primary" disabled={blocked || !goal.capabilities.achieve?.allowed} title={goal.capabilities.achieve?.reason} onClick={achieve}>确认达成</button>
        <button disabled={blocked || !goal.capabilities.focus?.allowed} title={goal.capabilities.focus?.reason} onClick={focus}>{goal.focused ? '取消聚焦' : '聚焦'}</button>
        <MoreActions><button disabled={blocked || !goal.capabilities.edit?.allowed} onClick={edit}>编辑目标</button><button disabled={blocked || !goal.capabilities.createTask?.allowed} title={goal.capabilities.createTask?.reason} onClick={addTask}>添加任务</button><button disabled={blocked || !goal.capabilities.migrate?.allowed} title={goal.capabilities.migrate?.reason} onClick={migrate}>迁移目标</button><button disabled={blocked || !goal.capabilities.end?.allowed} title={goal.capabilities.end?.reason} onClick={end}>结束目标</button></MoreActions>{reorder && <div className="goal-reorder-actions">{reorder}</div>}</>
        : <span className="terminal-note"><CircleCheck size={14} />{goal.status === 'achieved' ? '结果已冻结，只剩历史可以查看' : '目标已结束，只剩历史可以查看'}</span>}
    </div>
    {history && <section role="region" aria-label="目标任务历史"><h4>任务历史</h4>
      {history.tasks.length ? <ul className="plain-list">{history.tasks.map(task => <li key={task.id}>{task.title} · {task.plannedOn} · {task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : '待完成'}{task.reward ? ` · 冻结奖励 ${task.reward.amount} 点经验` : ''}{task.completionOrigin && <> · <PlanningCompletionOrigin origin={task.completionOrigin} /></>}{task.goalId !== goal.id ? ` · 当前已迁出至 ${task.goalTitle ?? '独立任务'}` : ''}<PlanningTaskHistory key={`${task.id}:${goal.id}:${history.taskPage}`} id={task.id} /></li>)}</ul> : <p>暂无任务历史。</p>}
      {history.totalTasks > pageSize && <div className="planning-pagination"><small>共 {history.totalTasks} 项 · 第 {history.taskPage} 页</small><div><button disabled={blocked || history.taskPage <= 1} onClick={() => changePage(history.taskPage - 1)}>上一页历史</button><button disabled={blocked || history.taskPage * pageSize >= history.totalTasks} onClick={() => changePage(history.taskPage + 1)}>下一页历史</button></div></div>}
    </section>}
  </>
}
