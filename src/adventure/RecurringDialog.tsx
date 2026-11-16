import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, GitBranch, ListTodo, Pencil, Repeat2, X } from 'lucide-react'
import type { PlanningCommand, PlanningPage } from '../shared/adventure-planning'
import type { RecurringChild, RecurringParent } from '../shared/adventure-recurring'
import type { PlanningConfirmation } from './usePlanning'
import { planningApi } from './planning-api'
import { useRecurringRead } from './useRecurringRead'
import { recurringDate, recurringTime, periodLabels, type RecurringView } from './RecurringTasks'
import { RecurringTaskForm } from './RecurringTaskForm'

export function RecurringDialog({ view, workspace, blocked, readBlocked = blocked, action, confirmation, change, close, reload, recovery }: {
  view: RecurringView; workspace: PlanningPage; blocked: boolean; readBlocked?: boolean;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>; confirmation: PlanningConfirmation;
  change: (view: RecurringView) => void; close: () => void; reload: () => Promise<unknown>; recovery: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const title = view.type === 'create' ? '新建行动' : view.type === 'edit' ? '编辑任务' : view.type === 'child' ? '子任务详情'
    : view.type === 'end' ? '结束周期任务' : view.type === 'delete' ? '删除未开始任务' : '任务详情'
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[data-initial-focus]')?.setAttribute('autofocus', '')
    dialog.current?.showModal()
    return () => { dialog.current?.close() }
  }, [])
  // Switching between parent, child and confirmations keeps one top-layer dialog.
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus() }, [view])
  return createPortal(<dialog ref={dialog} className="recurring-dialog adventure-dialog" aria-labelledby={heading} onClose={close}>
    <header><h2 id={heading}>{title}</h2><button type="button" aria-label="关闭弹窗" onClick={close}><X size={20} aria-hidden="true"/></button></header>
    <div className="recurring-dialog-content">
      {view.type === 'create' ? <RecurringTaskForm workspace={workspace} blocked={blocked} action={action} close={close}/>
        : <RecurringDetail key={`${view.type}:${view.id}`} view={view} workspace={workspace} blocked={blocked} readBlocked={readBlocked} action={action} confirmation={confirmation} change={change} close={close} reload={reload}/>}
      {recovery && <div className="planning-recovery">{recovery}</div>}
    </div>
  </dialog>, document.body)
}

