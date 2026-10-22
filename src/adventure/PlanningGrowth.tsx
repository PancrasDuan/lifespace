import { useEffect, useState, type ReactNode } from 'react'
import { Sprout, Star } from 'lucide-react'
import { useVerifiedIdentity } from '../auth/identity'
import type { GrowthPage, RewardEntry, RewardSource } from '../shared/adventure-growth'
import { planningApi, PlanningError } from './planning-api'
import { Modal } from './ui'
import { PlanningToast } from './PlanningToast'

function Attribution({ entry }: { entry: Pick<RewardEntry, 'mainlineKind' | 'mainlineName' | 'goalId' | 'goalTitle'> }) {
  return <>{entry.mainlineKind === 'normal' ? `${entry.mainlineName} / ${entry.goalTitle}` : entry.goalId ? `独立目标 / ${entry.goalTitle}` : '独立任务'}</>
}
function Calculation({ entry }: { entry: RewardEntry }) {
  const calculation = entry.calculation
  return <>{calculation.type === 'fixed_task' ? '完整行动 · 固定 1 点 · 系数 1' : calculation.fallback
    ? `零行动保底 · 固定 1 点（N=0，C=${calculation.coefficient}）`
    : `${calculation.count} 次计奖行动 × 系数 ${calculation.coefficient} = ${entry.amount} 点`}</>
}

