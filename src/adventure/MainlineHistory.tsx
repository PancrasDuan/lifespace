import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningPage } from '../shared/adventure-planning'
import { planningApi } from './planning-api'

export function MainlineHistory({ id }: { id: string }) {
  const identity = useVerifiedIdentity()
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<PlanningPage>()
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setData(undefined)
    setError(false)
    void planningApi.load(identity.ownerId, { mainlineId: id, page, includeTerminal: true, goalScope: 'all', taskRange: 'today', taskPage: 1, taskScope: 'all', search: '', goalTaskPage: 1 }, AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)]))
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(() => { if (!controller.signal.aborted && !identity.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [id, page, retry, identity.ownerId, identity.signal])
  return <section role="region" aria-label="主线历史" aria-busy={!data && !error}>
    {!data ? error ? <p role="status">暂时无法读取主线历史。<button onClick={() => setRetry(value => value + 1)}>重试主线历史</button></p> : <p role="status">正在读取主线历史…</p> : <>
      <p>{data.mainlineDetail?.status === 'ended' ? '已结束 · 只读' : '在用'}</p>
      {data.mainlineDetail?.endedAt && <p>结束时间：{new Date(data.mainlineDetail.endedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
      <ul>{data.goals.map(goal => <li key={goal.id}>{goal.title} · {goal.status === 'achieved' ? '已达成' : goal.status === 'ended' ? '已结束' : '进行中'}</li>)}</ul>
      <div className="planning-pagination"><small>共 {data.totalGoals} 个目标 · 第 {data.page} 页</small><div>
        <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页主线历史</button>
        <button disabled={data.page * data.pageSize >= data.totalGoals} onClick={() => setPage(data.page + 1)}>下一页主线历史</button>
      </div></div>
    </>}
  </section>
}
