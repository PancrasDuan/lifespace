import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Plus, Sprout, Star, Trash2 } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningGoal, PlanningPage, PlanningTask, LifecyclePreview } from '../shared/adventure-planning'
import type { GrowthPage } from '../shared/adventure-growth'
import { Modal } from './ui'
import { usePlanning } from './usePlanning'
import { PlanningGrowth } from './PlanningGrowth'
import { TaskForm } from './PlanningTasks'
import { PlanningTaskHistory } from './PlanningReschedule'
import { GoalAchievement } from './GoalAchievement'
import { PrototypeGoalDetail } from './PrototypeGoalDetail'
import { PrototypeGoals } from './PrototypeGoals'
import { PrototypeTasks } from './PrototypeTasks'
import { Progress } from './PrototypeRecord'
import { PlanningToast } from './PlanningToast'
import { PlanningLifecycle, lifecycleTitles } from './PlanningLifecycle'
import { saveTerminalPreference } from './planning-preferences'
import explorer from './pixel-explorer.png'
import './adventure.css'
import './planning.css'
import './prototype-parity.css'
import './redesign.css'

type PlanningDialog = { kind: 'goal'; goal?: PlanningGoal } | { kind: 'detail'; id: string }
type Dialog = PlanningDialog | { kind: 'taskHistory'; id: string } | { kind: 'achieve'; id: string } | { kind: 'lifecycle'; operation: LifecyclePreview['operation'] } | { kind: 'task'; task?: PlanningTask }
type Action = (command: PlanningCommand) => Promise<boolean>

function PlanningForm({ dialog, data, action, busy, close, saved }: {
  dialog: Extract<Dialog, { kind: 'goal' }>
  data: PlanningPage; action: Action; busy: boolean; close: () => void; saved: () => void
}) {
  const goal = dialog.goal
  const [name, setName] = useState(goal?.title ?? '')
  const [standards, setStandards] = useState(goal?.standards.length ? goal.standards : [''])
  const [categoryLabel, setCategoryLabel] = useState(goal?.categoryLabel ?? '')
  const filled = standards.map(value => value.trim()).filter(Boolean)
  const labelTooLong = [...categoryLabel.trim()].length > 200
  const addStandard = (after: number) => setStandards(current => {
    if (current.length >= data.limits.standards) return current
    const next = [...current]
    next.splice(after + 1, 0, '')
    return next
  })
  const removeStandard = (index: number) => setStandards(current => current.length === 1 ? [''] : current.filter((_, i) => i !== index))
  const standardKey = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      addStandard(index)
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const command: PlanningCommand = goal ? { type: 'editGoal', id: goal.id, title: name, categoryLabel, standards: filled }
      : { type: 'createGoal', title: name, categoryLabel, standards: filled }
    if (await action(command)) saved()
  }
  return <form onSubmit={event => { void submit(event) }}>
    <fieldset disabled={busy}>
      <label>目标名称
        <input required autoComplete="off" maxLength={data.limits.name} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <>
        <fieldset className="planning-standards"><legend>完成标准</legend>
          {standards.map((value, index) => <div className="planning-standard-row" key={index}>
            <input aria-label={`完成标准 ${index + 1}`} autoComplete="off" maxLength={data.limits.standard}
              value={value} onChange={event => setStandards(current => current.map((item, i) => i === index ? event.target.value : item))}
              onKeyDown={event => standardKey(event, index)} />
            <button type="button" aria-label={`在完成标准 ${index + 1} 后添加`} disabled={standards.length >= data.limits.standards} onClick={() => addStandard(index)}><Plus size={17} /></button>
            <button type="button" aria-label={`删除完成标准 ${index + 1}`} onClick={() => removeStandard(index)}><Trash2 size={16} /></button>
          </div>)}
          {filled.length === 0 && <small className="planning-field-hint">至少填写一项非空标准</small>}
        </fieldset>
        <label>分类标签<input autoComplete="off" value={categoryLabel} aria-invalid={labelTooLong} onChange={event => setCategoryLabel(event.target.value)} /></label>
        {labelTooLong && <small className="planning-field-hint" role="alert">分类标签最多 200 个字符</small>}
      </>
      <div className="adventure-form-footer">
        <button type="button" onClick={close}>取消</button>
        <button className="adventure-primary" type="submit" disabled={busy || filled.length === 0 || labelTooLong}>{busy ? '正在保存…' : goal ? '保存目标' : '创建目标'}</button>
      </div>
    </fieldset>
  </form>
}

