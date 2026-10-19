import {
  Compass,
  Flag,
  Flame,
  Trophy,
  Target,
  Mountain,
  CheckCheck,
  Clock,
  BookOpen,
  Sparkles,
} from 'lucide-react'
import type {
  AdventureState,
  LedgerEntry,
  Achievement,
} from '../shared/adventure/model'
import type { OpenDialog } from './types'
import { Empty } from './ui'

const badges = [
  { kind: 'action', threshold: 1, name: '迈出第一步', icon: Compass },
  { kind: 'action', threshold: 10, name: '行动起步', icon: Flag },
  { kind: 'action', threshold: 50, name: '持续行动', icon: Flame },
  { kind: 'action', threshold: 100, name: '百次行动', icon: Trophy },
  { kind: 'goal', threshold: 1, name: '第一个成果', icon: Target },
  { kind: 'goal', threshold: 3, name: '目标前行', icon: Mountain },
  { kind: 'goal', threshold: 10, name: '十个成果', icon: CheckCheck },
  { kind: 'longterm', threshold: 3, name: '三月坚持', icon: Clock },
  { kind: 'longterm', threshold: 6, name: '半年积累', icon: BookOpen },
  { kind: 'longterm', threshold: 12, name: '一年长期主义', icon: Sparkles },
] as const
const kindLabel = (kind: LedgerEntry['kind']) =>
  kind === 'action' ? '单次行动' : kind === 'goal' ? '目标达成' : '任务月奖励'
