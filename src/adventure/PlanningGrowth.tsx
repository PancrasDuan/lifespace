import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sprout, Star } from 'lucide-react'
import { useVerifiedIdentity } from '../auth/identity'
import type { GrowthPage, RewardEntry, RewardSource } from '../shared/adventure-growth'
import { planningApi, PlanningError } from './planning-api'
import { PlanningTaskHistory } from './PlanningReschedule'
import { PlanningToast } from './PlanningToast'
import { Progress } from './PrototypeRecord'

function Attribution({ entry }: { entry: Pick<RewardEntry, 'mainlineKind' | 'mainlineName' | 'goalId' | 'goalTitle'> }) {
  return <>{entry.mainlineKind === 'normal' ? `${entry.mainlineName} / ${entry.goalTitle}` : entry.goalId ? `独立目标 / ${entry.goalTitle}` : '独立任务'}</>
}
function Calculation({ entry }: { entry: RewardEntry }) {
  const calculation = entry.calculation
  return <>{calculation.type === 'fixed_task' ? '完整行动 · 固定 1 点 · 系数 1' : calculation.fallback
    ? `零行动保底 · 固定 1 点（N=0，C=${calculation.coefficient}）`
    : `${calculation.count} 次计奖行动 × 系数 ${calculation.coefficient} = ${entry.amount} 点`}</>
}

