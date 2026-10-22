import { PlanningArrangements } from './PlanningReschedule'
import { PlanningCompletionOrigin } from './PlanningCompletionOrigin'
import type { PlanningGoal, PlanningPage } from '../shared/adventure-planning'

export function PlanningGoalDetail({ goal, history, pageSize, blocked, edit, addTask, focus, achieve, migrate, end, changePage }: {
  goal: PlanningGoal; history: PlanningPage['goalDetail']; pageSize: number; blocked: boolean;
  migrate: () => void; edit: () => void; addTask: () => void; focus: () => void; achieve: () => void; end: () => void; changePage: (page: number) => void
}) {
  return <div className="planning-detail">
    <span className="planning-destination">{goal.independent ? '独立目标' : goal.mainlineName}</span><h3>{goal.title}</h3>
    <p>{goal.status === 'achieved' ? '已达成 · 结果已冻结，不可撤销' : goal.status === 'ended' ? '已结束 · 只读' : '进行中'}</p>
    {goal.terminatedAt && <p className="adventure-hint">终态时间：{new Date(goal.terminatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
    <h4>完成标准</h4><ul>{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul>
    <p className="adventure-hint">创建时间：{new Date(goal.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
    {goal.achievement && <section aria-label="冻结达成结果"><p>达成日期：{goal.achievement.occurredOn}</p>
      <p>目标奖励 {goal.achievement.reward.amount} 点经验 · 计奖行动 {goal.achievement.reward.calculation.count} 次 · 系数 {goal.achievement.reward.calculation.coefficient}</p>
      {goal.achievement.reward.calculation.fallback && <p>无有效计奖行动，使用 1 点保底奖励。</p>}
      <p>达成感想：{goal.achievement.reflection || '未填写'}</p></section>}
    <p><a href={`/adventure?goalId=${goal.id}`}>目标永久链接</a></p>
    <div className="adventure-inline">
      <button disabled={blocked || !goal.capabilities.edit?.allowed} onClick={edit}>编辑目标</button>
      <button disabled={blocked || !goal.capabilities.createTask?.allowed} title={goal.capabilities.createTask?.reason} onClick={addTask}>添加任务</button>
      <button disabled={blocked || !goal.capabilities.focus?.allowed} title={goal.capabilities.focus?.reason} onClick={focus}>{goal.focused ? '取消聚焦' : '聚焦'}</button>
      <button disabled={blocked || !goal.capabilities.achieve?.allowed} title={goal.capabilities.achieve?.reason} onClick={achieve}>确认达成</button>
      <button disabled={blocked || !goal.capabilities.migrate?.allowed} title={goal.capabilities.migrate?.reason} onClick={migrate}>迁移</button>
      <button disabled={blocked || !goal.capabilities.end?.allowed} title={goal.capabilities.end?.reason} onClick={end}>结束目标</button>
    </div>
    {history && <section aria-label="目标任务历史"><h4>任务历史</h4>
      {history.tasks.length ? <ul>{history.tasks.map(task => <li key={task.id}>{task.title} · {task.plannedOn} · {task.status === 'completed' ? '已完成' : task.status === 'ended' ? '已结束' : '待完成'}{task.reward ? ` · 冻结奖励 ${task.reward.amount} 点经验` : ''}{task.completionOrigin && <> · <PlanningCompletionOrigin origin={task.completionOrigin} /></>}{task.goalId !== goal.id ? ` · 当前已迁出至 ${task.goalTitle ?? '独立任务'}` : ''}<PlanningArrangements task={task} /></li>)}</ul> : <p>暂无任务历史。</p>}
      <div className="planning-pagination"><small>共 {history.totalTasks} 项 · 第 {history.taskPage} 页</small><div>
        <button disabled={blocked || history.taskPage <= 1} onClick={() => changePage(history.taskPage - 1)}>上一页历史</button>
        <button disabled={blocked || history.taskPage * pageSize >= history.totalTasks} onClick={() => changePage(history.taskPage + 1)}>下一页历史</button>
      </div></div></section>}
  </div>
}
