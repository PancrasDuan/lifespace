import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Compass, Flag, Plus, Sprout, Star, Trash2 } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningGoal, PlanningPage, PlanningTask, PlanningPreview, GoalAchievementPreview, LifecyclePreview } from '../shared/adventure-planning'
import type { GrowthPage } from '../shared/adventure-growth'
import { Modal } from './ui'
import { usePlanning } from './usePlanning'
import { MainlineHistory } from './MainlineHistory'
import { PlanningGrowth } from './PlanningGrowth'
import { TaskForm } from './PlanningTasks'
import { PlanningReschedule, PlanningTaskHistory } from './PlanningReschedule'
import { PlanningMigration } from './PlanningMigration'
import { GoalAchievement } from './GoalAchievement'
import { PrototypeGoalDetail } from './PrototypeGoalDetail'
import { PrototypeGoals } from './PrototypeGoals'
import { PrototypeTasks } from './PrototypeTasks'
import { MoreActions, Progress, Record } from './PrototypeRecord'
import { PlanningToast } from './PlanningToast'
import { PlanningLifecycle, lifecycleTitles } from './PlanningLifecycle'
import { saveTerminalPreference } from './planning-preferences'
import explorer from './pixel-explorer.png'
import './adventure.css'
import './planning.css'
import './prototype-parity.css'
import './redesign.css'

type PlanningDialog = { kind: 'mainline'; id?: string; name?: string } | { kind: 'goal'; goal?: PlanningGoal } | { kind: 'detail'; id: string } | { kind: 'mainlineDetail'; id: string }
type Dialog = PlanningDialog | { kind: 'taskHistory'; id: string } | { kind: 'reschedule'; task: PlanningTask } | { kind: 'migrate'; entityKind: 'goal' | 'task'; id: string; title: string } | { kind: 'achieve'; preview: GoalAchievementPreview } | { kind: 'lifecycle'; preview: LifecyclePreview } | { kind: 'task'; task?: PlanningTask; destination?: string } | { kind: 'cancel'; task: PlanningTask; preview: Extract<PlanningPreview, { completionId: string }> }
type Action = (command: PlanningCommand) => Promise<boolean>

function PlanningForm({ dialog, data, action, busy, close }: {
  dialog: Extract<Dialog, { kind: 'mainline' } | { kind: 'goal' }>
  data: PlanningPage; action: Action; busy: boolean; close: () => void
}) {
  const goal = dialog.kind === 'goal' ? dialog.goal : undefined
  const [name, setName] = useState(dialog.kind === 'mainline' ? dialog.name ?? '' : goal?.title ?? '')
  const [standards, setStandards] = useState(goal?.standards.length ? goal.standards : [''])
  const [destination, setDestination] = useState(goal?.independent ? '' : goal?.mainlineId ?? '')
  const filled = standards.map(value => value.trim()).filter(Boolean)
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
    const command: PlanningCommand = dialog.kind === 'mainline'
      ? dialog.id ? { type: 'renameMainline', id: dialog.id, name } : { type: 'createMainline', name }
      : goal ? { type: 'editGoal', id: goal.id, title: name, destination, standards: filled }
        : { type: 'createGoal', title: name, destination, standards: filled }
    if (await action(command)) close()
  }
  return <form onSubmit={event => { void submit(event) }}>
    <fieldset disabled={busy}>
      <label>{dialog.kind === 'mainline' ? '主线名称' : '目标名称'}
        <input required autoComplete="off" maxLength={data.limits.name} value={name} onChange={event => setName(event.target.value)} />
      </label>
      {dialog.kind === 'goal' && <>
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
        <label>目标归属<select className={destination === '' ? 'planning-destination-placeholder' : undefined} value={destination} onChange={event => setDestination(event.target.value)}>
          <option value="">默认独立目标</option>
          {data.destinations.filter(item => item.id !== 'independent').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </>}
      <div className="adventure-form-footer">
        <button type="button" onClick={close}>取消</button>
        <button className="adventure-primary" type="submit" disabled={busy || (dialog.kind === 'goal' && filled.length === 0)}>{busy ? '正在保存…' : dialog.kind === 'mainline' ? dialog.id ? '保存名称' : '创建主线' : goal ? '保存目标' : '创建目标'}</button>
      </div>
    </fieldset>
  </form>
}

