import { levelForXP, queryTasks } from '../shared/adventure'
import type { AdventureState } from '../shared/adventure/model'
import type { OpenDialog } from './types'
import { BadgeRibbon } from './Growth'
import { goalWritable } from './ui'
import explorer from './pixel-explorer.png'
export function Dashboard({
  state,
  today,
  open,
  growth,
}: {
  state: AdventureState
  today: string
  open: OpenDialog
  growth: () => void
}) {
  const total = state.ledger.reduce((sum, entry) => sum + entry.amount, 0),
    level = levelForXP(total)
  const tasks = queryTasks(state, today, today).filter(
    (task) => !task.stopped && !task.rescheduledTo,
  )
  const completed = tasks.filter((task) => task.completedOn).length,
    percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0
  const actions = state.ledger.filter(
      (entry) => entry.kind === 'action',
    ).length,
    goals = state.ledger.filter((entry) => entry.kind === 'goal').length
  const pendingActions = state.tasks.filter(
    (task) => task.completedOn && !task.settled,
  ).length
  const pendingGoals = state.goals
    .filter((goal) => goal.completion && !goal.completion.settled)
    .reduce(
      (sum, goal) =>
        sum + goal.completion!.actionIds.length * goal.completion!.coefficient,
      0,
    )
  return (
    <section className="adventure-personal">
      <div className="adventure-dashboard-upper">
        <section className="adventure-player">
          <div className="adventure-avatar"><img src={explorer} alt="背着行囊的像素冒险者" /></div>
          <div>
            <span className="adventure-kicker">PLAYER / 我的角色</span>
            <h2>
              今天也在冒险{' '}
              <span className="adventure-level">Lv.{level.level}</span>
            </h2>
            <p>方向由你定义，步伐由你决定。</p>
            <div className="adventure-exp-label">
              <span>EXP</span>
              <span>
                {level.progress} / {level.needed}
              </span>
            </div>
            <progress
              aria-label="当前等级经验进度"
              max={level.needed}
              value={level.progress}
            />
            <small>
              总经验 {total} · 距下一级 {level.needed - level.progress} XP
            </small>
          </div>
        </section>
        <section className="adventure-summary" aria-label="总体统计">
          <header>
            <div>
              <span className="adventure-kicker">DASHBOARD</span>
              <h2>每一步，都看得见。</h2>
            </div>
            <button className="adventure-text-button" onClick={growth}>
              成长记录 ↗
            </button>
          </header>
          <dl>
            <div>
              <dt>今日完成</dt>
              <dd>
                {completed}
                <small> / {tasks.length}</small>
              </dd>
              <small>{percent}%</small>
            </div>
            <div>
              <dt>累计行动</dt>
              <dd>
                {actions}
                <small> 次</small>
              </dd>
            </div>
            <div>
              <dt>目标达成</dt>
              <dd>
                {goals}
                <small> 个</small>
              </dd>
            </div>
            <div>
              <dt>当前焦点</dt>
              <dd>
                {
                  state.goals.filter(
                    (goal) => goal.focused && goalWritable(state, goal),
                  ).length
                }
                <small> 个</small>
              </dd>
            </div>
          </dl>
          <footer>
            <span>行动与目标待结算 +{pendingActions + pendingGoals} XP</span>
            <small>到期任务月另外统一结算</small>
          </footer>
        </section>
      </div>
      <BadgeRibbon state={state} open={open} />
    </section>
  )
}
