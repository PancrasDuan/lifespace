import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ListTodo, LockKeyhole, Repeat2 } from 'lucide-react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningPage } from '../shared/adventure-planning'
import type { RecurringParent } from '../shared/adventure-recurring'
import { planningApi } from './planning-api'
import { recurringDate, periodLabels } from './RecurringTasks'

type PeriodType = RecurringParent['periodType']
export function RecurringTaskForm({ parent, workspace, blocked, action, close }: {
  parent?: RecurringParent; workspace: PlanningPage; blocked: boolean;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>; close: () => void
}) {
  const identity = useVerifiedIdentity()
  const [kind, setKind] = useState<'once' | 'recurring'>('recurring')
  const [title, setTitle] = useState(parent?.title ?? '')
  const [description, setDescription] = useState(parent?.description ?? '')
  const [startOn, setStartOn] = useState(parent?.startOn ?? workspace.today)
  const [periodType, setPeriodType] = useState<PeriodType>(parent?.periodType ?? 'week')
  const [required, setRequired] = useState(String(parent?.requiredCount ?? 5))
  const [destination, setDestination] = useState(parent?.goalId ?? '')
  const [destinationLabel, setDestinationLabel] = useState(parent?.goalTitle ?? '')
  const [candidatePage, setCandidatePage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [candidates, setCandidates] = useState<PlanningPage>()
  const [candidateError, setCandidateError] = useState('')
  const [draftError, setDraftError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)])
    setCandidates(undefined); setCandidateError('')
    void planningApi.load(identity.ownerId, { page: candidatePage, taskRange: 'today', taskPage: 1, taskScope: 'all', search: '', goalTaskPage: 1, includeTerminal: false }, signal)
      .then(value => { if (!signal.aborted) setCandidates(value) })
      .catch(() => { if (!controller.signal.aborted && !identity.signal.aborted) setCandidateError('暂时无法读取任务归属，请重试。') })
    return () => controller.abort()
  }, [candidatePage, attempt, identity.ownerId, identity.signal])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const requiredCount = Number(required)
    if (!title.trim() || (kind === 'recurring' && (!Number.isSafeInteger(requiredCount) || requiredCount < 1))) { setDraftError('每期次数须为大于等于 1 的安全整数，任务名称不能为空。'); return }
    const common = { title, description }
    const command: PlanningCommand = parent ? { type: 'editRecurringTask', id: parent.id, ...common, requiredCount, today: workspace.today,
      ...(parent.capabilities.changeStartOn.allowed ? { startOn } : {}), ...(parent.capabilities.changeDestination.allowed ? { destination } : {}) }
      : kind === 'recurring' ? { type: 'createRecurringTask', ...common, periodType, startOn, requiredCount, destination, today: workspace.today }
      : { type: 'createTask', ...common, plannedOn: startOn, destination }
    if (await action(command, workspace.version) && mounted.current) close()
  }
  return <form onSubmit={event => { void submit(event) }}><fieldset disabled={blocked || (!!parent && !parent.capabilities.editRecurringTask.allowed)}>
    {parent ? <div className="recurring-fixed-kind"><Repeat2 size={16} aria-hidden="true"/>周期任务</div> : <div className="recurring-editor-type" role="group" aria-label="任务类型">{(['once', 'recurring'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'once' ? <ListTodo size={16} aria-hidden="true"/> : <Repeat2 size={16} aria-hidden="true"/>}{value === 'once' ? '一次性任务' : '周期任务'}</button>)}</div>}
    <label>任务名称<input autoFocus data-initial-focus="" required pattern=".*\S.*" maxLength={workspace.limits.name} autoComplete="off" value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：刷 LeetCode"/></label>
    <label>任务说明<textarea rows={2} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)}/></label>
    {kind === 'recurring' && <div className="recurring-form-pair">{parent ? <div className="recurring-fixed-field"><span>周期</span><div><span>{periodLabels[parent.periodType]}</span><LockKeyhole size={14} role="img" aria-label="周期不可修改"/></div></div>
      : <label>周期<select aria-label="周期" value={periodType} onChange={event => setPeriodType(event.target.value as PeriodType)}>{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <label>每期次数<input required type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={required} onChange={event => setRequired(event.target.value)}/></label></div>}
    {parent && !parent.capabilities.changeStartOn.allowed ? <div className="recurring-fixed-field"><span>开始日期</span><div><time dateTime={parent.startOn}>{recurringDate(parent.startOn)}</time><LockKeyhole size={14} role="img" aria-label="开始日期不可修改"/></div></div>
      : <label>{kind === 'recurring' ? '开始日期' : '计划日期'}<input type="date" required min={workspace.today} max="9999-12-31" value={startOn} onChange={event => setStartOn(event.target.value)}/></label>}
    <label>任务归属<select aria-label="任务归属" value={destination} disabled={blocked || (!!parent && !parent.capabilities.changeDestination.allowed)} onChange={event => { setDestination(event.target.value); setDestinationLabel(event.target.selectedOptions[0].text) }}>
      <option value="">独立任务</option>
      {destination && !candidates?.goals.some(goal => goal.id === destination) && <option value={destination}>{destinationLabel}</option>}
      {candidates?.goals.filter(goal => goal.status === 'active' && goal.capabilities.createTask?.allowed).map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
    </select></label>
    {!candidates && <p role="status">{candidateError || '正在读取任务归属…'}</p>}
    {candidateError && <button type="button" onClick={() => setAttempt(value => value + 1)}>重试任务归属</button>}
    {candidates && (candidates.totalGoals > candidates.pageSize || candidates.page > 1) && <div className="planning-pagination"><small>目标候选 · 第 {candidates.page} 页</small><div><button type="button" disabled={candidates.page <= 1} onClick={() => setCandidatePage(value => value - 1)}>上一页目标</button><button type="button" disabled={candidates.page * candidates.pageSize >= candidates.totalGoals} onClick={() => setCandidatePage(value => value + 1)}>下一页目标</button></div></div>}
    {draftError && <p role="alert">{draftError}</p>}
    <div className="adventure-form-footer"><button type="button" onClick={close}>取消</button><button type="submit" className="adventure-primary" disabled={blocked || !candidates}>{blocked ? '正在保存…' : parent ? '保存任务' : '创建任务'}</button></div>
  </fieldset></form>
}