function RewardDetail({ id, version, close, changed, reportError, recovery }: { id: string; version?: number; close: () => void; changed: () => void; reportError: (message: string) => void; recovery: ReactNode }) {
  const identity = useVerifiedIdentity()
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<RewardSource>()
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)])
    setError(''); setData(undefined); setConflict(false)
    void planningApi.rewardSource(identity.ownerId, id, page, signal, version).then(value => {
      if (!signal.aborted) setData(value)
    }).catch(failure => {
      if (controller.signal.aborted || identity.signal.aborted) return
      setConflict(failure instanceof PlanningError && failure.status === 409)
      setError(failure instanceof PlanningError ? failure.message : '来源读取失败，请重试。')
      reportError(failure instanceof PlanningError ? failure.message : '来源读取失败，请重试。')
    })
    return () => controller.abort()
  }, [id, page, attempt, version, identity.ownerId, identity.signal, reportError])
  return <Modal title="冻结奖励来源" close={close}><section className="planning-detail" aria-label="奖励来源详情">
    <p className="adventure-hint">按发生时快照展示，后续改名、迁移和结束不改写这次记录。</p>
    {error ? <p>来源暂时无法读取。<button onClick={() => conflict ? changed() : setAttempt(attempt + 1)}>{conflict ? '重新读取成长记录' : '重试来源详情'}</button></p>
      : !data ? <p role="status">正在读取来源…</p> : <>
        <h3>{data.event.title}</h3><p>{data.event.kind === 'task_completed' ? '任务完成' : '目标达成'} · {data.event.occurredOn} · +{data.event.amount} 点经验</p>
        <p><Attribution entry={data.event} /></p><p><Calculation entry={data.event} /></p>
        {data.plannedOn && <p>发生时安排：{data.plannedOn}</p>}
        {data.description && <p className="planning-frozen-content">{data.description}</p>}
        {data.standards.length > 0 && <><h4>发生时完成标准</h4><ul>{data.standards.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {data.reflection && <><h4>达成感想</h4><p className="planning-frozen-content">{data.reflection}</p></>}
        <details><summary>稳定身份与发生时间</summary><p>事件 ID：{data.event.id}</p><p>行动／目标 ID：{data.event.entityId}</p><p>发生时间：{data.event.occurredAt}</p><p>发生时主线 ID：{data.event.mainlineId}</p>{data.event.goalId && <p>发生时目标 ID：{data.event.goalId}</p>}</details>
        {data.event.kind === 'task_completed' && <p><a href={`/adventure?taskId=${data.event.entityId}`}>查看任务安排历史</a></p>}
        <p><a href={`/adventure?view=growth&rewardId=${id}`}>奖励来源永久链接</a></p>
        {data.totalSources > 0 && <section aria-label="冻结计奖行动"><h4>计奖行动 · 共 {data.totalSources} 次</h4>
          <ol>{data.actionSources.map(source => <li key={source.completionId}><strong>{source.title}</strong><p>{source.occurredOn} · 原安排 {source.plannedOn}</p><p><Attribution entry={source} /></p><p className="planning-frozen-content">{source.description}</p><small>行动 ID：{source.taskId}<br />完成 ID：{source.completionId}</small></li>)}</ol>
          <div className="planning-pagination"><small>第 {data.page} 页</small><div>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页计奖行动</button>
            <button disabled={page * data.pageSize >= data.totalSources} onClick={() => setPage(page + 1)}>下一页计奖行动</button>
          </div></div>
        </section>}
      </>}
    {recovery && <div className="planning-recovery">{recovery}</div>}
  </section></Modal>
}

export function PlanningGrowth() {
  const identity = useVerifiedIdentity()
  const [query, setQuery] = useState<{ attempt: number; cursor?: string; version?: number }>({ attempt: 0 })
  const [data, setData] = useState<GrowthPage>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState<{ id: string; version?: number } | undefined>(() => { const id = new URLSearchParams(window.location.search).get('rewardId'); return id ? { id } : undefined })
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)])
    setBusy(true); setError(''); setConflict(false)
    void planningApi.growth(identity.ownerId, signal, query.version, query.cursor).then(value => {
      if (signal.aborted) return
      setData(previous => query.cursor && previous ? { ...value, items: [...previous.items, ...value.items] } : value)
    }).catch(failure => {
      if (controller.signal.aborted || identity.signal.aborted) return
      setConflict(failure instanceof PlanningError && failure.status === 409)
      setError(failure instanceof PlanningError ? failure.message : '成长记录读取失败，请重试。')
      setNotice(failure instanceof PlanningError ? failure.message : '成长记录读取失败，请重试。')
    }).finally(() => { if (!controller.signal.aborted && !identity.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [query, identity.ownerId, identity.signal])
  const openSource = (id: string) => { setSource({ id, version: data?.version }); window.history.replaceState(null, '', `/adventure?view=growth&rewardId=${id}`) }
  const closeSource = () => { setSource(undefined); window.history.replaceState(null, '', '/adventure?view=growth') }
  const restart = () => { closeSource(); setNotice(''); setData(undefined); setQuery({ attempt: query.attempt + 1 }) }
  const recovery = error && <button disabled={busy} onClick={() => { setNotice(''); if (conflict) restart(); else setQuery({ ...query, attempt: query.attempt + 1 }) }}>{conflict || !data ? '重新读取成长记录' : '重试加载流水'}</button>
  return <div className="planning-growth" aria-label="成长记录">
    <header className="planning-growth-heading"><span className="adventure-kicker">EVERY STEP COUNTS</span><h2>走过的路，留下的光。</h2><p>真实行动与目标成果，汇成此刻的成长。</p></header>
    {notice && <PlanningToast key={notice} message={notice} tone="error" withinDialog={!!source} close={() => setNotice('')} />}
    {error && <p>成长记录暂时无法更新。{recovery}</p>}
    {busy && <p role="status">{data ? '正在加载更多流水…' : '正在读取成长记录…'}</p>}
    {data && <>
      {conflict && <p>以下保留的是版本 {data.version} 的记录；重新读取后查看当前事实。</p>}
      <section className="planning-section planning-growth-summary" aria-label="全账户成长"><div className="planning-level"><strong>Lv.{data.growth.level}</strong><p>累计经验 {data.growth.totalXp}<br /><small>距下一级 {data.growth.remaining} 点经验</small></p></div>
        <div className="adventure-exp-label"><span>本级经验</span><span>{data.growth.progress} / {data.growth.needed}</span></div><progress aria-label="成长等级进度" max={data.growth.needed} value={data.growth.progress} />
        <p>{data.growth.actions} 次真实行动 · {data.growth.achievedGoals} 个达成目标</p>
        <small>全账户统计 · 版本 {data.version} · 合法取消完成后，经验、等级及成就随事实回退。</small>
      </section>
      <section className="planning-section" aria-label="七个实时成就"><h3><Star size={18} />一点点，成为里程碑</h3><p className="adventure-hint">按当前有效事实判断，不额外发放经验。</p>
        <div className="planning-milestones">{data.growth.achievements.map(item => <article key={item.id} aria-label={`成就：${item.label}`} className={item.unlocked ? 'is-lit' : ''}>
          <Sprout size={21} /><h4>{item.label}</h4><p>{item.unlocked ? '已点亮' : '未点亮'} · {item.count} / {item.threshold}</p>
          <progress aria-label={`${item.label}进度`} value={item.count} max={item.threshold} /><small>还差 {item.remaining} {item.id.startsWith('actions_') ? '次行动' : '个目标'}</small>
        </article>)}</div>
      </section>
      <section className="planning-section" aria-label="有效奖励流水"><h3>经验的来处</h3><p className="adventure-hint">冻结于每次完成或达成；已取消完成的奖励不计入流水。</p>
        {data.items.length === 0 && <p className="adventure-empty">还没有有效奖励。从一次完整行动开始。</p>}
        <ol className="planning-reward-list">{data.items.map(item => <li key={item.id}><article aria-label={`奖励：${item.title}`}><div><small>{item.occurredOn} · {item.kind === 'task_completed' ? '任务完成' : '目标达成'}</small><h4>{item.title}</h4><p><Attribution entry={item} /></p><p><Calculation entry={item} /></p></div><div className="planning-reward-amount"><strong>+{item.amount}</strong><small>点经验</small><button disabled={conflict} onClick={() => openSource(item.id)}>查看来源</button></div></article></li>)}</ol>
        <footer className="planning-pagination"><small>已显示 {data.items.length} / {data.total} 条有效奖励</small>{data.nextCursor && <button disabled={busy || !!error} onClick={() => setQuery({ attempt: 0, cursor: data.nextCursor!, version: data.version })}>加载更多流水</button>}</footer>
      </section>
    </>}
    {source && <RewardDetail key={`${source.id}:${source.version}`} id={source.id} version={source.version} close={closeSource} changed={restart} reportError={setNotice} recovery={recovery} />}
  </div>
}
