import { useEffect, useRef, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import { planningApi } from './planning-api'
import type { PlanningCommand, PlanningTask, ReschedulePreview, TaskHistory } from '../shared/adventure-planning'

function ArrangementItems({ items }: { items: TaskHistory['items'] }) {
  return <ol>{items.map(item => <li key={item.id}>
    {item.kind === 'task_created' ? `最初安排：${item.newPlannedOn}` : `${item.oldPlannedOn} → ${item.newPlannedOn}`}
    <p>{item.title} · {item.description || '无说明'} · {item.mainlineName}{item.goalTitle ? ` / ${item.goalTitle}` : ' / 独立任务'}</p>
    <small>{new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small>
  </li>)}</ol>
}

export function PlanningArrangements({ task }: { task: PlanningTask }) {
  if (!task.arrangements?.length) return null
  return <details className="planning-arrangements"><summary>原安排链（{task.totalArrangements}）</summary>
    <ol>{task.arrangements.map(item => <li key={item.id}>{item.kind === 'task_created' ? `最初安排：${item.newPlannedOn}` : `${item.oldPlannedOn} → ${item.newPlannedOn}`}</li>)}</ol>
    <p>当前显示前 {task.arrangements.length} 项日期；<a href={`/adventure?taskId=${task.id}`}>分页查看全部安排</a></p>
  </details>
}

export function PlanningTaskHistory({ id }: { id: string }) {
  const identity = useVerifiedIdentity()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<TaskHistory>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(undefined)
    setError('')
    void planningApi.taskHistory(identity.ownerId, id, page,
      AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)]))
      .then(value => { if (!controller.signal.aborted && !identity.signal.aborted) setData(value) })
      .catch(() => { if (!controller.signal.aborted && !identity.signal.aborted) setError('暂时无法读取原安排链，请重试。') })
    return () => controller.abort()
  }, [identity.ownerId, identity.signal, id, page, attempt])
  return <section className="planning-detail" aria-label="完整原安排链">
    {error && <p role="alert">{error}<button onClick={() => setAttempt(attempt + 1)}>重新读取历史</button></p>}
    {!data && !error && <p role="status">正在读取原安排链…</p>}
    {data && <><h3>{data.title}</h3><ArrangementItems items={data.items} />
      <p><a href={`/adventure?taskId=${id}`}>任务历史永久链接</a></p>
      <div className="planning-pagination"><small>共 {data.total} 项 · 第 {data.page} 页</small><div>
        <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页安排</button>
        <button disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>下一页安排</button>
      </div></div>
    </>}
  </section>
}

export function PlanningReschedule({ task, version, blocked, preview, action, close }: {
  task: PlanningTask; version: number; blocked: boolean;
  preview: (command: PlanningCommand) => Promise<ReschedulePreview | undefined>;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>; close: () => void
}) {
  const [plannedOn, setPlannedOn] = useState('')
  const [current, setCurrent] = useState<ReschedulePreview>()
  const generation = useRef(0)
  const stale = !current || current.version !== version || current.newPlannedOn !== plannedOn
  return <form onSubmit={event => {
    event.preventDefault()
    if (!current || stale) return
    void action({ type: 'rescheduleTask', id: task.id, plannedOn: current.newPlannedOn }, current.version).then(saved => { if (saved) close() })
  }}><fieldset disabled={blocked}>
    <h3>{task.title}</h3><p>当前执行日期：{task.plannedOn}</p>
    <label>新的执行日期<input required type="date" min={task.rescheduleMin} value={plannedOn} onChange={event => { generation.current++; setPlannedOn(event.target.value); setCurrent(undefined) }} /></label>
    <PlanningArrangements task={task} />
    {current && <section aria-label="改期预览"><p>{current.oldPlannedOn} → {current.newPlannedOn}</p><p>{current.message}</p></section>}
    {current && stale && <p role="status">数据已变化，请重新预览后确认改期。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={close}>取消</button>
      <button type="button" disabled={blocked || !plannedOn} onClick={() => {
        const attempt = ++generation.current
        void preview({ type: 'rescheduleTask', id: task.id, plannedOn }).then(value => { if (attempt === generation.current) setCurrent(value) })
      }}>预览改期</button>
      <button className="adventure-primary" type="submit" disabled={blocked || stale}>确认改期</button>
    </div>
  </fieldset></form>
}
