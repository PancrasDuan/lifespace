import { useCallback, useRef, useState } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useAdventure } from './useAdventure'
import { Dashboard } from './Dashboard'
import { Planning, FocusGoals } from './Planning'
import { Tasks, Cycles, CycleDetail } from './Tasks'
import { Growth, LedgerDetail, AchievementDetails } from './Growth'
import {
  ContainerForm,
  GoalForm,
  TaskForm,
  CycleRuleForm,
  GoalCompletionForm,
  MigrateForm,
  RescheduleForm,
} from './forms'
import { Modal, goalLabel } from './ui'
import type { DialogRequest } from './types'
import { ArchiveImpact } from './ArchiveImpact'
import './adventure.css'

export function Adventure() {
  const model = useAdventure()
  const { data, busy, error, uncertain, command } = model
  const [tab, setTab] = useState<'overview' | 'planning' | 'growth'>('overview')
  const [dialog, setDialog] = useState<DialogRequest>()
  const dialogStack = useRef<DialogRequest[]>([])
  const close = useCallback(() => setDialog(dialogStack.current.pop()), [])
  const open = (request: DialogRequest) => {
    if (
      dialog &&
      [
        'goalDetail',
        'taskDetail',
        'cycleDetail',
        'ledger',
        'achievements',
      ].includes(dialog.kind)
    )
      dialogStack.current.push(dialog)
    setDialog(request)
  }
  const base = data
    ? {
        state: data.state,
        today: data.today,
        action: command,
        close,
        busy: busy || uncertain,
      }
    : undefined
  const selectedId = dialog && 'id' in dialog ? dialog.id : undefined
  const goal = data?.state.goals.find((goal) => goal.id === selectedId)
  const owner = data?.state.containers.find((owner) => owner.id === selectedId)
  const cycle = data?.state.cycles.find((cycle) => cycle.id === selectedId)
  const entry = data?.state.ledger.find((entry) => entry.id === selectedId)
  const title = !dialog
    ? ''
    : {
        new: '新建',
        container: '创建主线或支线',
        goal: '创建目标',
        taskCreate: '为目标安排下一步',
        editContainer: '修改名称',
        editGoal: '编辑目标',
        completeGoal: '确认目标达成',
        migrate: '升级或迁移支线',
        goalDetail: goal?.title || '目标详情',
        cycleRule: '修改重复规则',
        cycleDetail: cycle?.title || '周期任务详情',
        ledger: '经验来源与计算过程',
        taskDetail: '任务详情',
        editTask: '修改任务安排',
        reschedule: '重新安排任务',
        archive: '确认归档',
        cycleAction:
          dialog.kind === 'cycleAction' && dialog.operation === 'extraComplete'
            ? '记录额外真实完成'
            : '调整周期任务状态',
        achievements: '成就详情',
      }[dialog.kind]
  return (
    <AppLayout page="adventure">
      <div className="adventure-page">
        <header className="adventure-heading">
          <div>
            <span className="adventure-kicker">YOUR LIFE, YOUR QUEST</span>
            <h1>把想做的事，慢慢变成现实。</h1>
            <p>有方向地行动，也看见每一次微小的成长。</p>
          </div>
          <div className="adventure-heading-actions">
            <button
              aria-label="刷新并结算"
              disabled={busy || uncertain || !data}
              onClick={() => {
                void command({ type: 'refresh' })
              }}
            >
              <RotateCw size={16} />
            </button>
            <button
              className="adventure-primary"
              disabled={!data || busy || uncertain}
              onClick={() => open({ kind: 'new' })}
            >
              <Plus size={17} />
              新建
            </button>
          </div>
        </header>
        {error && (
          <div className="adventure-error" role="alert">
            <p>{error}</p>
            <button
              disabled={busy}
              onClick={() => {
                void (uncertain ? model.retry() : model.load())
              }}
            >
              {uncertain ? '安全重试同一次操作' : '重新读取'}
            </button>
            {uncertain && (
              <small>此时暂不接受新操作，避免重复创建或发奖。</small>
            )}
          </div>
        )}
        {model.notice && (
          <div className="adventure-notice" role="status">
            {model.notice}
            <button aria-label="关闭结算提示" onClick={model.clearNotice}>
              ×
            </button>
          </div>
        )}
        {!data && !error && (
          <p className="adventure-empty" role="status">
            正在读取你的冒险…
          </p>
        )}
        {data && base && (
          <>
            <Dashboard
              state={data.state}
              today={data.today}
              open={open}
              growth={() => setTab('growth')}
            />
            <nav className="adventure-tabs" aria-label="冒险页面">
              <div>
                {(
                  [
                    ['overview', '冒险概览'],
                    ['planning', '主线与支线'],
                    ['growth', '成长记录'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    aria-current={tab === value ? 'page' : undefined}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>
                {data.today} · {data.state.timeZone}
              </small>
            </nav>
            {tab === 'overview' && (
              <>
                <div className="adventure-workspace">
                  <FocusGoals state={data.state} open={open} />
                  <Tasks {...base} open={open} />
                </div>
                <Cycles {...base} open={open} />
              </>
            )}
            {tab === 'planning' && <Planning {...base} open={open} />}
            {tab === 'growth' && <Growth state={data.state} open={open} />}
          </>
        )}
        {dialog && base && data && (
          <Modal title={title} close={close}>
            {error && (
              <p className="adventure-error" role="alert">
                {error}
                {uncertain && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      void model.retry()
                    }}
                  >
                    安全重试同一次操作
                  </button>
                )}
              </p>
            )}
            {dialog.kind === 'new' && (
              <div className="adventure-new-options">
                <button
                  aria-label="主线 / 支线"
                  onClick={() => open({ kind: 'container' })}
                >
                  <strong>主线 / 支线</strong>
                  <span>先创建一个方向容器</span>
                </button>
                <button
                  aria-label="目标"
                  onClick={() => open({ kind: 'goal' })}
                >
                  <strong>目标</strong>
                  <span>挂在某条主线或支线下，说明希望得到的结果</span>
                </button>
                <button
                  aria-label="任务"
                  onClick={() => open({ kind: 'taskCreate' })}
                >
                  <strong>任务</strong>
                  <span>挂在某个目标下，安排一次性或周期行动</span>
                </button>
              </div>
            )}
            {(dialog.kind === 'container' ||
              dialog.kind === 'editContainer') && (
              <ContainerForm
                {...base}
                entity={dialog.kind === 'editContainer' ? owner : undefined}
              />
            )}
            {(dialog.kind === 'goal' || dialog.kind === 'editGoal') && (
              <GoalForm
                {...base}
                entity={dialog.kind === 'editGoal' ? goal : undefined}
              />
            )}
            {dialog.kind === 'taskCreate' && <TaskForm {...base} />}
            {dialog.kind === 'editTask' && (
              <TaskForm {...base} entity={dialog.task} />
            )}
            {dialog.kind === 'reschedule' && (
              <RescheduleForm {...base} entity={dialog.task} />
            )}
            {dialog.kind === 'completeGoal' && goal && (
              <GoalCompletionForm {...base} entity={goal} />
            )}
            {dialog.kind === 'migrate' && owner && (
              <MigrateForm {...base} entity={owner} />
            )}
            {dialog.kind === 'cycleRule' && cycle && (
              <CycleRuleForm {...base} entity={cycle} />
            )}
            {dialog.kind === 'cycleDetail' && cycle && (
              <CycleDetail
                cycle={cycle}
                state={data.state}
                today={data.today}
              />
            )}
            {dialog.kind === 'ledger' && entry && (
              <LedgerDetail entry={entry} open={open} />
            )}
            {dialog.kind === 'achievements' && (
              <AchievementDetails
                state={data.state}
                open={open}
                selected={dialog.id}
              />
            )}
            {dialog.kind === 'goalDetail' && goal && (
              <div className="adventure-detail">
                <p>{goalLabel(data.state, goal)}</p>
                <h3>完成标准</h3>
                <p>{goal.standard}</p>
                {goal.archived && <p>已归档，只读保留任务与历史。</p>}
                {goal.completion && (
                  <div className="adventure-preview">
                    <p>
                      {goal.completion.date} 达成 ·{' '}
                      {goal.completion.settled ? '已结算' : '待次日结算'}
                    </p>
                    <p>
                      冻结目标奖励：{goal.completion.actionIds.length} 次行动 ×{' '}
                      {goal.completion.coefficient} ={' '}
                      {goal.completion.actionIds.length *
                        goal.completion.coefficient}{' '}
                      XP
                    </p>
                    {goal.completion.reflection && (
                      <p>{goal.completion.reflection}</p>
                    )}
                  </div>
                )}
                <Tasks {...base} goalId={goal.id} open={open} />
                <Cycles {...base} goalId={goal.id} open={open} />
              </div>
            )}
            {dialog.kind === 'taskDetail' && (
              <div className="adventure-detail">
                <h3>{dialog.task.title}</h3>
                <p>
                  执行日期 {dialog.task.date} ·{' '}
                  {dialog.task.completedOn
                    ? `完成于 ${dialog.task.completedOn}`
                    : '尚未完成'}{' '}
                  · {dialog.task.settled ? '已结算' : '尚未结算'}
                </p>
                <p>行动编号 {dialog.task.actionId}</p>
                {dialog.task.sourceTaskId && (
                  <p>
                    原安排编号 {dialog.task.sourceTaskId} ·
                    保留同一行动身份，不重复计奖。
                  </p>
                )}
                {dialog.task.rescheduledTo && (
                  <p>新安排编号 {dialog.task.rescheduledTo}</p>
                )}
                {dialog.task.slotDate && (
                  <p>
                    原计划槽位 {dialog.task.slotDate} ·
                    计划次数仍归原任务月，实际完成按执行日。
                  </p>
                )}
                <ul>
                  {dialog.task.checklist.map((item, index) => (
                    <li key={index}>
                      {item.done ? '✓' : '○'} {item.text}
                    </li>
                  ))}
                </ul>
                <p className="adventure-hint">
                  单次完整行动 +1
                  XP，检查清单不单独计奖。当天完成先待结算，次日统一更新。
                </p>
                {data.state.ledger
                  .filter((entry) =>
                    entry.snapshots.some(
                      (snapshot) => snapshot.actionId === dialog.task.actionId,
                    ),
                  )
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => open({ kind: 'ledger', id: entry.id })}
                    >
                      {entry.date} · +{entry.amount} XP · 查看计算 →
                    </button>
                  ))}
              </div>
            )}
            {dialog.kind === 'archive' && (
              <div className="adventure-detail">
                <p>
                  归档“
                  {dialog.entity === 'container' ? owner?.name : goal?.title}
                  ”后停止推进，任务和历史保留，归档只读。
                </p>
                <p>
                  已完成任务仍按次日规则结算，不重复发奖。归档主线仍占名额，支线释放在用名额。
                </p>
                <ArchiveImpact
                  state={data.state}
                  today={data.today}
                  kind={dialog.entity}
                  id={dialog.id}
                />
                <footer className="adventure-form-footer">
                  <button onClick={close}>取消</button>
                  <button
                    className="adventure-primary"
                    disabled={base.busy}
                    onClick={() => {
                      void command({
                        type: 'archive',
                        kind: dialog.entity,
                        id: dialog.id,
                      }).then((saved) => {
                        if (saved) close()
                      })
                    }}
                  >
                    确认归档
                  </button>
                </footer>
              </div>
            )}
            {dialog.kind === 'cycleAction' && cycle && (
              <div className="adventure-detail">
                <h3>{cycle.title}</h3>
                <p>
                  {dialog.operation === 'extraComplete'
                    ? '确认今天确实额外完成了一次完整活动。增加实际完成次数和单次经验，不增加计划次数。'
                    : dialog.operation === 'pauseCycle'
                      ? '暂停期间不安排任务，任务月按实际暂停天数顺延；保留已到期月和长期积累。'
                      : dialog.operation === 'resumeCycle'
                        ? '恢复后按原规则继续，保留任务月与长期积累，不补排暂停期间任务。'
                        : '结束后停止推进，历史保留，已到期完整月仍结算；未满月不发周期奖励。结束后只读，需要继续时新建周期。'}
                </p>
                <footer className="adventure-form-footer">
                  <button onClick={close}>取消</button>
                  <button
                    className="adventure-primary"
                    disabled={base.busy}
                    onClick={() => {
                      void command(
                        dialog.operation === 'extraComplete'
                          ? {
                              type: 'extraComplete',
                              cycleId: cycle.id,
                              confirmed: true,
                            }
                          : { type: dialog.operation, id: cycle.id },
                      ).then((saved) => {
                        if (saved) close()
                      })
                    }}
                  >
                    确认
                    {dialog.operation === 'extraComplete'
                      ? '额外完成'
                      : dialog.operation === 'pauseCycle'
                        ? '暂停'
                        : dialog.operation === 'resumeCycle'
                          ? '恢复'
                          : '结束'}
                  </button>
                </footer>
              </div>
            )}
          </Modal>
        )}
      </div>
    </AppLayout>
  )
}
