import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Flag, Map, Plus, Sprout, Star, Trash2 } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningCommand, PlanningGoal, PlanningPage, PlanningTask, PlanningPreview } from '../shared/adventure-planning'
import { Modal } from './ui'
import { usePlanning } from './usePlanning'
import { PlanningTasks, TaskForm } from './PlanningTasks'
import { PlanningToast } from './PlanningToast'
import explorer from './pixel-explorer.png'
import './adventure.css'
import './planning.css'

type PlanningDialog = { kind: 'new' } | { kind: 'mainline'; id?: string; name?: string } | { kind: 'goal'; goal?: PlanningGoal } | { kind: 'detail'; goal: PlanningGoal }
type Dialog = PlanningDialog | { kind: 'task'; task?: PlanningTask; destination?: string } | { kind: 'cancel'; task: PlanningTask; preview: Extract<PlanningPreview, { requiresConfirmation: true }> }
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
  const [dialog, setDialog] = useState<Dialog>()
  const [tab, setTab] = useState<'overview' | 'planning'>('overview')
  const previewGeneration = useRef(0)
  const close = useCallback(() => { previewGeneration.current++; setDialog(undefined) }, [])
  const blocked = busy || uncertain || model.readRequired
  const recovery = (uncertain || model.readRequired) && !busy ? <button type="button" onClick={() => {
    if (uncertain) void model.retry().then(saved => { if (saved) close() })
    else void model.load()
  }}>{uncertain ? '安全重试同一次操作' : '重新读取'}</button> : null
  const cancelTask = async (task: PlanningTask) => {
    if (!task.completionId) return
    const generation = previewGeneration.current
    const preview = await model.preview({ type: 'cancelTaskCompletion', completionId: task.completionId })
    if (generation === previewGeneration.current && preview?.requiresConfirmation) setDialog({ kind: 'cancel', task, preview })
  }
  const detailGoal = dialog?.kind === 'detail' ? data?.goals.find(item => item.id === dialog.goal.id) : undefined
  const title = !dialog ? '' : dialog.kind === 'new' ? '新建' : dialog.kind === 'detail' ? '目标详情'
    : dialog.kind === 'task' ? dialog.task ? '编辑任务' : '创建任务' : dialog.kind === 'cancel' ? '取消任务完成'
    : dialog.kind === 'mainline' ? dialog.id ? '修改主线名称' : '创建主线' : dialog.goal ? '编辑目标' : '创建目标'
  const goals = data?.goals
  return <AppLayout page="adventure"><div className="adventure-page planning-page">
    <header className="adventure-heading">
      <div><span className="adventure-kicker">LIFESPACE / YOUR NEXT STEP</span><h1>人生冒险</h1><p>把想做的事，慢慢变成现实。</p></div>
      <div className="adventure-heading-actions">
        <button className="adventure-primary" disabled={!data || blocked} onClick={() => setDialog({ kind: 'new' })}><Plus size={17} />新建</button>
      </div>
    </header>
    <nav className="adventure-tabs" aria-label="冒险页面"><div>
      <button aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}>冒险概览</button>
      <button aria-current={tab === 'planning' ? 'page' : undefined} onClick={() => setTab('planning')}>主线与目标</button>
      <button disabled title={data?.capabilities.growth?.reason ?? '此操作尚未交付'}>成长记录</button>
    </div><small>{data?.today}</small></nav>
    {!dialog && recovery && <div className="planning-recovery">{recovery}</div>}
    {model.error ? <PlanningToast key={model.error} tone="error" withinDialog={!!dialog && !!data} message={model.error} close={model.clearError} />
      : !model.readRequired && model.notice && <PlanningToast key={model.notice.id} message={model.notice.message} close={model.clearNotice} />}
    {!data && busy && <p role="status" className="adventure-empty">正在读取你的冒险…</p>}
    {data && <div className="planning-workbench">
      <div className="planning-main">
        {tab === 'overview' && <section className="planning-hero">
          <div><span className="adventure-kicker">今天，继续向前</span><h2>把今天，走成<br />你想去的方向。</h2><p>先为在意的事，留下一个明确的目标。</p></div>
          <div className="planning-landscape"><img src={explorer} alt="背着行囊的像素冒险者" /></div>
        </section>}
        <section className="planning-section">
          <header><h2><Map size={19} />我的主线</h2></header>
          {data.mainlines.length === 0 ? <p className="adventure-empty">还没有主线。为长期经营的方向起一个名字。</p> :
            <div className="planning-mainlines">{data.mainlines.map(mainline => <article key={mainline.id} aria-label={`主线：${mainline.name}`}>
              <Flag size={18} /><h3>{mainline.name}</h3><span className="planning-active">在用</span>
              <button disabled={blocked || !mainline.capabilities.rename?.allowed} aria-label={`修改主线 ${mainline.name}`} onClick={() => setDialog({ kind: 'mainline', id: mainline.id, name: mainline.name })}>改名</button>
              <button disabled title={mainline.capabilities.end?.reason}>结束</button>
            </article>)}</div>}
          {!data.capabilities.createMainline?.allowed && <p className="adventure-hint">{data.capabilities.createMainline?.reason}</p>}
        </section>
        <section className="planning-section">
          <header><div><h2><Sprout size={20} />正在生长的目标</h2><p className="adventure-hint">以完成标准定义成果，每个目标都可以从零开始。</p></div></header>
          {goals?.length === 0 ? <p className="adventure-empty">{data.totalGoals ? '本页没有目标，请返回上一页。' : '还没有目标。创建独立目标，或选择一条主线。'}</p> :
            <div className="planning-goals">{goals?.map(goal => <article className="planning-goal" key={goal.id} role="button" tabIndex={0}
              aria-label={`目标：${goal.title}`} onClick={() => setDialog({ kind: 'detail', goal })}
              onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !event.nativeEvent.isComposing) { event.preventDefault(); setDialog({ kind: 'detail', goal }) } }}>
              <span className="planning-destination">{goal.independent ? '独立目标' : goal.mainlineName}</span>
              <h3>{goal.title}</h3><ul>{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul>
              <footer><span>进行中</span><span aria-hidden="true">查看详情 ›</span></footer>
            </article>)}</div>}
          <footer className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div>
            <button disabled={blocked || data.page <= 1} onClick={() => { void model.load(data.page - 1) }}>上一页</button>
            <button disabled={blocked || data.page * data.pageSize >= data.totalGoals} onClick={() => { void model.load(data.page + 1) }}>下一页</button>
          </div></footer>
        </section>
        {data.capabilities.createTask?.allowed ? <PlanningTasks data={data} blocked={blocked}
          changeRange={range => { void model.load(data.page, range, 1) }} changePage={page => { void model.load(data.page, data.taskRange, page) }}
          edit={task => setDialog({ kind: 'task', task })} complete={task => { void model.command({ type: 'completeTask', id: task.id }) }} cancel={task => { void cancelTask(task) }} />
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
      </div> : dialog.kind === 'task' ? <TaskForm key={dialog.task?.id ?? 'new-task'} task={dialog.task} destination={dialog.destination} data={data} action={model.command} busy={blocked} close={close} changeGoalPage={page => { void model.load(page) }} />
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
      </div> : dialog.kind === 'detail' ? detailGoal ? <div className="planning-detail">
        <span className="planning-destination">{detailGoal.independent ? '独立目标' : detailGoal.mainlineName}</span><h3>{detailGoal.title}</h3>
        <h4>完成标准</h4><ul>{detailGoal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul><p className="adventure-hint">创建时间：{new Date(detailGoal.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
        <div className="adventure-inline">
          <button disabled={blocked || !detailGoal.capabilities.edit?.allowed} onClick={() => setDialog({ kind: 'goal', goal: detailGoal })}>编辑目标</button>
          <button disabled={blocked || !detailGoal.capabilities.createTask?.allowed} title={detailGoal.capabilities.createTask?.reason} onClick={() => setDialog({ kind: 'task', destination: detailGoal.id })}>添加任务</button>
          {(['focus', 'migrate', 'achieve', 'end'] as const).map((operation, i) => <button key={operation} disabled title={detailGoal.capabilities[operation]?.reason}>{['聚焦', '迁移', '确认达成', '结束'][i]}</button>)}
        </div>
      </div> : <p>目标已更新，请关闭后重新读取。</p>
        : <PlanningForm key={dialog.kind === 'mainline' ? dialog.id ?? 'new-mainline' : dialog.goal?.id ?? 'new-goal'} dialog={dialog} data={data} action={model.command} busy={blocked} close={close} />}
      {recovery && <div className="planning-recovery">{recovery}</div>}
    </Modal>}
  </div></AppLayout>
}

export function PlanningWorkspace() {
  const identity = useVerifiedIdentity()
  return <Workspace key={identity.ownerId} />
}