function Workspace() {
  const [tab, setTab] = useState<'overview' | 'planning' | 'growth'>(() => { const params = new URLSearchParams(window.location.search); return params.get('view') === 'growth' || params.has('rewardId') ? 'growth' : params.get('view') === 'planning' || params.has('goalId') || params.has('mainlineId') ? 'planning' : 'overview' })
  const [planningEnabled, setPlanningEnabled] = useState(tab !== 'growth')
  const model = usePlanning(planningEnabled)
  const { data, busy, uncertain } = model
  const identity = useVerifiedIdentity()
  const [openRecord, setOpenRecord] = useState<string | undefined>(() => { const params = new URLSearchParams(window.location.search), task = params.get('taskId'), goal = params.get('goalId'), main = params.get('mainlineId'); return task ? `task:${task}` : goal ? `goal:${goal}` : main ? `mainline:${main}` : undefined })
  const [growthSnapshot, setGrowthSnapshot] = useState<Pick<GrowthPage, 'version' | 'growth'>>()
  const [growthStatus, setGrowthStatus] = useState<'loading' | 'ready' | 'error'>(tab === 'growth' ? 'loading' : 'ready')
  const [planningReadFailed, setPlanningReadFailed] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<'mainline' | 'goal' | 'task'>()
  const [createError, setCreateError] = useState('')
  const [dialog, setDialog] = useState<Dialog | undefined>(() => {
    const params = new URLSearchParams(window.location.search), goal = params.get('goalId'), main = params.get('mainlineId')
    const task = params.get('taskId')
    return task ? { kind: 'taskHistory', id: task } : goal ? { kind: 'detail', id: goal } : main ? { kind: 'mainlineDetail', id: main } : undefined
  })
  const selectTab = (value: typeof tab) => { if (value === 'growth' && (busy || uncertain)) return; setPendingCreate(undefined); if (value === 'growth' && tab !== 'growth') setGrowthStatus('loading'); if (value !== 'growth') setPlanningEnabled(true); setTab(value); window.history.replaceState(null, '', value === 'overview' ? '/adventure' : `/adventure?view=${value}`) }
  const [showTerminal, setShowTerminal] = useState(() => data?.includeTerminal ?? false)
  const [preferenceError, setPreferenceError] = useState('')
  useEffect(() => { if (data) setShowTerminal(data.includeTerminal) }, [data])
  useEffect(() => {
    if (!model.readRequired) setPlanningReadFailed(false)
    else if (model.error) setPlanningReadFailed(true)
  }, [model.readRequired, model.error])
  const changeTerminal = async (value: boolean) => {
    setPreferenceError(saveTerminalPreference(identity.ownerId, value) ? '' : '终态显示偏好未保存；本页仍可查看，刷新后使用默认设置。')
    setShowTerminal(value)
    await model.load({ includeTerminal: value, page: 1, goalId: undefined, goalTaskPage: 1 })
  }
  const previewGeneration = useRef(0)
  const inlineOrigin = useRef<HTMLElement | undefined>(undefined)
  const returnFocus = useRef<HTMLElement | undefined>(undefined)
  const close = useCallback((focusTarget?: HTMLElement) => {
    const origin = inlineOrigin.current
    inlineOrigin.current = undefined
    const opener = focusTarget ?? returnFocus.current
    returnFocus.current = undefined
    if (dialog?.kind === 'detail' || dialog?.kind === 'mainlineDetail') requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); else if (origin?.isConnected) origin.focus() })
    previewGeneration.current++; setOpenRecord(undefined); setDialog(undefined); model.clearGoal(); if (tab !== 'growth') window.history.replaceState(null, '', tab === 'planning' ? '/adventure?view=planning' : '/adventure')
  }, [model.clearGoal, model.load, dialog, tab])
  const blocked = busy || uncertain || model.readRequired
  const createCapability = (kind: 'mainline' | 'goal' | 'task') => data?.capabilities[kind === 'mainline' ? 'createMainline' : kind === 'goal' ? 'createGoal' : 'createTask']
  const launchCreate = (kind: 'mainline' | 'goal' | 'task') => {
    setCreateError('')
    if (!data || blocked) {
      setPendingCreate(kind)
      if (!planningEnabled) setPlanningEnabled(true)
      else if (!busy && !uncertain) void model.load()
      return
    }
    const capability = createCapability(kind)
    if (!capability?.allowed) { setCreateError(capability?.reason || '暂时无法新建，请稍后重试。'); return }
    if (kind !== 'task') selectTab('planning')
    setDialog({ kind })
  }
  useEffect(() => {
    if (!pendingCreate || !data || blocked) return
    const kind = pendingCreate
    setPendingCreate(undefined)
    launchCreate(kind)
  }, [pendingCreate, data, blocked])
  const recovery = (uncertain || model.readRequired) && !busy ? <button type="button" onClick={() => {
    if (uncertain) void model.retry().then(saved => { if (saved) close() })
    else void model.load()
  }}>{uncertain ? '安全重试同一次操作' : '重新读取'}</button> : null
  const cancelTask = async (task: PlanningTask) => {
    if (!task.completionId) return
    const generation = previewGeneration.current
    const preview = await model.preview({ type: 'cancelTaskCompletion', completionId: task.completionId })
    if (generation === previewGeneration.current && preview && 'completionId' in preview) setDialog({ kind: 'cancel', task, preview })
  }
  const openGoal = (id: string) => {
    if (blocked) return
    if (tab === 'planning' && dialog?.kind === 'detail' && dialog.id === id) { close(); return }
    previewGeneration.current++
    inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest('article')?.querySelector<HTMLElement>(':scope > .record-summary') ?? document.activeElement : undefined
    setTab('planning')
    setPlanningEnabled(true)
    setOpenRecord(`goal:${id}`)
    setDialog({ kind: 'detail', id })
    window.history.replaceState(null, '', `/adventure?goalId=${id}`)
    void model.load({ goalId: id, mainlineId: undefined, goalTaskPage: 1, page: 1 })
  }
  const openMainline = (id: string) => {
    if (blocked) return
    if (dialog?.kind === 'mainlineDetail' && dialog.id === id) return
    previewGeneration.current++
    inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest('article')?.querySelector<HTMLElement>(':scope > .record-summary') ?? document.activeElement : undefined
    setTab('planning')
    setOpenRecord(`mainline:${id}`)
    setDialog({ kind: 'mainlineDetail', id })
    window.history.replaceState(null, '', `/adventure?mainlineId=${id}`)
  }
  const achieveGoal = async (id: string) => {
    const generation = previewGeneration.current
    const preview = await model.preview({ type: 'achieveGoal', id, coefficient: 1, reflection: '' })
    if (generation === previewGeneration.current && preview && 'goalId' in preview && preview.operation === 'achieveGoal') setDialog({ kind: 'achieve', preview })
  }
  const openLifecycle = async (operation: LifecyclePreview['operation'], id: string) => {
    const generation = previewGeneration.current
    const preview = await model.preview({ type: operation, id })
    if (generation === previewGeneration.current && preview && 'entityId' in preview && preview.operation === operation)
      setDialog({ kind: 'lifecycle', preview })
  }
  const toggleRecord = (id: string) => setOpenRecord(current => current === id ? undefined : id)
  const toggleTask = (id: string) => {
    const next = openRecord === `task:${id}` ? undefined : `task:${id}`
    const mainlineWasOpen = dialog?.kind === 'mainlineDetail'
    if (dialog) {
      previewGeneration.current++
      inlineOrigin.current = undefined
      setDialog(undefined)
      model.clearGoal()
      window.history.replaceState(null, '', '/adventure')
    }
    setOpenRecord(next)
  }
  const toggleGoal = (id: string) => { const next = openRecord === `goal:${id}` ? undefined : `goal:${id}`; setOpenRecord(next); if (next) { if (dialog?.kind !== 'detail' || dialog.id !== id) { previewGeneration.current++; inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; setDialog({ kind: 'detail', id }); window.history.replaceState(null, '', `/adventure?goalId=${id}`); void model.load({ goalId: id, mainlineId: undefined, goalTaskPage: 1, page: 1 }) } } else close() }
  const detailGoal = dialog?.kind === 'detail' ? (data?.goalDetail?.goal.id === dialog.id ? data.goalDetail.goal : data?.goals.find(item => item.id === dialog.id)) : undefined
  const title = !dialog ? '' : dialog.kind === 'detail' ? '目标详情' : dialog.kind === 'mainlineDetail' ? '主线历史'
    : dialog.kind === 'taskHistory' ? '任务安排历史' : dialog.kind === 'reschedule' ? '任务改期' : dialog.kind === 'migrate' ? dialog.entityKind === 'goal' ? '迁移目标' : '迁移任务' : dialog.kind === 'achieve' ? '确认目标达成' : dialog.kind === 'lifecycle' ? lifecycleTitles[dialog.preview.operation] : dialog.kind === 'task' ? dialog.task ? '编辑任务' : '创建任务' : dialog.kind === 'cancel' ? '取消任务完成'
    : dialog.kind === 'mainline' ? dialog.id ? '修改主线名称' : '创建主线' : dialog.goal ? '编辑目标' : '创建目标'
  const goals = data?.goals
  const inlineDetail = dialog?.kind === 'detail' || dialog?.kind === 'mainlineDetail'
  useEffect(() => {
    if (!inlineDetail) return
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [inlineDetail, close])
  const goalDetails = data && detailGoal && <section aria-label="目标详情">
    <PrototypeGoalDetail goal={detailGoal} history={data.goalDetail?.goal.id === detailGoal.id ? data.goalDetail : null} pageSize={data.pageSize} blocked={blocked}
      migrate={() => setDialog({ kind: 'migrate', entityKind: 'goal', id: detailGoal.id, title: detailGoal.title })} edit={() => setDialog({ kind: 'goal', goal: detailGoal })} addTask={() => setDialog({ kind: 'task', destination: detailGoal.id })}
      focus={() => { void model.command({ type: 'focusGoal', id: detailGoal.id, focused: !detailGoal.focused }) }} achieve={() => { void achieveGoal(detailGoal.id) }} end={() => { void openLifecycle('endGoal', detailGoal.id) }}
      changePage={page => { void model.load({ goalTaskPage: page }) }}
      reorder={<>{(['up', 'down'] as const).map(direction => <button key={direction} aria-label={`${direction === 'up' ? '上移' : '下移'}目标 ${detailGoal.title}`} disabled={blocked || !detailGoal.capabilities[direction === 'up' ? 'moveUp' : 'moveDown']?.allowed}
        onClick={() => { void model.command({ type: 'reorderGoals', mainlineId: detailGoal.mainlineId, id: detailGoal.id, direction }) }}>{direction === 'up' ? '↑ 上移' : '↓ 下移'}</button>)}</>} />
  </section>

  const selectedMainline = dialog?.kind === 'mainlineDetail' ? (data?.mainlineDetail?.id === dialog.id ? data.mainlineDetail : data?.mainlines.find(item => item.id === dialog.id)) : undefined
  const growth = growthSnapshot && (!data || growthSnapshot.version >= data.version) ? growthSnapshot.growth : data?.growth
  const growthUnavailable = tab === 'growth' ? growthStatus === 'error' : !busy && model.readRequired && (!!model.error || planningReadFailed)
  const mainlineDetails = data && dialog?.kind === 'mainlineDetail' && <MainlineHistory key={`${dialog.id}:${data.version}`} id={dialog.id} blocked={blocked} openGoal={openGoal} />
  return <AppLayout page="adventure"><div className="adventure-page planning-page prototype-page">
    <header className="page-heading">
      <div className="page-kicker"><span className="live-dot" aria-hidden="true" />LifeSpace · 人生规划</div>
      <h1>人生冒险</h1><p>把想做的事，慢慢变成现实。</p>
    </header>
    <div className="adventure-toolbar">
      <div className="create-intro"><strong>新建</strong><span>从方向、目标或行动开始</span></div>
      <div className="heading-actions" role="group" aria-label="新建">
        {model.lastAchievement && <button type="button" className="new-button" disabled={blocked} onClick={() => openGoal(model.lastAchievement!)}>查看达成结果</button>}
        <button type="button" className="new-button" disabled={busy || uncertain || !!pendingCreate || (data ? blocked || !createCapability('mainline')?.allowed : tab !== 'growth')} title={createCapability('mainline')?.reason} onClick={() => { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; launchCreate('mainline') }}><Flag size={15} /><span>新建主线</span></button>
        <button type="button" className="new-button" disabled={busy || uncertain || !!pendingCreate || (data ? blocked || !createCapability('goal')?.allowed : tab !== 'growth')} title={createCapability('goal')?.reason} onClick={() => { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; launchCreate('goal') }}><Sprout size={15} /><span>新建目标</span></button>
        <button type="button" className="new-button create-action-primary" disabled={busy || uncertain || !!pendingCreate || (data ? blocked || !createCapability('task')?.allowed : tab !== 'growth')} title={createCapability('task')?.reason} onClick={() => { inlineOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; launchCreate('task') }}><Plus size={15} /><span>新建行动</span></button>
      </div>
    </div>
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

    <nav className="view-tabs" aria-label="冒险页面"><button aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => selectTab('overview')}>今天</button>
      <button aria-current={tab === 'planning' ? 'page' : undefined} onClick={() => selectTab('planning')}>主线与目标</button>
      <button disabled={busy || uncertain} aria-current={tab === 'growth' ? 'page' : undefined} onClick={() => selectTab('growth')}>成长记录</button></nav>

    {tab !== 'growth' && (!dialog || inlineDetail || !data) && recovery && <div className="planning-recovery">{recovery}</div>}
    {tab !== 'growth' && (model.error ? <PlanningToast key={model.error} tone="error" withinDialog={!!dialog && !inlineDetail && !!data} message={model.error} close={model.clearError} /> : !model.readRequired && model.notice && <PlanningToast key={model.notice.id} message={model.notice.message} close={model.clearNotice} />)}
    {dialog && !data && !busy && <div className="planning-recovery"><button onClick={() => { close(); void model.load() }}>返回冒险</button></div>}
    {tab !== 'growth' && !data && busy && <p role="status" className="adventure-empty">正在读取你的冒险…</p>}
    {tab === 'growth' && <PlanningGrowth onGrowthChange={setGrowthSnapshot} onGrowthStatusChange={setGrowthStatus} />}

    {data && tab !== 'growth' && <div className={`adventure-proto-workspace${tab === 'planning' ? ' adventure-proto-map' : ''}`}>
        {tab === 'overview' && (data.capabilities.createTask?.allowed ? <PrototypeTasks data={data} blocked={blocked} openTask={openRecord?.startsWith('task:') ? openRecord.slice(5) : undefined} toggleTask={toggleTask}
          changeSearch={search => { void model.load({ search, taskPage: 1 }) }} changeRange={range => { void model.load({ taskRange: range, taskPage: 1 }) }} changePage={page => { void model.load({ taskPage: page }) }}
          reschedule={task => setDialog({ kind: 'reschedule', task })} migrate={task => setDialog({ kind: 'migrate', entityKind: 'task', id: task.id, title: task.title })} edit={task => setDialog({ kind: 'task', task })} complete={task => { void model.command({ type: 'completeTask', id: task.id }) }} cancel={task => { void cancelTask(task) }} end={task => { void openLifecycle('endTask', task.id) }} remove={task => { void openLifecycle('deleteTask', task.id) }} />
          : <section className="content-section"><header className="section-heading"><div><span className="section-context">今天要做的事</span><h2>一次性任务</h2></div></header><p className="adventure-hint">{data.capabilities.createTask?.reason}</p></section>)}

      {tab === 'overview' && <aside className="adventure-proto-aside">
        <section className="aside-panel next-milestone"><span className="eyebrow">下一处风景</span>{data.growth.achievements.filter(item => !item.unlocked).slice(0, 2).map((item, index) => <div className={`milestone-line${index ? ' is-muted' : ''}`} key={item.id}><span className="milestone-icon">{index ? <Sprout size={16} /> : <Star size={16} />}</span><div><strong>{item.label}</strong><p>还差 {item.remaining} {item.id.startsWith('actions_') ? '次真实行动' : '个达成目标'}</p></div></div>)}{data.growth.achievements.every(item => item.unlocked) && <div className="milestone-line"><span className="milestone-icon"><Star size={16} /></span><div><strong>全部点亮</strong><p>继续保持现在的节奏</p></div></div>}<button type="button" className="aside-link" disabled={busy || uncertain} onClick={() => selectTab('growth')}>查看完整成长记录</button></section>
        <div className="adventure-journey-note"><img src={explorer} alt="" /><p>先走稳眼前这一步，<br />远方自然会靠近。</p></div>
      </aside>}

        {tab === 'planning' && <>
        <section className="content-section">
          <header className="section-heading"><div><span className="section-context">方向</span><h2><Flag size={17} />我的主线</h2></div><div className="section-heading-tools"><span className="section-count">{data.mainlines.filter(item => item.status === 'active').length} 条在用</span><label className="quiet-toggle"><input aria-label="显示已达成／已结束" type="checkbox" checked={showTerminal} disabled={blocked} onChange={event => changeTerminal(event.target.checked)} />显示终态</label></div></header>
          {preferenceError && <p role="status" className="adventure-hint">{preferenceError}</p>}
          {data.mainlines.length === 0 ? <p className="adventure-empty">还没有主线。为长期经营的方向起一个名字。</p> : <div className="record-list adventure-proto-mainline-list">{data.mainlines.map(mainline => {
            const open = openRecord === `mainline:${mainline.id}`
            return <Record key={mainline.id} label={`主线：${mainline.name}`} open={open} disabled={blocked} className={mainline.status === 'ended' ? 'is-terminal' : ''} toggle={() => { const next = open ? undefined : `mainline:${mainline.id}`; if (!next && dialog?.kind === 'mainlineDetail') close(); else setOpenRecord(next) }} summary={<>
              <span className="record-mark"><Compass size={17} /></span><span className="record-copy"><span className="record-kicker">在用的长期方向</span><strong>{mainline.name}</strong><small>{mainline.status === 'ended' ? '已结束，只读保留' : `正在推进 · ${mainline.activeGoalCount} 个目标`}</small></span>
              <span className="record-meta"><span>{mainline.status === 'ended' ? '已结束' : '在用'}</span><ChevronMarker open={open} /></span>
            </>}>
              {open && <><dl className="plain-facts"><div><dt>状态</dt><dd>{mainline.status === 'ended' ? '已结束' : '进行中'}</dd></div><div><dt>正在推进</dt><dd>{mainline.activeGoalCount} 个目标</dd></div><div><dt>今日行动</dt><dd>{mainline.todayTaskCount} 项</dd></div></dl>
                {selectedMainline?.id === mainline.id && mainlineDetails}<div className="record-actions"><button disabled={blocked} onClick={() => openMainline(mainline.id)}>查看历史</button><MoreActions><button disabled={blocked || mainline.status !== 'active' || !mainline.capabilities.rename?.allowed} aria-label={`修改主线 ${mainline.name}`} onClick={() => setDialog({ kind: 'mainline', id: mainline.id, name: mainline.name })}>修改名称</button><button disabled={blocked || !mainline.capabilities.end?.allowed} title={mainline.capabilities.end?.reason} onClick={() => { void openLifecycle('endMainline', mainline.id) }}>结束主线</button></MoreActions></div></>}
            </Record>
          })}</div>}
          {dialog?.kind === 'mainlineDetail' && !data.mainlines.some(item => item.id === dialog.id) && <div className="planning-goal planning-standalone-detail"><header><h3>{selectedMainline?.name ?? '主线历史'}</h3><button onClick={() => close()}>收起详情</button></header>{mainlineDetails}</div>}
        </section>

        <section className="content-section adventure-proto-goal-section">
          <header className="section-heading"><div><span className="section-context">阶段成果</span><h2><Sprout size={18} />正在生长的目标</h2></div><div className="quiet-filter" aria-label="目标视图">{(['all', 'focus'] as const).map(scope => <button key={scope} disabled={blocked} aria-pressed={data.goalScope === scope} onClick={() => { setOpenRecord(undefined); setDialog(undefined); model.clearGoal(); window.history.replaceState(null, '', '/adventure?view=planning'); void model.load({ goalScope: scope, page: 1 }) }}>{scope === 'all' ? '全部' : '聚焦'}</button>)}</div></header>
          {goals?.length === 0 ? <p className="adventure-empty">{data.totalGoals ? '本页没有目标，请返回上一页。' : '还没有目标。创建独立目标，或选择一条主线。'}</p> : <PrototypeGoals goals={goals ?? []} blocked={blocked} action={model.command} openGoal={openRecord?.startsWith('goal:') ? openRecord.slice(5) : undefined} toggleGoal={toggleGoal} detail={goal => goal.id === detailGoal?.id ? goalDetails : <p role="status">正在读取目标详情…</p>} />}
          {dialog?.kind === 'detail' && !goals?.some(goal => goal.id === dialog.id) && <div className="record adventure-proto-goal is-open planning-standalone-detail"><header><h3>{detailGoal?.title ?? '目标详情'}</h3><button onClick={() => close()}>收起详情</button></header>{goalDetails}</div>}
          {data.totalGoals > data.pageSize && <div className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div><button disabled={blocked || data.page <= 1} onClick={() => { void model.load({ page: data.page - 1 }) }}>上一页</button><button disabled={blocked || data.page * data.pageSize >= data.totalGoals} onClick={() => { void model.load({ page: data.page + 1 }) }}>下一页</button></div></div>}
        </section>
        </>}
    </div>}

    {dialog && !inlineDetail && data && <Modal title={title} close={close} restoreFocus={inlineOrigin.current}>
      {dialog.kind === 'taskHistory' ? <PlanningTaskHistory key={dialog.id} id={dialog.id} /> : dialog.kind === 'reschedule' ? <PlanningReschedule task={dialog.task} version={data.version} blocked={blocked} preview={async command => { const value = await model.preview(command); return value && 'operation' in value && value.operation === 'rescheduleTask' ? value : undefined }} action={model.command} close={close} />
      : dialog.kind === 'migrate' ? <PlanningMigration kind={dialog.entityKind} id={dialog.id} title={dialog.title} version={data.version} blocked={blocked} action={model.command} close={close} />
      : dialog.kind === 'achieve' ? <GoalAchievement preview={dialog.preview} version={data.version} blocked={blocked} action={model.command} repreview={async () => { const value = await model.preview({ type: 'achieveGoal', id: dialog.preview.goalId, coefficient: 1, reflection: '' }); return value && 'goalId' in value && value.operation === 'achieveGoal' ? value : undefined }} saved={() => setDialog({ kind: 'detail', id: dialog.preview.goalId })} cancel={close} />
      : dialog.kind === 'lifecycle' ? <PlanningLifecycle preview={dialog.preview} version={data.version} blocked={blocked} action={model.command} repreview={async () => { const value = await model.preview({ type: dialog.preview.operation, id: dialog.preview.entityId }); return value && 'stoppingTasks' in value && 'operation' in value && value.operation === dialog.preview.operation ? value : undefined }} saved={close} cancel={close} />
      : dialog.kind === 'task' ? <TaskForm key={dialog.task?.id ?? 'new-task'} task={dialog.task} destination={dialog.destination} data={data} action={model.command} busy={blocked} close={close} changeGoalPage={page => { void model.load({ page }) }} />
      : dialog.kind === 'cancel' ? <div className="planning-cancel-preview"><h3>{dialog.task.title}</h3><p>{dialog.preview.message}</p><dl><div><dt>当前</dt><dd>{dialog.preview.growthBefore.totalXp} 点经验，Lv.{dialog.preview.growthBefore.level}，{dialog.preview.growthBefore.actions} 次行动</dd></div><div><dt>取消后</dt><dd>{dialog.preview.growthAfter.totalXp} 点经验，Lv.{dialog.preview.growthAfter.level}，{dialog.preview.growthAfter.actions} 次行动</dd></div></dl><p>当前点亮的成就：{dialog.preview.growthBefore.achievements.filter(item => item.unlocked).map(item => item.label).join('、') || '暂无'}</p><p>取消后点亮的成就：{dialog.preview.growthAfter.achievements.filter(item => item.unlocked).map(item => item.label).join('、') || '暂无'}</p>{data.version !== dialog.preview.version && <p className="adventure-hint">数据已变化，请重新预览后确认。</p>}<div className="adventure-form-footer"><button disabled={blocked} onClick={() => { void cancelTask(dialog.task) }}>重新预览</button><button disabled={blocked || data.version !== dialog.preview.version} onClick={() => { void model.command({ type: 'cancelTaskCompletion', completionId: dialog.preview.completionId }, dialog.preview.version).then(saved => { if (saved) close() }) }}>确认取消完成</button></div></div>
      : <PlanningForm key={dialog.kind === 'mainline' ? dialog.id ?? 'new-mainline' : dialog.goal?.id ?? 'new-goal'} dialog={dialog} data={data} action={model.command} busy={blocked} close={close} />}
      {recovery && <div className="planning-recovery">{recovery}</div>}
    </Modal>}
  </div></AppLayout>
}

function ChevronMarker({ open }: { open: boolean }) { return <span className={open ? 'record-chevron is-open' : 'record-chevron'} aria-hidden="true">⌄</span> }

export function PlanningWorkspace() {
  const identity = useVerifiedIdentity()
  return <Workspace key={identity.ownerId} />
}
