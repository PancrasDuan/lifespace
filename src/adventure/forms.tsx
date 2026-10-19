import { useMemo, useState, type FormEvent } from 'react'
import type {
  AdventureState,
  Container,
  Goal,
  Task,
  Cycle,
} from '../shared/adventure/model'
import { queryTasks, forecastCycleChange } from '../shared/adventure'
import {
  cumulativeMultiplier,
  appliedMultiplier,
  displayMultiplier,
} from './MonthMultipliers'
import type { AdventureAction } from './useAdventure'
import { addDays, OwnerSelect, GoalSelect } from './ui'

type Base = {
  state: AdventureState
  today: string
  action: AdventureAction
  close: () => void
  busy: boolean
}
const lines = (value: string) =>
  value
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
export function ContainerForm({
  entity,
  action,
  close,
  busy,
}: Base & { entity?: Container }) {
  const [name, setName] = useState(entity?.name || '')
  const [kind, setKind] = useState<'main' | 'side'>('main')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (
      await action(
        entity
          ? { type: 'editContainer', id: entity.id, name }
          : { type: 'createContainer', name, kind },
      )
    )
      close()
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <fieldset disabled={busy}>
        {!entity && (
          <label>
            类型
            <select
              aria-label="类型"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as 'main' | 'side')
              }
            >
              <option value="main">主线 · 长期方向</option>
              <option value="side">支线 · 独立探索</option>
            </select>
          </label>
        )}
        <label>
          名称
          <input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：健康、职业、城市探索"
          />
        </label>
        <p className="adventure-hint">
          只创建容器，随后单独创建目标。主线最多 5 条，在用支线最多 10 条。
        </p>
        <FormFooter close={close} label={entity ? '保存修改' : '创建'} />
      </fieldset>
    </form>
  )
}
export function GoalForm({
  entity,
  state,
  action,
  close,
  busy,
}: Base & { entity?: Goal }) {
  const [owner, setOwner] = useState(''),
    [title, setTitle] = useState(entity?.title || ''),
    [standard, setStandard] = useState(entity?.standard || '')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void action(
          entity
            ? { type: 'editGoal', id: entity.id, title, standard }
            : { type: 'createGoal', containerId: owner, title, standard },
        ).then((saved) => {
          if (saved) close()
        })
      }}
    >
      <fieldset disabled={busy}>
        {!entity && (
          <OwnerSelect state={state} value={owner} change={setOwner} />
        )}
        <label>
          目标名称
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="希望得到什么结果？"
          />
        </label>
        <label>
          完成标准
          <textarea
            required
            maxLength={2000}
            value={standard}
            onChange={(event) => setStandard(event.target.value)}
            placeholder="什么实际结果代表目标已经达成？"
          />
        </label>
        <p className="adventure-hint">
          目标达成需要手动确认实际结果。编辑保留归属、任务、聚焦及成长积累。
        </p>
        <FormFooter close={close} label={entity ? '保存修改' : '创建目标'} />
      </fieldset>
    </form>
  )
}
function RuleFields({
  cadence,
  setCadence,
  weekdays,
  setWeekdays,
  endDate,
  setEndDate,
  min,
}: {
  cadence: 'daily' | 'weekly'
  setCadence: (value: 'daily' | 'weekly') => void
  weekdays: number[]
  setWeekdays: (value: number[]) => void
  endDate: string
  setEndDate: (value: string) => void
  min: string
}) {
  return (
    <>
      <label>
        重复频率
        <select
          value={cadence}
          onChange={(event) =>
            setCadence(event.target.value as 'daily' | 'weekly')
          }
        >
          <option value="daily">每天</option>
          <option value="weekly">每周指定星期</option>
        </select>
      </label>
      {cadence === 'weekly' && (
        <div className="adventure-weekdays" role="group" aria-label="执行星期">
          {['一', '二', '三', '四', '五', '六', '日'].map((label, index) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={weekdays.includes(index + 1)}
                onChange={(event) =>
                  setWeekdays(
                    event.target.checked
                      ? [...weekdays, index + 1].sort()
                      : weekdays.filter((value) => value !== index + 1),
                  )
                }
              />
              周{label}
            </label>
          ))}
        </div>
      )}
      <label>
        结束日期（可选，包含当天）
        <input
          type="date"
          min={min}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </label>
    </>
  )
}
export function TaskForm({
  state,
  today,
  action,
  close,
  busy,
  entity,
}: Base & { entity?: Task }) {
  const [goalId, setGoalId] = useState(''),
    [kind, setKind] = useState<'once' | 'cycle'>('once'),
    [title, setTitle] = useState(entity?.title || ''),
    [date, setDate] = useState(entity?.date || today),
    [checklist, setChecklist] = useState(
      entity?.checklist.map((item) => item.text).join('\n') || '',
    )
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily'),
    [weekdays, setWeekdays] = useState<number[]>([]),
    [endDate, setEndDate] = useState('')
  const dates = useMemo(() => {
    if (kind !== 'cycle' || !date || (endDate && endDate < date)) return []
    const cycle: Cycle = {
      id: 'preview',
      goalId,
      title,
      checklist: [],
      startDate: date,
      rules: [
        {
          effectiveFrom: date,
          cadence,
          weekdays,
          ...(endDate ? { endDate } : {}),
        },
      ],
      pauses: [],
      status: 'running',
      qualifiedMonths: 0,
      monthsSettled: 0,
    }
    try {
      return queryTasks(
        { ...state, cycles: [cycle], tasks: [] },
        date,
        addDays(date, 30),
      )
        .slice(0, 6)
        .map((task) => task.date)
    } catch {
      return []
    }
  }, [kind, date, cadence, weekdays, endDate, goalId, state, title])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const saved = await action(
      entity
        ? {
            type: 'editTask',
            id: entity.id,
            title,
            date,
            checklist: lines(checklist),
          }
        : kind === 'once'
          ? {
              type: 'createTask',
              goalId,
              title,
              date,
              checklist: lines(checklist),
            }
          : {
              type: 'createCycle',
              goalId,
              title,
              startDate: date,
              checklist: lines(checklist),
              cadence,
              weekdays,
              ...(endDate ? { endDate } : {}),
            },
    )
    if (saved) close()
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <fieldset disabled={busy}>
        {!entity && (
          <>
            <GoalSelect state={state} value={goalId} change={setGoalId} />
            <label>
              任务类型
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as 'once' | 'cycle')
                }
              >
                <option value="once">一次性任务</option>
                <option value="cycle">周期任务</option>
              </select>
            </label>
          </>
        )}
        <label>
          任务名称
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {kind === 'cycle' ? '开始日期' : '执行日期'}
          <input
            required
            type="date"
            min={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        {kind === 'cycle' && !entity && (
          <RuleFields
            cadence={cadence}
            setCadence={setCadence}
            weekdays={weekdays}
            setWeekdays={setWeekdays}
            endDate={endDate}
            setEndDate={setEndDate}
            min={date}
          />
        )}
        <label>
          检查清单（可选，一行一个步骤）
          <textarea
            maxLength={15000}
            value={checklist}
            onChange={(event) => setChecklist(event.target.value)}
          />
        </label>
        <p className="adventure-hint">
          按独立成果或完整活动拆任务；检查清单不单独计经验，同一行动只计奖一次。
        </p>
        {kind === 'cycle' && (
          <div className="adventure-preview">
            <strong>接下来 31 天的前几次安排</strong>
            <p>{dates.join('、') || '选择执行星期后展示安排'}</p>
            <small>完整排期由规则计算，预览长度不限制任务月统计。</small>
          </div>
        )}
        <FormFooter
          close={close}
          label={entity ? '保存安排' : '安排任务'}
          disabled={
            kind === 'cycle' && cadence === 'weekly' && !weekdays.length
          }
        />
      </fieldset>
    </form>
  )
}
export function CycleRuleForm({
  entity,
  state,
  today,
  action,
  close,
  busy,
}: Base & { entity: Cycle }) {
  const latest =
    entity.rules.filter((rule) => rule.effectiveFrom <= today).at(-1) ||
    entity.rules[0]
  const [effectiveFrom, setEffectiveFrom] = useState(
      today < entity.startDate ? entity.startDate : today,
    ),
    [cadence, setCadence] = useState(latest.cadence),
    [weekdays, setWeekdays] = useState(latest.weekdays),
    [endDate, setEndDate] = useState(latest.endDate || '')
  const preview = useMemo(() => {
    if (!effectiveFrom || (endDate && endDate < effectiveFrom)) return undefined
    try {
      return forecastCycleChange(
        state,
        {
          type: 'editCycle',
          id: entity.id,
          effectiveFrom,
          cadence,
          weekdays,
          ...(endDate ? { endDate } : {}),
        },
        today,
      )
    } catch {
      return undefined
    }
  }, [state, entity, today, effectiveFrom, cadence, weekdays, endDate])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void action({
          type: 'editCycle',
          id: entity.id,
          effectiveFrom,
          cadence,
          weekdays,
          ...(endDate ? { endDate } : {}),
        }).then((saved) => {
          if (saved) close()
        })
      }}
    >
      <fieldset disabled={busy}>
        <p>{entity.title}</p>
        <label>
          新规则生效日期
          <input
            type="date"
            required
            min={today < entity.startDate ? entity.startDate : today}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </label>
        <RuleFields
          cadence={cadence}
          setCadence={setCadence}
          weekdays={weekdays}
          setWeekdays={setWeekdays}
          endDate={endDate}
          setEndDate={setEndDate}
          min={effectiveFrom}
        />
        <div className="adventure-preview" aria-label="重复规则变更预览">
          <strong>生效后 31 天排期预览</strong>
          {preview ? (
            <>
              <p>
                原安排 {preview.before.tasks.length} 次 → 新安排{' '}
                {preview.after.tasks.length} 次
              </p>
              <p>
                原执行日期：
                {preview.before.tasks
                  .slice(0, 6)
                  .map((task) => task.date)
                  .join('、') || '无安排'}
              </p>
              <p>
                新执行日期：
                {preview.after.tasks
                  .slice(0, 6)
                  .map((task) => task.date)
                  .join('、') || '无安排'}
              </p>
              <h3>首个受影响任务月 · 第 {preview.before.month.index + 1} 月</h3>
              <p>
                原任务月：{preview.before.month.start} →{' '}
                {preview.before.month.end}
              </p>
              <p>
                新任务月：{preview.after.month.start} →{' '}
                {preview.after.month.end}
              </p>
              <table>
                <caption>任务月数值对照（仅预估）</caption>
                <thead>
                  <tr>
                    <th scope="col">指标</th>
                    <th scope="col">修改前</th>
                    <th scope="col">修改后</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">计划次数</th>
                    <td>{preview.before.month.planned}</td>
                    <td>{preview.after.month.planned}</td>
                  </tr>
                  <tr>
                    <th scope="row">实际完成</th>
                    <td>{preview.before.month.actual}</td>
                    <td>{preview.after.month.actual}</td>
                  </tr>
                  <tr>
                    <th scope="row">完成率</th>
                    <td>{formatRate(preview.before.month.rate)}</td>
                    <td>{formatRate(preview.after.month.rate)}</td>
                  </tr>
                  <tr>
                    <th scope="row">累计长期系数</th>
                    <td>
                      {displayMultiplier(
                        cumulativeMultiplier(preview.before.month),
                      )}
                    </td>
                    <td>
                      {displayMultiplier(
                        cumulativeMultiplier(preview.after.month),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">本期实际适用系数</th>
                    <td>
                      {displayMultiplier(
                        appliedMultiplier(preview.before.month),
                      )}
                    </td>
                    <td>
                      {displayMultiplier(
                        appliedMultiplier(preview.after.month),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">周期奖励预估</th>
                    <td>{preview.before.month.reward} XP</td>
                    <td>{preview.after.month.reward} XP</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p>请选择合法生效日期与重复规则后查看预览。</p>
          )}
          <small>
            预览复用服务端规则变更语义，并排除已撤下安排。过去记录、已结算奖励不变，任务月起点与长期积累保留；正式奖励由服务端次日统一计算。
          </small>
        </div>
        <FormFooter
          close={close}
          label="保存重复规则"
          disabled={cadence === 'weekly' && !weekdays.length}
        />
      </fieldset>
    </form>
  )
}
export function GoalCompletionForm({
  entity,
  state,
  action,
  close,
  busy,
}: Base & { entity: Goal }) {
  const cycles = state.cycles.filter(
    (cycle) => cycle.goalId === entity.id && cycle.status !== 'ended',
  )
  const [choices, setChoices] = useState<Record<string, 'continue' | 'end'>>(
      {},
    ),
    [coefficient, setCoefficient] = useState<'1' | '2' | '3'>('1'),
    [reflection, setReflection] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const count = new Set(
    state.tasks
      .filter((task) => task.goalId === entity.id && task.completedOn)
      .map((task) => task.actionId),
  ).size
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void action({
          type: 'completeGoal',
          id: entity.id,
          confirmed: true,
          coefficient: Number(coefficient) as 1 | 2 | 3,
          reflection,
          cycleChoices: choices,
        }).then((saved) => {
          if (saved) close()
        })
      }}
    >
      <fieldset disabled={busy}>
        <h3>{entity.title}</h3>
        <p className="adventure-standard">{entity.standard}</p>
        <label className="adventure-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我已按实际结果确认达到完成标准
        </label>
        <label>
          成就系数
          <select
            value={coefficient}
            onChange={(event) =>
              setCoefficient(event.target.value as '1' | '2' | '3')
            }
          >
            <option value="1">1 · 默认 / 跳过评价</option>
            <option value="2">2 · 很有成就感</option>
            <option value="3">3 · 非常有成就感</option>
          </select>
        </label>
        <label>
          感想（可选）
          <textarea
            maxLength={3000}
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
          />
        </label>
        {cycles.length > 0 && (
          <section>
            <h3>逐项决定周期任务去向</h3>
            {cycles.map((cycle) => (
              <label key={cycle.id}>
                {cycle.title}（{cycle.status === 'paused' ? '暂停中' : '运行中'}
                ）
                <select
                  required
                  value={choices[cycle.id] || ''}
                  onChange={(event) =>
                    setChoices({
                      ...choices,
                      [cycle.id]: event.target.value as 'continue' | 'end',
                    })
                  }
                >
                  <option value="" hidden disabled>
                    选择继续或结束
                  </option>
                  <option value="continue">
                    继续 · 保留原状态、任务月与长期积累
                  </option>
                  <option value="end">结束 · 保留历史，残月无周期奖励</option>
                </select>
              </label>
            ))}
          </section>
        )}
        <div className="adventure-preview">
          目标额外奖励：{count} 次真实行动 × {coefficient} ={' '}
          {count * Number(coefficient)} XP
          <p>
            确认后冻结奖励；继续的周期任务从全部任务或周期管理查看。经验、等级、成就次日更新，当天可撤销。
          </p>
        </div>
        <FormFooter
          close={close}
          label="确认目标达成"
          disabled={!confirmed || cycles.some((cycle) => !choices[cycle.id])}
        />
      </fieldset>
    </form>
  )
}
export function MigrateForm({
  entity,
  state,
  action,
  close,
  busy,
}: Base & { entity: Container }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new'),
    [name, setName] = useState(entity.name),
    [target, setTarget] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void action(
          mode === 'new'
            ? { type: 'migrateSide', id: entity.id, newMainName: name }
            : { type: 'migrateSide', id: entity.id, targetContainerId: target },
        ).then((saved) => {
          if (saved) close()
        })
      }}
    >
      <fieldset disabled={busy}>
        <label>
          转换方式
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as 'new' | 'existing')
            }
          >
            <option value="new">升级为新主线</option>
            <option value="existing">迁移目标到已有主线</option>
          </select>
        </label>
        {mode === 'new' ? (
          <label>
            新主线名称
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <label>
            目标主线
            <select
              required
              aria-label="目标主线"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="" hidden disabled>
                选择主线
              </option>
              {state.containers
                .filter((owner) => owner.kind === 'main' && !owner.archived)
                .map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name} 主线
                  </option>
                ))}
            </select>
          </label>
        )}
        <p className="adventure-hint">
          保留目标、任务、来源和成长，不重复发奖。名额充足时保留聚焦；目标主线已聚焦
          3
          个时请先调整，不替换其他目标。转换成功后，原来源只读且不能恢复为支线。
        </p>
        <FormFooter close={close} label="确认转换" />
      </fieldset>
    </form>
  )
}
export function RescheduleForm({
  entity,
  today,
  action,
  close,
  busy,
}: Base & { entity: Task }) {
  const [date, setDate] = useState(today)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void action({ type: 'rescheduleTask', id: entity.id, date }).then(
          (saved) => {
            if (saved) close()
          },
        )
      }}
    >
      <fieldset disabled={busy}>
        <p>{entity.title}</p>
        <label>
          新的执行日期
          <input
            required
            type="date"
            min={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <p className="adventure-hint">
          原记录保留并关联新安排，同一行动只计奖一次。周期单次改期保留原计划槽位，实际完成按执行日期归入任务月。
        </p>
        <FormFooter close={close} label="重新安排" />
      </fieldset>
    </form>
  )
}
export function FormFooter({
  close,
  label,
  disabled = false,
}: {
  close: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <footer className="adventure-form-footer">
      <button type="button" onClick={close}>
        取消
      </button>
      <button className="adventure-primary" disabled={disabled} type="submit">
        {label}
      </button>
    </footer>
  )
}

const formatRate = (rate: number | null) =>
  rate === null ? '不适用' : `${Math.round(rate * 100)}%`
