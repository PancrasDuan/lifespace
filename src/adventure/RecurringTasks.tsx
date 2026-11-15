import { Check, Pencil, Plus, Repeat2 } from 'lucide-react'
import { Temporal } from '@js-temporal/polyfill'
import type { RecurringList, RecurringParent } from '../shared/adventure-recurring'
import { Progress } from './PrototypeRecord'

export const periodLabels = { week: '每周', month: '每月', quarter: '每季', year: '每年' }
export const recurringDate = (value: string) => { const day = Temporal.PlainDate.from(value); return `${day.month}月${day.day}日` }
export const recurringTime = (value: string) => Temporal.Instant.from(value).toZonedDateTimeISO('Asia/Shanghai').toPlainTime().toString({ smallestUnit: 'minute' })
export type RecurringView = { type: 'create' } | { type: 'parent' | 'edit' | 'end' | 'delete'; id: string } | { type: 'child'; id: string; parentId: string }

export function RecurringTasks({ list, blocked, open, record, changePage }: {
  list: RecurringList; blocked: boolean; open: (view: RecurringView) => void;
  record: (parent: RecurringParent) => void; changePage: (page: number) => void
}) {
  const groups = [ ['active', '周期任务'], ['not_started', '当天开始的周期任务'], ['ended', '当天结束的周期任务'] ] as const
  return <>{groups.map(([status, label]) => {
    const parents = list.parents.filter(parent => parent.status === status)
    if (!parents.length) return null
    return <section key={status} className="recurring-section" aria-label={label}>
      <div className="recurring-cycle-heading"><h3><Repeat2 size={15} aria-hidden="true"/>{label} <span>{list.total > list.pageSize ? `本页 ${parents.length}` : parents.length}</span></h3></div>
      {parents.map(parent => <article key={parent.id} className={`recurring-row${status === 'active' ? '' : ' recurring-lifecycle-row'}`}>
        <Repeat2 size={18} aria-hidden="true"/><div className="recurring-copy"><button type="button" disabled={blocked} onClick={() => open({ type: 'parent', id: parent.id })}>{parent.title}</button>
          <small>{parent.goalTitle ?? '独立任务'} · {periodLabels[parent.periodType]} {parent.requiredCount} 次</small>
          <small>{status === 'active' && parent.currentPeriod ? `第 ${parent.currentPeriod.number} 期 · ${recurringDate(parent.currentPeriod.startOn)} — ${recurringDate(parent.currentPeriod.endOn)} · 已完成 ${parent.completedPeriods} 期`
            : status === 'ended' && parent.endedOn ? `结束于 ${recurringDate(parent.endedOn)} · 只读保留` : `开始日 ${recurringDate(parent.startOn)} · 未开始`}</small>
        </div>
        {status === 'active' && parent.currentPeriod ? <><div className="recurring-progress"><strong>{parent.currentPeriod.completed} <span>/ {parent.currentPeriod.required}</span></strong><Progress value={parent.currentPeriod.ratio} label={`${parent.title}本期进度`}/></div>
          <button type="button" className={parent.currentPeriod.satisfied ? 'recurring-complete-button' : 'adventure-primary'} disabled={blocked || !parent.capabilities.recordRecurringCompletion.allowed} title={parent.capabilities.recordRecurringCompletion.reason} onClick={() => record(parent)}>{parent.currentPeriod.satisfied ? <><Check size={14} aria-hidden="true"/>本期已完成</> : <><Plus size={14} aria-hidden="true"/>记录一次</>}</button></>
          : <div className="recurring-lifecycle-actions">{status === 'ended' ? <button type="button" disabled={blocked} onClick={() => open({ type: 'parent', id: parent.id })}>查看明细</button> : <>
            <button type="button" disabled={blocked || !parent.capabilities.editRecurringTask.allowed} title={parent.capabilities.editRecurringTask.reason} onClick={() => open({ type: 'edit', id: parent.id })}><Pencil size={13} aria-hidden="true"/>编辑</button>
            <button type="button" className="recurring-danger" disabled={blocked || !parent.capabilities.deleteRecurringTask.allowed} title={parent.capabilities.deleteRecurringTask.reason} onClick={() => open({ type: 'delete', id: parent.id })}>删除</button></>}</div>}
      </article>)}
    </section>
  })}{(list.total > list.pageSize || list.page > 1) && <footer className="planning-pagination"><small>周期任务共 {list.total} 项 · 第 {list.page} 页</small><div>
    <button type="button" disabled={blocked || list.page <= 1} onClick={() => changePage(list.page - 1)}>上一页周期任务</button>
    <button type="button" disabled={blocked || list.page * list.pageSize >= list.total} onClick={() => changePage(list.page + 1)}>下一页周期任务</button>
  </div></footer>}</>
}
