import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import { planningApi } from './planning-api'
import type { PlanningTask, TaskHistory } from '../shared/adventure-planning'

function ArrangementItems({ items }: { items: TaskHistory['items'] }) {
  return <ol>{items.map(item => <li key={item.id}>
    {item.kind === 'task_created' ? `最初安排：${item.newPlannedOn}` : `${item.oldPlannedOn} → ${item.newPlannedOn}`}
    <p>{item.title} · {item.description || '无说明'} · {item.goalTitle ?? '独立任务'}</p>
    <small>{new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small>
  </li>)}</ol>
}

export function PlanningArrangements({ task }: { task: PlanningTask }) {
  if (!task.arrangements?.length) return null
  return <section className="planning-arrangements" aria-label="原安排链"><h4>原安排链（{task.totalArrangements}）</h4>
    <ol>{task.arrangements.map(item => <li key={item.id}>{item.kind === 'task_created' ? `最初安排：${item.newPlannedOn}` : `${item.oldPlannedOn} → ${item.newPlannedOn}`}</li>)}</ol>
    <p>当前显示前 {task.arrangements.length} 项日期。</p>
  </section>
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
  return <section className="planning-detail" role="region" aria-label="完整原安排链">
    {error && <p role="alert">{error}<button onClick={() => setAttempt(attempt + 1)}>重新读取历史</button></p>}
    {!data && !error && <p role="status">正在读取原安排链…</p>}
    {data && <><h3>{data.title}</h3>{data.items.length ? <ArrangementItems items={data.items} /> : <p>暂无安排记录。</p>}
      {data.total > data.pageSize && <div className="planning-pagination"><small>共 {data.total} 项 · 第 {data.page} 页</small><div>
        <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页安排</button>
        <button disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>下一页安排</button>
      </div></div>}
    </>}
  </section>
}
