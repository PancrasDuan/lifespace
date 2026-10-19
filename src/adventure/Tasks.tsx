import { useState } from 'react'
import { Repeat, CheckCheck, CalendarDays } from 'lucide-react'
import type { AdventureState, Task, Cycle } from '../shared/adventure/model'
import {
  queryTasks,
  cycleMonth,
  taskCapabilities,
  commandCapability,
} from '../shared/adventure'
import { MonthMultiplierDetails, displayMultiplier } from './MonthMultipliers'
import type { AdventureAction } from './useAdventure'
import type { OpenDialog } from './types'
import {
  addDays,
  Empty,
  More,
  goalLabel,
  taskWritable,
  CommandCheckbox,
} from './ui'

type Props = {
  state: AdventureState
  today: string
  action: AdventureAction
  open: OpenDialog
  busy: boolean
  goalId?: string
}
export function Tasks({ state, today, action, open, busy, goalId }: Props) {
  const [view, setView] = useState<'today' | 'future' | 'past'>('today'),
    [scope, setScope] = useState<'focus' | 'all'>('all'),
    [anchor, setAnchor] = useState(today)
  const date =
    view === 'today'
      ? today
      : anchor === today
        ? addDays(today, view === 'future' ? 1 : -1)
        : anchor
  const tasks = queryTasks(
    state,
    date,
    view === 'future' ? addDays(date, 6) : date,
  )
    .filter(
      (task) =>
        (!goalId || task.goalId === goalId) &&
        (scope === 'all' ||
          state.goals.some(
            (goal) =>
              goal.id === task.goalId &&
              goal.focused &&
              !goal.archived &&
              !goal.completion,
          )),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    )
  return (
    <section
      className="adventure-tasks"
      aria-label={goalId ? '目标任务' : '行动安排'}
    >
      <header className="adventure-section-heading">
        <div>
          <span className="adventure-kicker">TAKE A SMALL STEP</span>
          <h2>
            {view === 'today'
              ? '今日行动'
              : view === 'future'
                ? '未来安排'
                : '过去记录'}{' '}
            <small>{tasks.length}</small>
          </h2>
        </div>
        <div
          className="adventure-filter"
          role="group"
          aria-label="任务日期范围"
        >
          {(
            [
              ['today', '今天'],
              ['future', '未来'],
              ['past', '过去'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={view === value}
              onClick={() => {
                setView(value)
                setAnchor(
                  value === 'today'
                    ? today
                    : addDays(today, value === 'future' ? 1 : -1),
                )
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="adventure-task-toolbar">
        {!goalId && (
          <label>
            任务范围
            <select
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as 'focus' | 'all')
              }
            >
              <option value="all">全部任务（含已达成目标的继续任务）</option>
              <option value="focus">仅当前焦点</option>
            </select>
          </label>
        )}
        {view !== 'today' && (
          <label>
            <CalendarDays size={14} />
            {view === 'future' ? '查看起始日后 7 天' : '查看日期'}
            <input
              aria-label="查看任务日期"
              type="date"
              min={view === 'future' ? addDays(today, 1) : undefined}
              max={view === 'past' ? addDays(today, -1) : undefined}
              value={date}
              onChange={(event) => {
                if (event.target.value) setAnchor(event.target.value)
              }}
            />
          </label>
        )}
      </div>
      {!tasks.length && (
        <Empty>这个范围没有安排。创建任务后可安排在今天或未来。</Empty>
      )}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          {...{ state, today, action, open, busy, task }}
        />
      ))}
    </section>
  )
}
export function TaskRow({
  state,
  today,
  action,
  open,
  busy,
  task,
}: Props & { task: Task }) {
  const goal = state.goals.find((goal) => goal.id === task.goalId)
  const capabilities = taskCapabilities(state, task, today)
  const completed = !!task.completedOn
  return (
    <article className={`adventure-task-row ${completed ? 'completed' : ''}`}>
      <div className="adventure-task-main">
        <CommandCheckbox
          label={`${completed ? '撤销' : '完成'}任务 ${task.title}`}
          checked={completed}
          disabled={
            busy || !(completed ? capabilities.undo : capabilities.complete)
          }
          execute={() =>
            action({
              type: completed ? 'undoTask' : 'completeTask',
              id: task.id,
            })
          }
        />
        <div>
          <button
            className="adventure-title-link"
            onClick={() => open({ kind: 'taskDetail', task })}
          >
            {task.title}
          </button>
          <p className="adventure-hint">
            {goal ? goalLabel(state, goal) : '原目标'} ·{' '}
            {task.cycleId ? (
              <>
                <Repeat size={12} />
                周期任务{task.extra ? ' · 额外完成' : ''}
              </>
            ) : (
              <>
                <CheckCheck size={12} />
                一次性任务
              </>
            )}{' '}
            · {task.date}
          </p>
          <small>
            {task.rescheduledTo
              ? '已重新安排 · 原记录保留'
              : task.stopped
                ? '已撤下 · 历史保留'
                : completed
                  ? task.settled
                    ? '已完成 · 已结算'
                    : '已完成 · 待次日结算'
                  : task.date < today
                    ? '未完成 · 过去记录冻结'
                    : task.date > today
                      ? '未来安排 · 当天可完成'
                      : '等待行动'}
            {task.sourceTaskId && ' · 来自重新安排'}
            {task.slotDate &&
              task.slotDate !== task.date &&
              ` · 原计划 ${task.slotDate}`}
          </small>
        </div>
        <span className="adventure-xp">
          {completed && task.settled ? '已计入' : '+1 XP'}
        </span>
        {(capabilities.edit || capabilities.reschedule) && (
          <More name={task.title}>
            {capabilities.edit && (
              <button
                disabled={busy}
                onClick={() => open({ kind: 'editTask', task })}
              >
                修改安排与清单
              </button>
            )}
            {capabilities.reschedule && (
              <button
                disabled={busy}
                onClick={() => open({ kind: 'reschedule', task })}
              >
                重新安排
              </button>
            )}
          </More>
        )}
      </div>
      {task.checklist.length > 0 && (
        <details className="adventure-checklist">
          <summary>
            检查清单 {task.checklist.filter((item) => item.done).length}/
            {task.checklist.length} · 不单独计奖
          </summary>
          {task.checklist.map((item, index) => (
            <label key={index}>
              <CommandCheckbox
                checked={item.done}
                label={`${task.title}清单：${item.text}`}
                disabled={busy || !capabilities.checklist}
                execute={() =>
                  action({
                    type: 'toggleChecklist',
                    id: task.id,
                    index,
                    done: !item.done,
                  })
                }
              />
              {item.text}
            </label>
          ))}
        </details>
      )}
    </article>
  )
}
export function Cycles({
  state,
  today,
  open,
  busy,
  goalId,
}: Omit<Props, 'action'>) {
  const cycles = state.cycles.filter(
    (cycle) => !goalId || cycle.goalId === goalId,
  )
  return (
    <section className="adventure-cycles" aria-label="周期管理">
      <h2>
        周期管理 <small>{cycles.length}</small>
      </h2>
      <p className="adventure-hint">
        任务月结算与单次行动分开；目标已达成后的继续任务也在这里。
      </p>
      {!cycles.length && (
        <Empty>还没有周期任务。新建任务时可选择周期类型。</Empty>
      )}
      {cycles.map((cycle) => {
        const goal = state.goals.find((goal) => goal.id === cycle.goalId),
          owner = state.containers.find(
            (owner) => owner.id === goal?.containerId,
          )
        const extra = commandCapability(
          state,
          { type: 'extraComplete', cycleId: cycle.id, confirmed: true },
          today,
        )
        const readOnly =
          goal?.archived ||
          owner?.archived ||
          owner?.convertedTo ||
          cycle.status === 'ended'
        let summary = '任务月数据正在准备'
        let longTermMultiplier: string | undefined
        try {
          const month = cycleMonth(state, cycle.id, cycle.monthsSettled, today)
          longTermMultiplier = month.multiplier
          summary = `${month.start} → ${month.end} · 计划 ${month.planned} 次 · 实际 ${month.actual} 次 · 完成率 ${month.rate === null ? '不适用' : `${Math.round(month.rate * 100)}%`}`
        } catch {
          /* 历史异常由详情提供重新读取入口。 */
        }
        return (
          <article className="adventure-cycle-row" key={cycle.id}>
            <div>
              <button
                className="adventure-title-link"
                onClick={() => open({ kind: 'cycleDetail', id: cycle.id })}
              >
                {cycle.title}
              </button>
              <p>
                {goal ? goalLabel(state, goal) : '原目标'} ·{' '}
                {cycle.status === 'running'
                  ? '运行中'
                  : cycle.status === 'paused'
                    ? '暂停中'
                    : '已结束'}
              </p>
              <small>{summary}</small>
              <p className="adventure-hint">
                累计达标 {cycle.qualifiedMonths} 个月 · 累计长期系数{' '}
                {displayMultiplier(longTermMultiplier)}
                （本月达标才使用）
              </p>
            </div>
            {!readOnly && (
              <More name={cycle.title}>
                {cycle.status === 'running' && (
                  <button
                    disabled={busy || !extra.allowed}
                    title={extra.reason}
                    onClick={() =>
                      open({
                        kind: 'cycleAction',
                        id: cycle.id,
                        operation: 'extraComplete',
                      })
                    }
                  >
                    记录额外完成
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    open({
                      kind: 'cycleAction',
                      id: cycle.id,
                      operation:
                        cycle.status === 'running'
                          ? 'pauseCycle'
                          : 'resumeCycle',
                    })
                  }
                >
                  {cycle.status === 'running' ? '暂停周期任务' : '恢复周期任务'}
                </button>
                <button
                  disabled={busy}
                  onClick={() => open({ kind: 'cycleRule', id: cycle.id })}
                >
                  修改重复规则
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    open({
                      kind: 'cycleAction',
                      id: cycle.id,
                      operation: 'endCycle',
                    })
                  }
                >
                  结束周期任务
                </button>
              </More>
            )}
          </article>
        )
      })}
    </section>
  )
}
export function CycleDetail({
  cycle,
  state,
  today,
}: {
  cycle: Cycle
  state: AdventureState
  today: string
}) {
  let month
  try {
    month = cycleMonth(state, cycle.id, cycle.monthsSettled, today)
  } catch {
    /* 没有可计算窗口时仍展示完整来源。 */
  }
  return (
    <div className="adventure-detail">
      <p>
        开始日期：{cycle.startDate} · 状态：
        {cycle.status === 'running'
          ? '运行中'
          : cycle.status === 'paused'
            ? '暂停中'
            : '已结束'}
      </p>
      <p>
        已结算 {cycle.monthsSettled} 个完整任务月 · 累计达标{' '}
        {cycle.qualifiedMonths} 个月
      </p>
      {month && (
        <div className="adventure-preview">
          <h3>当前任务月</h3>
          <p>
            {month.start}（含）→ {month.end}（不含）
          </p>
          <p>
            计划 {month.planned} 次 · 实际完成 {month.actual} 次 · 完成率{' '}
            {month.rate === null
              ? '无计划，不参与结算'
              : `${Math.round(month.rate * 100)}%`}
          </p>
          <MonthMultiplierDetails month={month} />
          <p>达标门槛 80% · 奖励预估 {month.reward} XP</p>
          <small>
            未满月不发周期奖励；到期后的次日统一结算。实际超额仍获得单次经验，完成率封顶
            100%。
          </small>
        </div>
      )}
      <h3>规则版本</h3>
      {cycle.rules.map((rule, index) => (
        <p key={index}>
          {rule.effectiveFrom} 起：
          {rule.cadence === 'daily'
            ? '每天'
            : `每周 ${rule.weekdays.map((day) => ['一', '二', '三', '四', '五', '六', '日'][day - 1]).join('、')}`}
          {rule.endDate ? `，至 ${rule.endDate}（含）` : '，无结束日期'}
        </p>
      ))}
      <h3>暂停区间</h3>
      {cycle.pauses.length ? (
        cycle.pauses.map((pause, index) => (
          <p key={index}>
            {pause.start} → {pause.end || '尚未恢复'} · 按暂停天数顺延任务月
          </p>
        ))
      ) : (
        <p>没有暂停记录</p>
      )}
      <h3>已结算任务月</h3>
      {state.ledger
        .filter(
          (entry) => entry.kind === 'cycle' && entry.sourceId === cycle.id,
        )
        .map((entry) => (
          <p key={entry.id}>
            {entry.month?.start} → {entry.month?.end}：+{entry.amount} XP ·{' '}
            {entry.calculation}
          </p>
        ))}
      <p className="adventure-hint">
        完整月统一基数 10 XP；每累计 3 个达标月，下一任务月起长期系数复利增加
        10%。未达标月不乘长期系数，已有积累保留。
      </p>
    </div>
  )
}
