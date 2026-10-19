import { useState } from 'react'
import {
  Flag,
  Compass,
  ArrowUp,
  ArrowDown,
  GripVertical,
  ArrowUpRight,
} from 'lucide-react'
import type { AdventureState, Goal, Container } from '../shared/adventure/model'
import { commandCapability } from '../shared/adventure'
import type { AdventureAction } from './useAdventure'
import type { OpenDialog } from './types'
import { Empty, More, goalWritable } from './ui'

type Props = {
  state: AdventureState
  today: string
  action: AdventureAction
  open: OpenDialog
  busy: boolean
}
export function Planning({ state, today, action, open, busy }: Props) {
  const [group, setGroup] = useState<'main' | 'side' | 'history'>('main')
  const inactive = (owner: Container) =>
    owner.archived ||
    !!owner.convertedTo ||
    (owner.kind === 'side' &&
      state.goals.some(
        (goal) => goal.containerId === owner.id && !!goal.completion,
      ))
  const mains = state.containers.filter((owner) => owner.kind === 'main'),
    sides = state.containers.filter(
      (owner) => owner.kind === 'side' && !inactive(owner),
    ),
    history = state.containers.filter(inactive)
  const owners =
    group === 'history'
      ? history
      : group === 'main'
        ? mains.filter((owner) => !owner.archived)
        : sides
  return (
    <section aria-label="主线与支线管理">
      <div className="adventure-section-heading">
        <div>
          <h2>让每条主线，都有自己的目标。</h2>
          <p>
            主线最多 5 条，每条分别聚焦最多 3 个目标；在用支线最多 10 条，每条仅
            1 个目标。
          </p>
        </div>
      </div>
      <div className="adventure-filter" role="group" aria-label="方向列表">
        {(
          [
            ['main', `主线 ${mains.length}/5`],
            ['side', `在用支线 ${sides.length}/10`],
            ['history', `归档与来源 ${history.length}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={group === value}
            onClick={() => setGroup(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {!owners.length && (
        <Empty>
          {group === 'history'
            ? '归档或转换后的来源会保留在这里。'
            : '还没有方向，从右上角“新建”创建一条主线或支线。'}
        </Empty>
      )}
      {owners.map((owner) => (
        <ContainerCard
          key={owner.id}
          {...{ state, today, action, open, busy, owner }}
        />
      ))}
    </section>
  )
}
function ContainerCard({
  owner,
  state,
  today,
  action,
  open,
  busy,
}: Props & { owner: Container }) {
  const [dragged, setDragged] = useState<string>()
  const goals = state.goals
    .filter((goal) => goal.containerId === owner.id)
    .sort((a, b) => a.order - b.order)
  const locked = owner.archived || !!owner.convertedTo
  const reorder = (source: string, target: string) => {
    if (source === target || busy || locked) return
    const ids = goals.map((goal) => goal.id),
      from = ids.indexOf(source),
      to = ids.indexOf(target)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, source)
    void action({ type: 'reorderGoals', containerId: owner.id, goalIds: ids })
  }
  return (
    <article className="adventure-container">
      <header>
        <div className="adventure-owner-title">
          {owner.kind === 'main' ? <Flag size={19} /> : <Compass size={19} />}
          <h3>
            {owner.name} {owner.kind === 'main' ? '主线' : '支线'}
          </h3>
          <span>{goals.length} 个目标</span>
        </div>
        <div className="adventure-inline">
          <small>
            {owner.convertedTo
              ? '已转换 · 来源只读'
              : owner.archived
                ? '已归档 · 只读'
                : owner.kind === 'main'
                  ? `聚焦 ${goals.filter((goal) => goal.focused && !goal.archived && !goal.completion).length}/3`
                  : '独立探索'}
          </small>
          {!locked && (
            <More name={owner.name}>
              <button
                disabled={busy}
                onClick={() => open({ kind: 'editContainer', id: owner.id })}
              >
                编辑名称
              </button>
              {owner.kind === 'side' && (
                <button
                  disabled={busy}
                  onClick={() => open({ kind: 'migrate', id: owner.id })}
                >
                  升级或迁移
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  open({ kind: 'archive', entity: 'container', id: owner.id })
                }
              >
                归档{owner.kind === 'main' ? '主线' : '支线'}
              </button>
            </More>
          )}
        </div>
      </header>
      {owner.convertedTo && (
        <p className="adventure-hint">
          转换后的目标位于{' '}
          {state.containers.find((item) => item.id === owner.convertedTo)
            ?.name || '新归属'}{' '}
          主线。原来源不恢复为支线，不重复发奖。
        </p>
      )}
      {owner.convertedTo && owner.sourceGoalId && (
        <button
          className="adventure-text-button"
          onClick={() => open({ kind: 'goalDetail', id: owner.sourceGoalId! })}
        >
          查看转换后的目标与记录 →
        </button>
      )}
      {!goals.length && (
        <Empty>
          {owner.convertedTo
            ? '目标及成长已保留到新归属。'
            : '还没有目标，使用右上角“新建 → 目标”选择这个方向。'}
        </Empty>
      )}
      <ol className="adventure-goals">
        {goals.map((goal, index) => (
          <li
            key={goal.id}
            draggable={owner.kind === 'main' && !locked && !busy}
            onDragStart={(event) => {
              setDragged(goal.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', goal.id)
            }}
            onDragOver={(event) => {
              if (dragged && owner.kind === 'main' && !locked)
                event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (dragged) reorder(dragged, goal.id)
              setDragged(undefined)
            }}
          >
            <div className="adventure-goal-line">
              {owner.kind === 'main' && !locked && (
                <div className="adventure-reorder">
                  <GripVertical size={15} aria-hidden="true" />
                  <button
                    disabled={busy || index === 0}
                    aria-label={`上移目标 ${goal.title}`}
                    onClick={() => reorder(goal.id, goals[index - 1].id)}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    disabled={busy || index === goals.length - 1}
                    aria-label={`下移目标 ${goal.title}`}
                    onClick={() => reorder(goal.id, goals[index + 1].id)}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              )}
              <div className="adventure-goal-copy">
                <button
                  className="adventure-title-link"
                  onClick={() => open({ kind: 'goalDetail', id: goal.id })}
                >
                  {goal.title}
                  <ArrowUpRight size={15} />
                </button>
                <p>{goal.standard}</p>
                <small>
                  {goal.archived
                    ? '已归档 · 只读'
                    : goal.completion
                      ? `${goal.completion.date} 已达成 · ${goal.completion.settled ? '已结算' : '待次日结算'}`
                      : goal.focused
                        ? '聚焦中'
                        : '计划中'}
                </small>
              </div>
              <div className="adventure-goal-actions">
                {goalWritable(state, goal) && (
                  <button
                    disabled={busy}
                    aria-pressed={goal.focused}
                    onClick={() => {
                      void action({
                        type: 'focusGoal',
                        id: goal.id,
                        focused: !goal.focused,
                      })
                    }}
                  >
                    {goal.focused ? '取消聚焦' : '聚焦'}
                  </button>
                )}
                {(goalWritable(state, goal) ||
                  commandCapability(
                    state,
                    { type: 'archive', kind: 'goal', id: goal.id },
                    today,
                  ).allowed) && (
                  <More name={goal.title}>
                    {goalWritable(state, goal) && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            open({ kind: 'editGoal', id: goal.id })
                          }
                        >
                          编辑目标
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            open({ kind: 'completeGoal', id: goal.id })
                          }
                        >
                          确认目标达成
                        </button>
                      </>
                    )}
                    {commandCapability(
                      state,
                      { type: 'archive', kind: 'goal', id: goal.id },
                      today,
                    ).allowed && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          open({ kind: 'archive', entity: 'goal', id: goal.id })
                        }
                      >
                        归档目标
                      </button>
                    )}
                  </More>
                )}
                {commandCapability(
                  state,
                  { type: 'undoGoal', id: goal.id },
                  today,
                ).allowed && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      void action({ type: 'undoGoal', id: goal.id })
                    }}
                  >
                    撤销达成
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </article>
  )
}
export function FocusGoals({
  state,
  open,
}: {
  state: AdventureState
  open: OpenDialog
}) {
  const goals = state.goals.filter(
    (goal) => goal.focused && goalWritable(state, goal),
  )
  return (
    <section className="adventure-focus">
      <h2>
        当前焦点 <small>{goals.length} 个</small>
      </h2>
      <p className="adventure-hint">每条主线分别最多 3 个；排序表达优先级。</p>
      {!goals.length && <Empty>在“主线与支线”中聚焦近期要推进的目标。</Empty>}
      {goals.map((goal) => (
        <button
          className="adventure-focus-card"
          key={goal.id}
          onClick={() => open({ kind: 'goalDetail', id: goal.id })}
        >
          <span>
            {
              state.containers.find((owner) => owner.id === goal.containerId)
                ?.name
            }{' '}
            ·{' '}
            {state.containers.find((owner) => owner.id === goal.containerId)
              ?.kind === 'main'
              ? '主线'
              : '支线'}
          </span>
          <strong>
            {goal.title}
            <ArrowUpRight size={16} />
          </strong>
          <p>{goal.standard}</p>
          <small>
            {
              state.tasks.filter(
                (task) =>
                  task.goalId === goal.id && task.settled && task.completedOn,
              ).length
            }{' '}
            次已结算行动
          </small>
        </button>
      ))}
    </section>
  )
}
