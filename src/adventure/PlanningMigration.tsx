import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { MigrationOptions, PlanningCommand } from '../shared/adventure-planning'
import { planningApi } from './planning-api'

export function PlanningMigration({ kind, id, title, version, blocked, action, close }: {
  kind: 'goal' | 'task'; id: string; title: string; version: number; blocked: boolean;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>; close: () => void
}) {
  const identity = useVerifiedIdentity()
  const [page, setPage] = useState(1)
  const [options, setOptions] = useState<MigrationOptions>()
  const [destination, setDestination] = useState<string>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setOptions(undefined)
    setDestination(undefined)
    setError('')
    void planningApi.migrationOptions(identity.ownerId, kind, id, page,
      AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)]))
      .then(value => { if (!controller.signal.aborted && !identity.signal.aborted) setOptions(value) })
      .catch(() => { if (!controller.signal.aborted && !identity.signal.aborted) setError('暂时无法读取迁移候选，请重试。') })
    return () => controller.abort()
  }, [identity.ownerId, identity.signal, kind, id, page, version, attempt])
  const stale = options && options.version !== version
  const selected = options?.options.find(option => option.id === destination)
  return <form onSubmit={event => {
    event.preventDefault()
    if (!blocked && !stale && options && selected?.capability.allowed && destination !== undefined) {
      void action({ type: kind === 'goal' ? 'migrateGoal' : 'migrateTask', id, destination }, options.version).then(saved => { if (saved) close() })
    }
  }}>
    <h3>{title}</h3><p>保留身份、状态和执行日期；历史完成及冻结奖励保留原归属，迁移不发奖。</p>
    {kind === 'goal' && <p>任务随目标迁移，保留聚焦并追加到目的同类组末尾。聚焦满额时请先调整。</p>}
    {error && <p role="alert">{error}</p>}
    {!options && !error && <p role="status">正在读取迁移候选…</p>}
    {stale && <p role="alert">数据已变化，请重新读取页面后选择迁移目的。</p>}
    {options && <fieldset disabled={blocked || !!stale}>
      <label>迁移目的<select required value={destination === undefined ? '__unselected' : destination} onChange={event => setDestination(event.target.value)}>
        <option value="__unselected" disabled>请选择迁移目的</option>
        {options.options.map(option => <option key={option.id} value={option.id} disabled={!option.capability.allowed}>
          {option.name}{option.capability.allowed ? '' : ` · ${option.capability.reason}`}
        </option>)}
      </select></label>
      <div className="planning-pagination"><small>候选共 {options.total} 项 · 第 {options.page} 页</small><div>
        <button type="button" disabled={blocked || page <= 1} onClick={() => setPage(page - 1)}>上一页候选</button>
        <button type="button" disabled={blocked || page * options.pageSize >= options.total} onClick={() => setPage(page + 1)}>下一页候选</button>
      </div></div>
    </fieldset>}
    <div className="adventure-form-footer">
      <button type="button" disabled={blocked} onClick={close}>取消</button>
      {error && <button type="button" disabled={blocked} onClick={() => setAttempt(attempt + 1)}>重试读取候选</button>}
      <button className="adventure-primary" type="submit" disabled={blocked || !!stale || !selected?.capability.allowed}>确认迁移</button>
    </div>
  </form>
}
