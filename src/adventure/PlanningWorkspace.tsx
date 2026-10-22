import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Flag, Map, Plus, Sprout, Star, Trash2 } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningGoal, PlanningPage, PlanningTask, PlanningPreview, GoalAchievementPreview, LifecyclePreview } from '../shared/adventure-planning'
import { Modal } from './ui'
import { usePlanning } from './usePlanning'
import { PlanningTasks, TaskForm } from './PlanningTasks'
import { PlanningReschedule, PlanningTaskHistory } from './PlanningReschedule'
import { PlanningMigration } from './PlanningMigration'
import { GoalAchievement } from './GoalAchievement'
import { PlanningGoalDetail } from './PlanningGoalDetail'
import { PlanningGoals } from './PlanningGoals'
import { PlanningToast } from './PlanningToast'
import { PlanningLifecycle, lifecycleTitles } from './PlanningLifecycle'
import { saveTerminalPreference } from './planning-preferences'
import explorer from './pixel-explorer.png'
import './adventure.css'
import './planning.css'

type PlanningDialog = { kind: 'new' } | { kind: 'mainline'; id?: string; name?: string } | { kind: 'goal'; goal?: PlanningGoal } | { kind: 'detail'; id: string } | { kind: 'mainlineDetail'; id: string }
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
  const model = usePlanning()
  const { data, busy, uncertain } = model
  const identity = useVerifiedIdentity()
  const [dialog, setDialog] = useState<Dialog | undefined>(() => {
    const params = new URLSearchParams(window.location.search), goal = params.get('goalId'), main = params.get('mainlineId')
    const task = params.get('taskId')
    return task ? { kind: 'taskHistory', id: task } : goal ? { kind: 'detail', id: goal } : main ? { kind: 'mainlineDetail', id: main } : undefined
  })
  const [tab, setTab] = useState<'overview' | 'planning'>('overview')
  const [showTerminal, setShowTerminal] = useState(() => data?.includeTerminal ?? false)
  const [preferenceError, setPreferenceError] = useState('')
  useEffect(() => { if (data) setShowTerminal(data.includeTerminal) }, [data])
  const changeTerminal = async (value: boolean) => {
    setPreferenceError(saveTerminalPreference(identity.ownerId, value) ? '' : '终态显示偏好未保存；本页仍可查看，刷新后使用默认设置。')
    setShowTerminal(value)
    await model.load({ includeTerminal: value, page: 1, goalId: undefined, goalTaskPage: 1 })
  }
  const previewGeneration = useRef(0)
  const close = useCallback(() => {
    const mainlineWasOpen = new URLSearchParams(window.location.search).has('mainlineId')
    previewGeneration.current++; setDialog(undefined); model.clearGoal(); window.history.replaceState(null, '', '/adventure')
    if (mainlineWasOpen) void model.load()
  }, [model.clearGoal, model.load])
  const blocked = busy || uncertain || model.readRequired
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
    previewGeneration.current++
    setDialog({ kind: 'detail', id })
    window.history.replaceState(null, '', `/adventure?goalId=${id}`)
    void model.load({ goalId: id, mainlineId: undefined, goalTaskPage: 1, page: 1 })
  }
  const openMainline = (id: string) => {
    if (blocked) return
    previewGeneration.current++
    setDialog({ kind: 'mainlineDetail', id })
    window.history.replaceState(null, '', `/adventure?mainlineId=${id}`)
    void model.load({ mainlineId: id, goalId: undefined, page: 1 })
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
  const detailGoal = dialog?.kind === 'detail' ? (data?.goalDetail?.goal.id === dialog.id ? data.goalDetail.goal : data?.goals.find(item => item.id === dialog.id)) : undefined
  const title = !dialog ? '' : dialog.kind === 'new' ? '新建' : dialog.kind === 'detail' ? '目标详情' : dialog.kind === 'mainlineDetail' ? '主线历史'
    : dialog.kind === 'taskHistory' ? '任务安排历史' : dialog.kind === 'reschedule' ? '任务改期' : dialog.kind === 'migrate' ? dialog.entityKind === 'goal' ? '迁移目标' : '迁移任务' : dialog.kind === 'achieve' ? '确认目标达成' : dialog.kind === 'lifecycle' ? lifecycleTitles[dialog.preview.operation] : dialog.kind === 'task' ? dialog.task ? '编辑任务' : '创建任务' : dialog.kind === 'cancel' ? '取消任务完成'
    : dialog.kind === 'mainline' ? dialog.id ? '修改主线名称' : '创建主线' : dialog.goal ? '编辑目标' : '创建目标'
  const goals = data?.goals
  return <AppLayout page="adventure"><div className="adventure-page planning-page">
    <header className="adventure-heading">
      <div><span className="adventure-kicker">LIFESPACE / YOUR NEXT STEP</span><h1>人生冒险</h1><p>把想做的事，慢慢变成现实。</p></div>
      <div className="adventure-heading-actions">
        {model.lastAchievement && <button disabled={blocked} onClick={() => openGoal(model.lastAchievement!)}>查看达成结果</button>}
        <button className="adventure-primary" disabled={!data || blocked} onClick={() => setDialog({ kind: 'new' })}><Plus size={17} />新建</button>
      </div>
    </header>
    <nav className="adventure-tabs" aria-label="冒险页面"><div>
      <button aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}>冒险概览</button>
      <button aria-current={tab === 'planning' ? 'page' : undefined} onClick={() => setTab('planning')}>主线与目标</button>
      <button disabled title={data?.capabilities.growth?.reason ?? '此操作尚未交付'}>成长记录</button>
    </div><small>{data?.today}</small></nav>
    {(!dialog || !data) && recovery && <div className="planning-recovery">{recovery}</div>}
    {model.error ? <PlanningToast key={model.error} tone="error" withinDialog={!!dialog && !!data} message={model.error} close={model.clearError} />
      : !model.readRequired && model.notice && <PlanningToast key={model.notice.id} message={model.notice.message} close={model.clearNotice} />}
    {dialog && !data && !busy && <div className="planning-recovery"><button onClick={() => { close(); void model.load() }}>返回冒险</button></div>}
    {!data && busy && <p role="status" className="adventure-empty">正在读取你的冒险…</p>}
    {data && <div className="planning-workbench">
      <div className="planning-main">
        {tab === 'overview' && <section className="planning-hero">
          <div><span className="adventure-kicker">今天，继续向前</span><h2>把今天，走成<br />你想去的方向。</h2><p>先为在意的事，留下一个明确的目标。</p></div>
          <div className="planning-landscape"><img src={explorer} alt="背着行囊的像素冒险者" /></div>
        </section>}
        <section className="planning-section">
          <header><h2><Map size={19} />我的主线</h2><label className="planning-terminal-toggle"><input type="checkbox" checked={showTerminal} disabled={blocked} onChange={event => changeTerminal(event.target.checked)} />显示已达成／已结束</label></header>
          {preferenceError && <p role="status" className="adventure-hint">{preferenceError}</p>}
          {data.mainlines.length === 0 ? <p className="adventure-empty">还没有主线。为长期经营的方向起一个名字。</p> :
            <div className="planning-mainlines">{data.mainlines.map(mainline => <article key={mainline.id} aria-label={`主线：${mainline.name}`}>
              <Flag size={18} /><h3>{mainline.name}</h3><span className="planning-active">{mainline.status === 'ended' ? '已结束' : '在用'}</span>
              <button disabled={blocked} aria-label={`查看主线 ${mainline.name}`} onClick={() => openMainline(mainline.id)}>查看历史</button>
              <button disabled={blocked || mainline.status !== 'active' || !mainline.capabilities.rename?.allowed} aria-label={`修改主线 ${mainline.name}`} onClick={() => setDialog({ kind: 'mainline', id: mainline.id, name: mainline.name })}>改名</button>
              <button disabled={blocked || !mainline.capabilities.end?.allowed} title={mainline.capabilities.end?.reason} onClick={() => { void openLifecycle('endMainline', mainline.id) }}>结束</button>
            </article>)}</div>}
          {!data.capabilities.createMainline?.allowed && <p className="adventure-hint">{data.capabilities.createMainline?.reason}</p>}
        </section>
        <section className="planning-section">
          <header><div><h2><Sprout size={20} />正在生长的目标</h2><p className="adventure-hint">以完成标准定义成果，每个目标都可以从零开始。</p></div></header>
          {goals?.length === 0 ? <p className="adventure-empty">{data.totalGoals ? '本页没有目标，请返回上一页。' : '还没有目标。创建独立目标，或选择一条主线。'}</p> :
            <PlanningGoals goals={goals ?? []} blocked={blocked} action={model.command} detail={goal => openGoal(goal.id)} />}
          <footer className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div>
            <button disabled={blocked || data.page <= 1} onClick={() => { void model.load({ page: data.page - 1 }) }}>上一页</button>
            <button disabled={blocked || data.page * data.pageSize >= data.totalGoals} onClick={() => { void model.load({ page: data.page + 1 }) }}>下一页</button>
          </div></footer>
        </section>
        {data.capabilities.createTask?.allowed ? <PlanningTasks data={data} blocked={blocked}
          changeScope={scope => { void model.load({ taskScope: scope, taskPage: 1 }) }}
          changeSearch={search => { void model.load({ search, taskPage: 1 }) }}
          changeRange={range => { void model.load({ taskRange: range, taskPage: 1 }) }} changePage={page => { void model.load({ taskPage: page }) }}
          reschedule={task => setDialog({ kind: 'reschedule', task })}
          openGoal={openGoal} migrate={task => setDialog({ kind: 'migrate', entityKind: 'task', id: task.id, title: task.title })} edit={task => setDialog({ kind: 'task', task })}
          complete={task => { void model.command({ type: 'completeTask', id: task.id }) }} cancel={task => { void cancelTask(task) }}
          end={task => { void openLifecycle('endTask', task.id) }}
          remove={task => { void openLifecycle('deleteTask', task.id) }} />
          : <section className="planning-section planning-locked"><header><h2>一次性任务</h2></header><p className="adventure-hint">{data.capabilities.createTask?.reason}</p></section>}
      </div>
      <aside className="planning-sidebar">
        <section className="planning-section"><h2>每一步，都算数</h2><div className="planning-level"><strong>Lv.{data.growth.level}</strong><p>正在成为更好的自己<br /><small>距下一级 {data.growth.remaining} 点经验</small></p></div>
          <div className="adventure-exp-label"><span>本级经验</span><span>{data.growth.progress} / {data.growth.needed}</span></div>
          <progress aria-label="当前等级经验进度" max={data.growth.needed} value={data.growth.progress} />
          <dl><div><dd>{data.growth.totalXp}</dd><dt>累计经验</dt></div><div><dd>{data.growth.actions}</dd><dt>真实行动</dt></div><div><dd>{data.growth.achievedGoals}</dd><dt>达成目标</dt></div></dl>
        </section>
        <section className="planning-section planning-locked"><h3><Star size={16} />一点点，成为里程碑</h3><p className="adventure-hint">成长记录尚未开放</p></section>
        <blockquote>重要的不是走得多快，<br />是你开始走了。</blockquote>
      </aside>
    </div>}
    {dialog && data && <Modal title={title} close={close}>
      {dialog.kind === 'new' ? <div className="planning-create-options">
        <button disabled={blocked || !data.capabilities.createMainline?.allowed} title={data.capabilities.createMainline?.reason} onClick={() => setDialog({ kind: 'mainline' })}><Flag size={20} /><strong>主线</strong><small>一个长期经营的方向</small></button>
        <button disabled={blocked || !data.capabilities.createGoal?.allowed} onClick={() => setDialog({ kind: 'goal' })}><Sprout size={20} /><strong>目标</strong><small>一个有明确标准的阶段成果</small></button>
        <button disabled={blocked || !data.capabilities.createTask?.allowed} title={data.capabilities.createTask?.reason} onClick={() => setDialog({ kind: 'task' })}><Plus size={20} /><strong>一次性任务</strong><small>安排一项完整行动</small></button>
      </div> : dialog.kind === 'mainlineDetail' ? <div className="planning-detail">
        {data.mainlineDetail?.id === dialog.id ? <>
          <h3>{data.mainlineDetail.name}</h3><p>{data.mainlineDetail.status === 'ended' ? '已结束 · 只读' : '在用'}</p>
          {data.mainlineDetail.endedAt && <p>结束时间：{new Date(data.mainlineDetail.endedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
          <p><a href={`/adventure?mainlineId=${dialog.id}`}>主线永久链接</a></p>
          <ul>{data.goals.map(goal => <li key={goal.id}><button disabled={blocked} onClick={() => openGoal(goal.id)}>{goal.title} · {goal.status === 'achieved' ? '已达成' : goal.status === 'ended' ? '已结束' : '进行中'}</button></li>)}</ul>
          <div className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div>
            <button disabled={blocked || data.page <= 1} onClick={() => { void model.load({ page: data.page - 1 }) }}>上一页主线历史</button>
            <button disabled={blocked || data.page * data.pageSize >= data.totalGoals} onClick={() => { void model.load({ page: data.page + 1 }) }}>下一页主线历史</button>
          </div></div>
        </> : <p>{busy ? '正在读取主线历史…' : '暂时无法读取主线历史，请重新读取。'}</p>}
      </div> : dialog.kind === 'taskHistory' ? <PlanningTaskHistory key={dialog.id} id={dialog.id} /> : dialog.kind === 'reschedule' ? <PlanningReschedule task={dialog.task} version={data.version} blocked={blocked}
        preview={async command => { const value = await model.preview(command); return value && 'operation' in value && value.operation === 'rescheduleTask' ? value : undefined }}
        action={model.command} close={close} /> : dialog.kind === 'migrate' ? <PlanningMigration kind={dialog.entityKind} id={dialog.id} title={dialog.title} version={data.version} blocked={blocked} action={model.command} close={close} /> : dialog.kind === 'achieve' ? <GoalAchievement preview={dialog.preview} version={data.version} blocked={blocked} action={model.command}
        repreview={async () => { const value = await model.preview({ type: 'achieveGoal', id: dialog.preview.goalId, coefficient: 1, reflection: '' }); return value && 'goalId' in value && value.operation === 'achieveGoal' ? value : undefined }}
        saved={() => setDialog({ kind: 'detail', id: dialog.preview.goalId })} cancel={close} />
      : dialog.kind === 'lifecycle' ? <PlanningLifecycle preview={dialog.preview} version={data.version} blocked={blocked} action={model.command}
        repreview={async () => { const value = await model.preview({ type: dialog.preview.operation, id: dialog.preview.entityId }); return value && 'stoppingTasks' in value && 'operation' in value && value.operation === dialog.preview.operation ? value : undefined }}
        saved={close} cancel={close} />
      : dialog.kind === 'task' ? <TaskForm key={dialog.task?.id ?? 'new-task'} task={dialog.task} destination={dialog.destination} data={data} action={model.command} busy={blocked} close={close} changeGoalPage={page => { void model.load({ page }) }} />
      : dialog.kind === 'cancel' ? <div className="planning-cancel-preview">
        <h3>{dialog.task.title}</h3><p>{dialog.preview.message}</p>
        <dl><div><dt>当前</dt><dd>{dialog.preview.growthBefore.totalXp} 点经验 · Lv.{dialog.preview.growthBefore.level} · {dialog.preview.growthBefore.actions} 次行动</dd></div>
          <div><dt>取消后</dt><dd>{dialog.preview.growthAfter.totalXp} 点经验 · Lv.{dialog.preview.growthAfter.level} · {dialog.preview.growthAfter.actions} 次行动</dd></div></dl>
        <p>当前点亮的成就：{dialog.preview.growthBefore.achievements.filter(item => item.unlocked).map(item => item.label).join('、') || '暂无'}</p>
        <p>取消后点亮的成就：{dialog.preview.growthAfter.achievements.filter(item => item.unlocked).map(item => item.label).join('、') || '暂无'}</p>
        {data.version !== dialog.preview.version && <p className="adventure-hint">数据已变化，请重新预览后确认。</p>}
        <div className="adventure-form-footer"><button disabled={blocked} onClick={() => { void cancelTask(dialog.task) }}>重新预览</button>
          <button disabled={blocked || data.version !== dialog.preview.version} onClick={() => {
            void model.command({ type: 'cancelTaskCompletion', completionId: dialog.preview.completionId }, dialog.preview.version).then(saved => { if (saved) close() })
          }}>确认取消完成</button></div>
      </div> : dialog.kind === 'detail' ? detailGoal ? <PlanningGoalDetail goal={detailGoal} history={data.goalDetail?.goal.id === detailGoal.id ? data.goalDetail : null} pageSize={data.pageSize} blocked={blocked}
          migrate={() => setDialog({ kind: 'migrate', entityKind: 'goal', id: detailGoal.id, title: detailGoal.title })} edit={() => setDialog({ kind: 'goal', goal: detailGoal })} addTask={() => setDialog({ kind: 'task', destination: detailGoal.id })}
          focus={() => { void model.command({ type: 'focusGoal', id: detailGoal.id, focused: !detailGoal.focused }) }} achieve={() => { void achieveGoal(detailGoal.id) }} end={() => { void openLifecycle('endGoal', detailGoal.id) }}
          changePage={page => { void model.load({ goalTaskPage: page }) }} /> : <p>{busy ? '正在读取目标详情…' : '暂时无法读取目标详情，请重新读取。'}</p>
        : <PlanningForm key={dialog.kind === 'mainline' ? dialog.id ?? 'new-mainline' : dialog.goal?.id ?? 'new-goal'} dialog={dialog} data={data} action={model.command} busy={blocked} close={close} />}
      {recovery && <div className="planning-recovery">{recovery}</div>}
    </Modal>}
  </div></AppLayout>
}

export function PlanningWorkspace() {
  const identity = useVerifiedIdentity()
  return <Workspace key={identity.ownerId} />
}