function Workspace() {
  const [tab, setTab] = useState<'overview' | 'planning' | 'growth'>(() => { const params = new URLSearchParams(window.location.search); return params.get('view') === 'growth' || params.has('rewardId') ? 'growth' : params.get('view') === 'planning' || params.has('goalId') ? 'planning' : 'overview' })
  const [legacyLink, setLegacyLink] = useState(() => {
    const params = new URLSearchParams(window.location.search), view = params.get('view')
    return params.has('mainlineId') ? '旧主线链接已停用' : params.has('goalScope') ? '旧目标筛选链接已停用'
      : view && !['overview', 'planning', 'growth'].includes(view) ? '该页面链接已停用' : ''
  })
  const [planningEnabled, setPlanningEnabled] = useState(tab !== 'growth')
  const model = usePlanning(planningEnabled)
  const { data, busy, uncertain } = model
  const identity = useVerifiedIdentity()
  const [openRecord, setOpenRecord] = useState<string | undefined>(() => { const params = new URLSearchParams(window.location.search), task = params.get('taskId'), goal = params.get('goalId'); return task ? `task:${task}` : goal ? `goal:${goal}` : undefined })
  const [growthSnapshot, setGrowthSnapshot] = useState<Pick<GrowthPage, 'version' | 'growth'>>()
  const [growthStatus, setGrowthStatus] = useState<'loading' | 'ready' | 'error'>(tab === 'growth' ? 'loading' : 'ready')
  const [planningReadFailed, setPlanningReadFailed] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<'goal' | 'task'>()
  const [createError, setCreateError] = useState('')
  const [dialog, setDialog] = useState<Dialog | undefined>(() => {
    const params = new URLSearchParams(window.location.search), goal = params.get('goalId')
    const task = params.get('taskId')
    return task ? { kind: 'taskHistory', id: task } : goal ? { kind: 'detail', id: goal } : undefined
  })
  const openDialog = useCallback((value?: Dialog) => { model.confirmation.invalidate(); setDialog(value) }, [model.confirmation.invalidate])
  const selectTab = (value: typeof tab) => { if (value === 'growth' && (busy || uncertain)) return; model.confirmation.invalidate(); setPendingCreate(undefined); if (value === 'growth' && tab !== 'growth') setGrowthStatus('loading'); if (value !== 'growth') setPlanningEnabled(true); setTab(value); window.history.replaceState(null, '', value === 'overview' ? '/adventure' : `/adventure?view=${value}`) }
  const [showTerminal, setShowTerminal] = useState(() => data?.includeTerminal ?? false)
  const [preferenceError, setPreferenceError] = useState('')
  useEffect(() => { if (data) setShowTerminal(data.includeTerminal) }, [data])
  useEffect(() => {
    if (!model.readRequired) setPlanningReadFailed(false)
    else if (model.error) setPlanningReadFailed(true)
  }, [model.readRequired, model.error])
  const changeTerminal = async (value: boolean) => {
    if (!model.canLoad()) return
    setPreferenceError(saveTerminalPreference(identity.ownerId, value) ? '' : '终态显示偏好未保存；本页仍可查看，刷新后使用默认设置。')
    setShowTerminal(value)
    await model.load({ includeTerminal: value, page: 1, goalId: undefined, goalTaskPage: 1 })
  }
  const inlineOrigin = useRef<HTMLElement | undefined>(undefined)
  const returnFocus = useRef<HTMLElement | undefined>(undefined)
  const delayedFocus = useRef<HTMLElement | undefined>(undefined)
  const close = useCallback((focusTarget?: HTMLElement) => {
    const origin = inlineOrigin.current
    inlineOrigin.current = undefined
    const opener = focusTarget ?? returnFocus.current
    returnFocus.current = undefined
    if (dialog?.kind === 'detail' && busy) delayedFocus.current = opener ?? origin
    if (dialog?.kind === 'detail') requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); else if (origin?.isConnected) origin.focus() })
    setOpenRecord(undefined); openDialog(undefined); model.clearGoal(); if (tab !== 'growth') window.history.replaceState(null, '', tab === 'planning' ? '/adventure?view=planning' : '/adventure')
  }, [model.clearGoal, openDialog, dialog, tab, busy])
  useEffect(() => {
    if (dialog) { delayedFocus.current = undefined; return }
    if (busy || !delayedFocus.current) return
    const target = delayedFocus.current
    delayedFocus.current = undefined
    // Do not interrupt a user who moved focus while the read was in flight.
    if (document.activeElement !== document.body) return
    if (target.isConnected && !target.matches(':disabled')) target.focus()
    else document.querySelector<HTMLButtonElement>('.view-tabs button[aria-current="page"]')?.focus()
  }, [busy, dialog])
  const blocked = model.blocked
  const createCapability = (kind: 'goal' | 'task') => data?.capabilities[kind === 'goal' ? 'createGoal' : 'createTask']
  const launchCreate = (kind: 'goal' | 'task') => {
    setCreateError('')
    if (!data || blocked) {
      setPendingCreate(kind)
      if (!planningEnabled) setPlanningEnabled(true)
      else if (!busy && !uncertain) void model.load()
      return
    }
    const capability = createCapability(kind)
    if (!capability?.allowed) { setCreateError(capability?.reason || '暂时无法新建，请稍后重试。'); return }
    openDialog({ kind })
  }
  useEffect(() => {
    if (!pendingCreate || !data || blocked) return
    const kind = pendingCreate
    setPendingCreate(undefined)
    launchCreate(kind)
  }, [pendingCreate, data, blocked])
  const saved = () => {
    const created = dialog?.kind === 'goal' && !dialog.goal
    close()
    if (created) selectTab('planning')
  }
  const recovery = (uncertain || model.readRequired) && !busy ? <button type="button" onClick={() => {
    void model.recover(close).then(type => {
      if (type === 'createGoal') selectTab('planning')
    })
  }}>{uncertain ? model.recoveryLabel : '重新读取'}</button> : null
  const cancelTask = async (task: PlanningTask) => {
    if (!task.completionId) return
    await model.command({ type: 'cancelTaskCompletion', completionId: task.completionId })
  }
  const openGoal = (id: string) => {
    if (blocked) return
    if (tab === 'planning' && dialog?.kind === 'detail' && dialog.id === id) { close(); return }
    inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest('article')?.querySelector<HTMLElement>(':scope > .record-summary') ?? document.activeElement : undefined
    setTab('planning')
    setPlanningEnabled(true)
    setOpenRecord(`goal:${id}`)
    openDialog({ kind: 'detail', id })
    window.history.replaceState(null, '', `/adventure?goalId=${id}`)
    void model.load({ goalId: id, goalTaskPage: 1 })
  }
  const achieveGoal = async (id: string) => {
    await model.confirmation.refresh({ type: 'achieveGoal', id, coefficient: 1, reflection: '' }, () => setDialog({ kind: 'achieve', id }))
  }
  const openLifecycle = async (operation: LifecyclePreview['operation'], id: string) => {
    await model.confirmation.refresh({ type: operation, id }, () => setDialog({ kind: 'lifecycle', operation }))
  }
  const toggleRecord = (id: string) => setOpenRecord(current => current === id ? undefined : id)
  const toggleTask = (id: string) => {
    const next = openRecord === `task:${id}` ? undefined : `task:${id}`
    if (dialog) {
      inlineOrigin.current = undefined
      openDialog(undefined)
      model.clearGoal()
      window.history.replaceState(null, '', '/adventure')
    }
    setOpenRecord(next)
  }
  const toggleGoal = (id: string) => { const next = openRecord === `goal:${id}` ? undefined : `goal:${id}`; setOpenRecord(next); if (next) { if (dialog?.kind !== 'detail' || dialog.id !== id) { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; openDialog({ kind: 'detail', id }); window.history.replaceState(null, '', `/adventure?goalId=${id}`); void model.load({ goalId: id, goalTaskPage: 1 }) } } else close() }
  const detailGoal = dialog?.kind === 'detail' ? (data?.goalDetail?.goal.id === dialog.id ? data.goalDetail.goal : data?.goals.find(item => item.id === dialog.id)) : undefined
  const preview = model.confirmation.preview
  const taskDeletion = dialog?.kind === 'task' && dialog.task && preview && 'operation' in preview && preview.operation === 'deleteTask' && preview.entityId === dialog.task.id ? preview : undefined
  const dismissTaskDeletion = () => { if (blocked) close(); else model.confirmation.invalidate() }
  const title = taskDeletion ? '删除任务' : !dialog ? '' : dialog.kind === 'detail' ? '目标详情'
    : dialog.kind === 'taskHistory' ? '任务安排历史' : dialog.kind === 'achieve' ? '确认目标达成' : dialog.kind === 'lifecycle' ? lifecycleTitles[dialog.operation] : dialog.kind === 'task' ? dialog.task ? '编辑任务' : '创建任务'
    : dialog.goal ? '编辑目标' : '创建目标'
  const goals = data?.goals
  const goalDetails = data && detailGoal && <PrototypeGoalDetail key={detailGoal.id} goal={detailGoal} detail={data.goalDetail?.goal.id === detailGoal.id ? data.goalDetail : null} pageSize={data.pageSize} blocked={blocked}
    changePage={page => { void model.load({ goalTaskPage: page }) }} />

  const growth = growthSnapshot && (!data || growthSnapshot.version >= data.version) ? growthSnapshot.growth : data?.growth
  const growthUnavailable = tab === 'growth' ? growthStatus === 'error' : !busy && model.readRequired && (!!model.error || planningReadFailed)
  return <AppLayout page="adventure"><div className="adventure-page planning-page prototype-page">
    <header className="page-heading">
      <div className="page-kicker"><span className="live-dot" aria-hidden="true" />LifeSpace · 人生规划</div>
      <h1>人生冒险</h1><p>把想做的事，慢慢变成现实。</p>
    </header>
    <div className="adventure-toolbar">
      <div className="create-intro"><strong>新建</strong><span>从目标或行动开始</span></div>
      <div className="heading-actions" role="group" aria-label="新建">
        {model.lastAchievement && <button type="button" className="new-button" disabled={blocked} onClick={() => openGoal(model.lastAchievement!)}>查看达成结果</button>}
        <button type="button" className="new-button" disabled={!model.storageReady || busy || uncertain || !!pendingCreate || (data ? blocked || !createCapability('goal')?.allowed : tab !== 'growth')} title={createCapability('goal')?.reason} onClick={() => { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; launchCreate('goal') }}><Sprout size={15} /><span>新建目标</span></button>
        <button type="button" className="new-button create-action-primary" disabled={!model.storageReady || busy || uncertain || !!pendingCreate || (data ? blocked || !createCapability('task')?.allowed : tab !== 'growth')} title={createCapability('task')?.reason} onClick={() => { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; launchCreate('task') }}><Plus size={15} /><span>新建行动</span></button>
      </div>
    </div>
    {legacyLink && <p role="alert" className="adventure-hint">{legacyLink}，请从目标列表查看。 <button type="button" onClick={() => { setLegacyLink(''); selectTab('planning') }}>查看目标</button></p>}
    {pendingCreate && busy && <p role="status" className="adventure-hint">正在读取创建所需的数据…</p>}
    {pendingCreate && model.error && <div role="alert" className="planning-recovery">{model.error} {recovery}<button type="button" onClick={() => setPendingCreate(undefined)}>取消</button></div>}
    {createError && <p role="alert" className="adventure-hint">{createError}</p>}

    <section className={`adventure-growth-bar${growth ? '' : ' adventure-growth-placeholder'}`} aria-label="经验概览" aria-busy={!growth && !growthUnavailable}>
      {growth ? <>
      <div className="growth-bar-level"><div className="level-lockup"><strong>{String(growth.level).padStart(2, '0')}</strong><div><span>当前等级</span><p>再获得 {growth.remaining} 点经验进入下一级</p></div></div><Progress value={growth.needed ? growth.progress / growth.needed : 0} label="当前等级经验" /></div>
      <dl className="growth-numbers"><div><dt>累计经验</dt><dd>{growth.totalXp}</dd></div><div><dt>真实行动</dt><dd>{growth.actions}</dd></div><div><dt>达成目标</dt><dd>{growth.achievedGoals}</dd></div></dl>
      {tab === 'growth' && growthStatus !== 'ready' && <span className="growth-update-status" role="status">{growthStatus === 'loading' ? '正在更新' : '暂未更新'}</span>}
      </> : <p role="status">{growthUnavailable ? '经验概览暂时无法读取' : '正在读取经验概览…'}</p>}
    </section>

    <nav className="view-tabs" aria-label="冒险页面"><button aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => selectTab('overview')}>今日聚焦</button>
      <button aria-current={tab === 'planning' ? 'page' : undefined} onClick={() => selectTab('planning')}>目标</button>
      <button disabled={busy || uncertain} aria-current={tab === 'growth' ? 'page' : undefined} onClick={() => selectTab('growth')}>成长记录</button></nav>

    {(tab !== 'growth' || uncertain) && (!dialog || !data) && recovery && <div className="planning-recovery">{recovery}</div>}
    {(tab !== 'growth' || uncertain || dialog) && (model.error ? <PlanningToast key={model.error} tone="error" withinDialog={!!dialog && !!data} message={model.error} close={model.clearError} /> : !model.readRequired && model.notice && <PlanningToast key={model.notice.id} message={model.notice.message} close={model.clearNotice} />)}
    {dialog && !data && !busy && <div className="planning-recovery"><button onClick={() => { close(); void model.load() }}>返回冒险</button></div>}
    {tab !== 'growth' && !data && busy && <p role="status" className="adventure-empty">正在读取你的冒险…</p>}
    {tab === 'growth' && <PlanningGrowth onGrowthChange={setGrowthSnapshot} onGrowthStatusChange={setGrowthStatus} />}

    {data && tab !== 'growth' && <div className={`adventure-proto-workspace${tab === 'planning' ? ' adventure-proto-map' : ''}`}>
        {tab === 'overview' && (data.capabilities.createTask?.allowed ? <PrototypeTasks data={data} reload={() => model.load()} blocked={blocked} openTask={openRecord?.startsWith('task:') ? openRecord.slice(5) : undefined} toggleTask={toggleTask}
          edit={task => openDialog({ kind: 'task', task })} complete={task => { void model.command({ type: 'completeTask', id: task.id }) }} cancel={task => { void cancelTask(task) }} />
          : <section className="content-section"><header className="section-heading"><div><span className="section-context">今天要做的事</span><h2>一次性任务</h2></div></header><p className="adventure-hint">{data.capabilities.createTask?.reason}</p></section>)}

      {tab === 'overview' && <aside className="adventure-proto-aside">
        <section className="aside-panel next-milestone"><span className="eyebrow">下一处风景</span>{data.growth.achievements.filter(item => !item.unlocked).slice(0, 2).map((item, index) => <div className={`milestone-line${index ? ' is-muted' : ''}`} key={item.id}><span className="milestone-icon">{index ? <Sprout size={16} /> : <Star size={16} />}</span><div><strong>{item.label}</strong><p>还差 {item.remaining} {item.id.startsWith('actions_') ? '次真实行动' : '个达成目标'}</p></div></div>)}{data.growth.achievements.every(item => item.unlocked) && <div className="milestone-line"><span className="milestone-icon"><Star size={16} /></span><div><strong>全部点亮</strong><p>继续保持现在的节奏</p></div></div>}<button type="button" className="aside-link" disabled={busy || uncertain} onClick={() => selectTab('growth')}>查看完整成长记录</button></section>
        <div className="adventure-journey-note"><img src={explorer} alt="" /><p>先走稳眼前这一步，<br />远方自然会靠近。</p></div>
      </aside>}

        {tab === 'planning' && <>
        <section className="content-section adventure-proto-goal-section">
          <header className="section-heading"><div><h2><Sprout size={18} />目标</h2></div><div className="section-heading-tools"><span className="section-count">{data.totalGoals} 个目标</span><label className="quiet-toggle"><input aria-label="显示已达成／已结束" type="checkbox" checked={showTerminal} disabled={blocked} onChange={event => changeTerminal(event.target.checked)} />显示终态</label></div></header>
          {preferenceError && <p role="status" className="adventure-hint">{preferenceError}</p>}
          {goals?.length === 0 ? <p className="adventure-empty">{data.totalGoals ? '本页没有目标，请返回上一页。' : '还没有目标。先创建一个目标，再为它添加任务。'}</p> : <PrototypeGoals goals={goals ?? []} blocked={blocked} action={model.command} edit={goal => openDialog({ kind: 'goal', goal })} achieve={goal => { void achieveGoal(goal.id) }} end={goal => { void openLifecycle('endGoal', goal.id) }} openGoal={openRecord?.startsWith('goal:') ? openRecord.slice(5) : undefined} toggleGoal={toggleGoal} />}
          {data.totalGoals > data.pageSize && <div className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div><button disabled={blocked || data.page <= 1} onClick={() => { void model.load({ page: data.page - 1 }) }}>上一页</button><button disabled={blocked || data.page * data.pageSize >= data.totalGoals} onClick={() => { void model.load({ page: data.page + 1 }) }}>下一页</button></div></div>}
        </section>
        </>}
    </div>}

    {dialog && data && <Modal title={title} close={taskDeletion ? dismissTaskDeletion : close} restoreFocus={inlineOrigin.current} id={dialog.kind === 'detail' ? `goal-detail-${dialog.id}` : undefined} className={dialog.kind === 'task' ? 'task-dialog' : dialog.kind === 'detail' ? 'goal-relation-dialog' : undefined}>
      {dialog.kind === 'detail' ? goalDetails ?? <p role="status">正在读取目标详情…</p>
      : dialog.kind === 'taskHistory' ? <PlanningTaskHistory key={dialog.id} id={dialog.id} />
      : dialog.kind === 'achieve' ? preview && 'goalId' in preview && preview.operation === 'achieveGoal' && <GoalAchievement preview={preview} confirmation={model.confirmation} saved={() => { openDialog({ kind: 'detail', id: dialog.id }); void model.load({ goalId: dialog.id, goalTaskPage: 1 }) }} cancel={close} />
      : dialog.kind === 'lifecycle' ? preview && 'entityId' in preview && <PlanningLifecycle preview={preview} confirmation={model.confirmation} saved={close} cancel={close} />
      : dialog.kind === 'task' ? <TaskForm key={dialog.task?.id ?? 'new-task'} task={dialog.task} remove={dialog.task ? () => { void model.confirmation.refresh({ type: 'deleteTask', id: dialog.task!.id }) } : undefined} deleteConfirmation={taskDeletion && <PlanningLifecycle preview={taskDeletion} confirmation={model.confirmation} saved={close} cancel={dismissTaskDeletion} />} data={data} action={model.command} busy={blocked} close={close} changeGoalPage={page => { void model.load({ page }) }} />
      : <PlanningForm key={dialog.goal?.id ?? 'new-goal'} dialog={dialog} data={data} action={model.command} busy={blocked} close={close} saved={saved} />}
      {recovery && <div className="planning-recovery">{recovery}</div>}
    </Modal>}
  </div></AppLayout>
}

export function PlanningWorkspace() {
  const identity = useVerifiedIdentity()
  return <Workspace key={identity.ownerId} />
}