function RecurringDetail({ view, workspace, blocked, readBlocked, action, confirmation, change, close, reload }: {
  view: Exclude<RecurringView, { type: 'create' }>; workspace: PlanningPage; blocked: boolean; readBlocked: boolean;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>; confirmation: PlanningConfirmation;
  change: (view: RecurringView) => void; close: () => void; reload: () => Promise<unknown>
}) {
  const [page, setPage] = useState(1)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const parentId = view.type === 'child' ? view.parentId : view.id
  const read = useCallback(async (owner: string, signal: AbortSignal) => {
    const basis = { expectedVersion: workspace.version, today: workspace.today }
    if (view.type === 'child') {
      const [result, currentParent] = await Promise.all([
        planningApi.recurringChild(owner, { ...basis, id: view.id }, signal),
        planningApi.recurringParent(owner, { ...basis, id: parentId }, signal),
      ])
      if (result.child.id !== view.id || result.child.parentId !== parentId || currentParent.parent.id !== parentId) throw new Error('子任务数据不匹配，请重新读取。')
      return { child: result.child, parent: currentParent.parent }
    }
    const [detail, children] = await Promise.all([
      planningApi.recurringParent(owner, { ...basis, id: parentId }, signal),
      planningApi.recurringChildren(owner, { ...basis, parentId, page }, signal),
    ])
    if (detail.parent.id !== parentId || children.parentId !== parentId || children.page !== page || children.total !== detail.parent.effectiveChildren) throw new Error('关联任务数据已变化，请重新读取。')
    return { parent: detail.parent, children }
  }, [workspace.version, workspace.today, view.type, view.id, parentId, page])
  const state = useRecurringRead(workspace, `${view.type}:${view.id}:${page}`, read)
  const parent = state.value?.parent
  const child = state.value?.child
  const { refresh } = confirmation
  useEffect(() => {
    if (view.type === 'end' || view.type === 'delete') void refresh({ type: view.type === 'end' ? 'endRecurringTask' : 'deleteRecurringTask', id: parentId, today: workspace.today })
  }, [view.type, parentId, workspace.today, workspace.version, refresh])
  const record = async (parent: RecurringParent) => {
    if (await action({ type: 'recordRecurringCompletion', id: parent.id, today: workspace.today }, workspace.version) && mounted.current) close()
  }
  const cancel = async (child: RecurringChild) => {
    if (await action({ type: 'cancelRecurringCompletion', completionId: child.completionId, today: workspace.today }, workspace.version) && mounted.current) change({ type: 'parent', id: child.parentId })
  }
  if (state.error) return <div role="alert" className="planning-recovery"><p>{state.error}</p><button type="button" disabled={readBlocked} onClick={() => { void reload().then(state.retry) }}>重新读取详情</button></div>
  if (!state.value) return <p role="status">正在读取任务详情…</p>
  if (view.type === 'edit' && parent) return <RecurringTaskForm parent={parent} workspace={workspace} blocked={blocked} action={action} close={close}/>
  if ((view.type === 'end' || view.type === 'delete') && parent) {
    const command = { type: view.type === 'end' ? 'endRecurringTask' : 'deleteRecurringTask', id: parent.id, today: workspace.today } as const
    const preview = confirmation.preview
    const ready = preview && 'entityId' in preview && preview.operation === command.type && preview.entityId === parent.id && !confirmation.stale
    const capability = view.type === 'end' ? parent.capabilities.endRecurringTask : parent.capabilities.deleteRecurringTask
    return <><h3>{parent.title}</h3><p className="recurring-confirm-copy">{view.type === 'end' ? '结束后不可恢复，已有记录保留。' : '删除此任务？'}</p>
      {view.type === 'end' && parent.currentPeriod && <p className="recurring-hint">本期 {parent.currentPeriod.completed}/{parent.currentPeriod.required} · 已完成 {parent.completedPeriods} 期</p>}
      {!ready && !blocked && <button type="button" onClick={() => { void refresh(command) }}>重新预览</button>}
      <div className="adventure-form-footer"><button type="button" autoFocus data-initial-focus="" onClick={close}>取消</button><button type="button" className="recurring-danger" disabled={blocked || !ready || !capability.allowed} title={capability.reason} onClick={() => { void confirmation.confirm(command, close) }}>{view.type === 'end' ? '确认结束' : '确认删除'}</button></div></>
  }
  if (child) {
    const snapshot = child.snapshot
    return <div className="recurring-detail recurring-child-detail">
      <button type="button" className="recurring-parent-link" autoFocus data-initial-focus="" onClick={() => change({ type: 'parent', id: child.parentId })}><ChevronLeft size={16} aria-hidden="true"/><span>父任务 · {parent?.title ?? snapshot.title}</span></button>
      <div className="recurring-detail-title"><span className="recurring-kind"><ListTodo size={14} aria-hidden="true"/>周期子任务</span><span className="recurring-status">{child.status === 'completed' ? '已完成' : '已撤销'}</span></div>
      <h3>{snapshot.title}</h3>{snapshot.description && <p>{snapshot.description}</p>}
      <dl className="recurring-facts"><div><dt>完成时归属</dt><dd>{snapshot.goalTitle ?? '独立任务'}</dd></div><div><dt>完成时间</dt><dd><time dateTime={snapshot.occurredAt}>{recurringDate(snapshot.occurredOn)} {recurringTime(snapshot.occurredAt)}</time></dd></div><div><dt>所属周期</dt><dd>第 {snapshot.periodNumber} 期</dd></div><div><dt>每期要求</dt><dd>{periodLabels[snapshot.periodType]} {snapshot.requiredCount} 次</dd></div></dl>
      {child.capabilities.cancelRecurringCompletion.allowed ? <div className="recurring-detail-actions"><button type="button" disabled={blocked} onClick={() => { void cancel(child) }}>撤销本次完成</button></div> : child.capabilities.cancelRecurringCompletion.reason && <p className="recurring-hint">{child.capabilities.cancelRecurringCompletion.reason}</p>}
    </div>
  }
  if (!parent || !state.value.children) return null
  const children = state.value.children
  const period = parent.currentPeriod
  return <div className="recurring-detail">
    <div className="recurring-detail-title"><span className="recurring-kind"><Repeat2 size={14} aria-hidden="true"/>周期任务</span><span className="recurring-status">{parent.status === 'active' ? '进行中' : parent.status === 'ended' ? '已结束' : '未开始'}</span></div>
    <h3>{parent.title}</h3>{parent.description && <p>{parent.description}</p>}
    <dl className="recurring-facts"><div><dt>当前归属</dt><dd>{parent.goalTitle ?? '独立任务'}</dd></div><div><dt>开始日期</dt><dd>{recurringDate(parent.startOn)}</dd></div>{parent.endedOn && <div><dt>结束日期</dt><dd>{recurringDate(parent.endedOn)}</dd></div>}
      <div><dt>周期规则</dt><dd>{periodLabels[parent.periodType]} {parent.requiredCount} 次</dd></div><div><dt>本期</dt><dd>{period ? `第 ${period.number} 期 · ${recurringDate(period.startOn)} — ${recurringDate(period.endOn)}` : '尚未开始'}</dd></div><div><dt>本期进度</dt><dd>{period ? `${period.completed} / ${period.required}` : '—'}</dd></div><div><dt>完成周期数</dt><dd>{parent.completedPeriods} 期</dd></div>
    </dl>
    <div className="recurring-detail-actions">{parent.capabilities.editRecurringTask.allowed && <button type="button" disabled={blocked} onClick={() => change({ type: 'edit', id: parent.id })}><Pencil size={14} aria-hidden="true"/>编辑任务</button>}
      {parent.status === 'active' && <button type="button" className="adventure-primary" disabled={blocked || !parent.capabilities.recordRecurringCompletion.allowed} title={parent.capabilities.recordRecurringCompletion.reason} onClick={() => { void record(parent) }}>记录一次</button>}
      {parent.capabilities.endRecurringTask.allowed && <button type="button" className="recurring-danger" disabled={blocked} onClick={() => change({ type: 'end', id: parent.id })}>结束任务</button>}
      {parent.capabilities.deleteRecurringTask.allowed && <button type="button" className="recurring-danger" disabled={blocked} onClick={() => change({ type: 'delete', id: parent.id })}>删除任务</button>}
    </div>
    <section className="recurring-relations" aria-label="关联子任务"><h4><GitBranch size={16} aria-hidden="true"/>关联子任务 <span>{children.total} 项</span></h4>
      {children.total === 0 ? <p className="recurring-hint">暂无关联子任务</p> : <ul role="list">{children.children.map(child => <li key={child.id}><button type="button" className="recurring-child-link" disabled={readBlocked} onClick={() => change({ type: 'child', id: child.id, parentId: parent.id })} aria-label={`查看子任务 ${child.snapshot.title}，${recurringDate(child.snapshot.occurredOn)} ${recurringTime(child.snapshot.occurredAt)}，第 ${child.snapshot.periodNumber} 期`}>
        <ListTodo size={16} aria-hidden="true"/><span className="recurring-child-copy"><strong>{child.snapshot.title}</strong><small>{recurringDate(child.snapshot.occurredOn)} {recurringTime(child.snapshot.occurredAt)} · 第 {child.snapshot.periodNumber} 期</small></span><span className="recurring-child-status">已完成</span><ChevronRight size={16} aria-hidden="true"/>
      </button></li>)}</ul>}
      {(children.total > children.pageSize || children.page > 1) && <footer className="planning-pagination"><small>第 {children.page} 页</small><div><button type="button" disabled={readBlocked || page <= 1} onClick={() => setPage(value => value - 1)}>上一页子任务</button><button type="button" disabled={readBlocked || page * children.pageSize >= children.total} onClick={() => setPage(value => value + 1)}>下一页子任务</button></div></footer>}
    </section>
  </div>
}