function RewardInline({ id, version, title, detailId, changed, reportError, recovery }: { id: string; version?: number; title: string; detailId: string; changed: () => void; reportError: (message: string) => void; recovery: ReactNode }) {
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
  return <section className="reward-details planning-detail" id={detailId} aria-label={`${title}的奖励来源`}>
    <p className="adventure-hint">按发生时快照展示，后续改名、迁移和结束不改写这次记录。</p>
    {error ? <p>来源暂时无法读取。<button onClick={() => conflict ? changed() : setAttempt(attempt + 1)}>{conflict ? '重新读取成长记录' : '重试来源详情'}</button></p>
      : !data ? <p role="status">正在读取来源…</p> : <>
        <h3>{data.event.title}</h3><p>{data.event.kind === 'task_completed' ? '任务完成' : '目标达成'} · {data.event.occurredOn} · +{data.event.amount} 点经验</p>
        <p><Attribution entry={data.event} /></p><p><Calculation entry={data.event} /></p>
        {data.plannedOn && <p>发生时安排：{data.plannedOn}</p>}
        {data.description && <p className="planning-frozen-content">{data.description}</p>}
        {data.standards.length > 0 && <><h4>发生时完成标准</h4><ul>{data.standards.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {data.reflection && <><h4>达成感想</h4><p className="planning-frozen-content">{data.reflection}</p></>}

        {data.event.kind === 'task_completed' && <section aria-label="任务安排历史"><h4>当前任务的完整原安排链</h4><PlanningTaskHistory key={`${data.event.entityId}:${data.version}`} id={data.event.entityId} /></section>}
        {data.totalSources > 0 && <section aria-label="冻结计奖行动"><h4>计奖行动 · 共 {data.totalSources} 次</h4>
          <ol>{data.actionSources.map(source => <li key={source.completionId}><strong>{source.title}</strong><p>{source.occurredOn} · 原安排 {source.plannedOn}</p><p><Attribution entry={source} /></p><p className="planning-frozen-content">{source.description}</p></li>)}</ol>
          <div className="planning-pagination"><small>第 {data.page} 页</small><div>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页计奖行动</button>
            <button disabled={page * data.pageSize >= data.totalSources} onClick={() => setPage(page + 1)}>下一页计奖行动</button>
          </div></div>
        </section>}
      </>}
    {recovery && <div className="planning-recovery">{recovery}</div>}
  </section>
}

export function PlanningGrowth() {
  const identity = useVerifiedIdentity()
  const [query, setQuery] = useState<{ attempt: number; cursor?: string; version?: number }>({ attempt: 0 })
  const locatingCursor = useRef<string | undefined>(undefined)
  const [data, setData] = useState<GrowthPage>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState<{ id: string; version?: number; cursor?: string } | undefined>(() => { const id = new URLSearchParams(window.location.search).get('rewardId'); return id ? { id } : undefined })
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
  const locating = !!source && !!data && !data.items.some(item => item.id === source.id)
  useEffect(() => {
    if (!locating || !data?.nextCursor || locatingCursor.current === data.nextCursor) return
    locatingCursor.current = data.nextCursor
    setQuery({ attempt: query.attempt, cursor: data.nextCursor, version: data.version })
  }, [locating, data, query.attempt])
  const openSource = (id: string) => { if (source?.id === id) { closeSource(); return }; setSource({ id, version: data?.version }); locatingCursor.current = undefined; window.history.replaceState(null, '', `/adventure?view=growth&rewardId=${id}`) }
  const closeSource = () => { setSource(undefined); locatingCursor.current = undefined; window.history.replaceState(null, '', '/adventure?view=growth') }
  const restart = () => { closeSource(); setNotice(''); setData(undefined); setQuery({ attempt: query.attempt + 1 }) }
  const recovery = error && <button disabled={busy} onClick={() => { setNotice(''); if (conflict) restart(); else setQuery({ ...query, attempt: query.attempt + 1 }) }}>{conflict || !data ? '重新读取成长记录' : '重试加载流水'}</button>
  return <div className="growth-view adventure-proto-growth" aria-label="成长记录">
    <header className="growth-heading"><span className="eyebrow">EVERY STEP COUNTS</span><h2>走过的路，留下的光。</h2><p>真实行动与目标成果，汇成此刻的成长。</p></header>
    {notice && <PlanningToast key={notice} message={notice} tone="error" close={() => setNotice('')} />}
    {error && <p>成长记录暂时无法更新。{recovery}</p>}
    {busy && <p role="status">{data ? '正在加载更多流水…' : '正在读取成长记录…'}</p>}
    {source && !data && !busy && <p role="status">正在读取奖励来源…</p>}
    {source && data && !data.items.some(item => item.id === source.id) && (data.nextCursor ? <p role="status">正在查找这条奖励…</p> : <p role="status">这条奖励已不在当前有效流水中。</p>)}
    {data && <>
      {conflict && <p>以下保留的是版本 {data.version} 的记录；重新读取后查看当前事实。</p>}
      <section className="growth-overview" role="region" aria-label="全账户成长"><div><span>当前等级</span><strong>Lv.{data.growth.level}</strong><p>{data.growth.totalXp} 点累计经验 · 再获得 {data.growth.remaining} 点进入下一级</p><p>{data.growth.actions} 次真实行动 · {data.growth.achievedGoals} 个达成目标</p></div><Progress value={data.growth.needed ? data.growth.progress / data.growth.needed : 0} label="成长等级进度" /></section>
      <section className="growth-section" role="region" aria-label="七个实时成就"><header className="section-heading"><div><span className="eyebrow">里程碑</span><h2>最近点亮的成就</h2></div></header>
        <div className="achievement-list">{data.growth.achievements.map(item => <article key={item.id} aria-label={`成就：${item.label}`} className={item.unlocked ? 'achievement is-lit' : 'achievement'}>
          <span className="record-mark"><Star size={16} /></span><div><strong>{item.label}</strong><p>{item.unlocked ? '已点亮' : `完成 ${item.threshold} ${item.id.startsWith('actions_') ? '次真实行动' : '个目标'}`}</p></div><small>{item.unlocked ? '已点亮' : `${Math.min(item.count, item.threshold)} / ${item.threshold} · 还差 ${item.remaining}`}</small>
        </article>)}</div>
      </section>
      <section className="growth-section" role="region" aria-label="有效奖励流水"><header className="section-heading"><div><span className="eyebrow">来处</span><h2>最近的有效经验</h2></div></header>
        {data.items.length === 0 ? <p className="adventure-empty">还没有有效奖励。从一次完整行动开始。</p> : <ol className="reward-list">{data.items.map(item => <li className="reward-entry" key={item.id}><article aria-label={`奖励：${item.title}`}><button className="reward-row" aria-label={`查看来源：${item.title}，${item.occurredOn}，增加 ${item.amount} 点经验`} disabled={conflict} aria-expanded={source?.id === item.id} aria-controls={`reward-detail-${item.id}`} onClick={() => openSource(item.id)}>
          <span>{item.occurredOn}</span><span><strong>{item.title}</strong><small>{item.kind === 'task_completed' ? '任务完成' : '目标达成'} · <Attribution entry={item} /></small><small><Calculation entry={item} /></small></span><strong>+{item.amount}</strong>
        </button>{source?.id === item.id && <RewardInline key={`${source.id}:${source.version}`} id={source.id} version={source.version} title={item.title} detailId={`reward-detail-${item.id}`} changed={restart} reportError={setNotice} recovery={recovery} />}</article></li>)}</ol>}
        <footer className="planning-pagination"><small>已显示 {data.items.length} / {data.total} 条有效奖励</small>{data.nextCursor && <button disabled={busy || !!error} onClick={() => setQuery({ attempt: 0, cursor: data.nextCursor!, version: data.version })}>加载更多流水</button>}</footer>
      </section>
    </>}
  </div>
}