export function BadgeRibbon({
  state,
  open,
}: {
  state: AdventureState
  open: OpenDialog
}) {
  const unlocked = badges.filter((badge) =>
    state.achievements.some(
      (achievement) =>
        achievement.kind === badge.kind &&
        achievement.threshold === badge.threshold,
    ),
  ).length
  return (
    <section className="adventure-badge-ribbon" aria-label="成就横排">
      <span>
        <Trophy size={17} />
        成长收藏 <small>{unlocked}/10 类</small>
      </span>
      <div>
        {badges.map(({ name, kind, threshold, icon: Icon }) => {
          const active = state.achievements.some(
            (achievement) =>
              achievement.kind === kind && achievement.threshold === threshold,
          )
          return (
            <button
              key={name}
              className={active ? 'unlocked' : ''}
              aria-label={`${name} · ${active ? '已解锁' : '未解锁'}`}
              title={name}
              onClick={() =>
                open({ kind: 'achievements', id: `${kind}:${threshold}` })
              }
            >
              <Icon size={23} />
            </button>
          )
        })}
      </div>
      <button
        className="adventure-text-button"
        onClick={() => open({ kind: 'achievements' })}
      >
        全部成就 →
      </button>
    </section>
  )
}
export function Growth({
  state,
  open,
}: {
  state: AdventureState
  open: OpenDialog
}) {
  const actions = state.ledger.filter(
      (entry) => entry.kind === 'action',
    ).length,
    goals = state.ledger.filter((entry) => entry.kind === 'goal').length
  return (
    <section aria-label="成长记录">
      <div className="adventure-section-heading">
        <div>
          <h2>让投入，留下痕迹。</h2>
          <p>
            已结算 {actions} 次行动 · 达成 {goals} 个目标 ·{' '}
            {state.ledger.length} 笔成长记录
          </p>
        </div>
        <button onClick={() => open({ kind: 'achievements' })}>
          查看全部成就
        </button>
      </div>
      {!state.ledger.length && (
        <Empty>
          完成行动后先待结算。次日刷新统一更新经验、等级和成就，正式账户从 0 XP
          开始。
        </Empty>
      )}
      {state.ledger
        .slice()
        .reverse()
        .map((entry) => (
          <button
            key={entry.id}
            className="adventure-ledger-row"
            onClick={() => open({ kind: 'ledger', id: entry.id })}
          >
            <span>
              <small>
                {kindLabel(entry.kind)} · {entry.date}
              </small>
              <strong>
                {entry.snapshots[0]?.title ||
                  (entry.kind === 'goal' ? '目标达成奖励' : '任务月奖励')}
              </strong>
              <span>结算于 {entry.settledOn} · 查看来源与计算过程 →</span>
            </span>
            <b>+{entry.amount} XP</b>
          </button>
        ))}
    </section>
  )
}
export function LedgerDetail({
  entry,
  open,
}: {
  entry: LedgerEntry
  open: OpenDialog
}) {
  return (
    <div className="adventure-detail">
      <div className="adventure-reward">+{entry.amount} XP</div>
      <p>
        {kindLabel(entry.kind)} · 来源编号 {entry.sourceId}
      </p>
      <dl>
        <dt>完成 / 到期日期</dt>
        <dd>{entry.date}</dd>
        <dt>结算日期</dt>
        <dd>{entry.settledOn}</dd>
        <dt>计算过程</dt>
        <dd>{entry.calculation}</dd>
        {entry.coefficient !== undefined && (
          <>
            <dt>目标成就系数</dt>
            <dd>{entry.coefficient}</dd>
          </>
        )}
        {entry.reflection && (
          <>
            <dt>感想</dt>
            <dd>{entry.reflection}</dd>
          </>
        )}
      </dl>
      {entry.month && (
        <div className="adventure-preview">
          <h3>任务月明细</h3>
          <p>
            {entry.month.start} → {entry.month.end} · 第 {entry.month.index + 1}{' '}
            个任务月
          </p>
          <p>
            计划 {entry.month.planned} 次 · 实际 {entry.month.actual} 次 ·
            完成率{' '}
            {entry.month.rate === null
              ? '不适用'
              : `${Math.round(entry.month.rate * 100)}%`}
          </p>
          <p>
            达标月 {entry.month.qualifiedBefore} → {entry.month.qualifiedAfter}{' '}
            · 适用系数 ×{entry.month.multiplier}
          </p>
        </div>
      )}
      <h3>结算时任务快照</h3>
      {!entry.snapshots.length && (
        <p className="adventure-hint">
          此笔记录没有任务快照；没有补造初始历史。
        </p>
      )}
      {entry.snapshots.map((snapshot, index) => (
        <article
          className="adventure-snapshot"
          key={`${snapshot.taskId}:${index}`}
        >
          <strong>{snapshot.title}</strong>
          <p>
            {snapshot.containerName}{' '}
            {snapshot.containerKind === 'main' ? '主线' : '支线'} ·{' '}
            {snapshot.goalTitle} 目标
          </p>
          <p>完成标准：{snapshot.standard}</p>
          <p>
            {snapshot.date}
            {snapshot.slotDate ? ` · 原计划槽位 ${snapshot.slotDate}` : ''}
            {snapshot.extra ? ' · 额外完成' : ''}
          </p>
          <small>
            行动编号 {snapshot.actionId} · 任务编号 {snapshot.taskId}
          </small>
          {snapshot.sourceTaskId && <p>原安排编号 {snapshot.sourceTaskId}</p>}
        </article>
      ))}
      <p className="adventure-hint">
        快照保留结算时的名称和归属，后续编辑不会改写历史。
      </p>
      <button onClick={() => open({ kind: 'achievements' })}>
        查看关联成就
      </button>
    </div>
  )
}
export function AchievementDetails({
  state,
  open,
  selected,
}: {
  state: AdventureState
  open: OpenDialog
  selected?: string
}) {
  const entries = selected
    ? badges.filter((badge) => `${badge.kind}:${badge.threshold}` === selected)
    : badges
  const progress = (kind: string) =>
    kind === 'action'
      ? state.ledger.filter((entry) => entry.kind === 'action').length
      : kind === 'goal'
        ? state.ledger.filter((entry) => entry.kind === 'goal').length
        : Math.max(0, ...state.cycles.map((cycle) => cycle.qualifiedMonths))
  return (
    <div className="adventure-achievement-list">
      <p className="adventure-hint">
        次日结算后自动解锁，不额外加分。同类长期徽章合并展示，每个周期任务独立判断。
      </p>
      {entries.map(({ name, kind, threshold, icon: Icon }) => {
        const unlocked = state.achievements.filter(
          (achievement) =>
            achievement.kind === kind && achievement.threshold === threshold,
        )
        return (
          <article
            key={name}
            className={`adventure-achievement ${unlocked.length ? 'unlocked' : ''}`}
          >
            <Icon size={30} />
            <div>
              <h3>
                {name} · {unlocked.length ? '已解锁' : '尚未解锁'}
              </h3>
              <p>
                {kind === 'action'
                  ? `累计结算 ${threshold} 次真实行动`
                  : kind === 'goal'
                    ? `累计结算 ${threshold} 个达成目标`
                    : `同一个周期任务累计 ${threshold} 个达标月`}
              </p>
              <progress
                max={threshold}
                value={Math.min(progress(kind), threshold)}
              />
              <small>
                进度 {Math.min(progress(kind), threshold)}/{threshold}
              </small>
              {kind === 'longterm' && (
                <div aria-label="各周期达标进度">
                  {state.cycles.map((cycle) => (
                    <p key={cycle.id}>
                      {cycle.title}：
                      {Math.min(cycle.qualifiedMonths, threshold)}/{threshold}{' '}
                      个达标月
                      {cycle.qualifiedMonths >= threshold
                        ? ' · 已达到条件'
                        : ''}
                    </p>
                  ))}
                </div>
              )}
              {unlocked.map((achievement) => (
                <AchievementRecord
                  key={achievement.id}
                  {...{ achievement, state, open }}
                />
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}
function AchievementRecord({
  achievement,
  state,
  open,
}: {
  achievement: Achievement
  state: AdventureState
  open: OpenDialog
}) {
  return (
    <div className="adventure-achievement-record">
      <p>
        {achievement.unlockedOn} 解锁
        {achievement.cycleId &&
          ` · ${state.cycles.find((cycle) => cycle.id === achievement.cycleId)?.title || '原周期任务'}`}
      </p>
      {achievement.recordIds.length ? (
        achievement.recordIds.map((id) => {
          const entry = state.ledger.find((entry) => entry.id === id)
          return entry ? (
            <button key={id} onClick={() => open({ kind: 'ledger', id })}>
              {kindLabel(entry.kind)} · {entry.date} · +{entry.amount} XP →
            </button>
          ) : (
            <p key={id}>关联初始历史缺失，无法查看原始快照。</p>
          )
        })
      ) : (
        <p>没有可追溯的初始关联记录，未补造历史。</p>
      )}
    </div>
  )
}
