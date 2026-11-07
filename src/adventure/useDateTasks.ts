import { useEffect, useState } from 'react'
import { useVerifiedIdentity } from '../auth/identity'
import type { PlanningPage, TaskList } from '../shared/adventure-planning'
import { planningApi } from './planning-api'

export function useDateTasks(workspace: PlanningPage, date: string) {
  const identity = useVerifiedIdentity()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; result?: TaskList; loaded: number; error?: string }>()
  const key = `${identity.ownerId}:${workspace.version}:${workspace.today}:${date}:${workspace.taskScope}:${attempt}`
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, loaded: 0 })
    void (async () => {
      try {
        const tasks: TaskList['tasks'] = []
        const ids = new Set<string>()
        let total: number | undefined
        for (let page = 1; ; page++) {
          const signal = AbortSignal.any([controller.signal, identity.signal, AbortSignal.timeout(15_000)])
          const batch = await planningApi.taskList(identity.ownerId, { date, scope: workspace.taskScope, expectedVersion: workspace.version, today: workspace.today, page }, signal)
          signal.throwIfAborted()
          if (batch.version !== workspace.version || batch.today !== workspace.today || batch.date !== date || batch.scope !== workspace.taskScope || batch.page !== page
            || total !== undefined && batch.total !== total) throw new Error('任务数据已变化，请重新读取。')
          total = batch.total
          for (const task of batch.tasks) {
            if (ids.has(task.id)) throw new Error('任务数据不完整，请重新读取。')
            ids.add(task.id)
            tasks.push(task)
          }
          if (tasks.length > total || tasks.length < total && batch.tasks.length !== batch.pageSize) throw new Error('任务读取不完整，请重新读取。')
          if (tasks.length === total) {
            setState({ key, loaded: total, result: { ...batch, page: 1, tasks } })
            return
          }
          setState({ key, loaded: tasks.length })
        }
      } catch (error) {
        if (!controller.signal.aborted && !identity.signal.aborted) setState({ key, loaded: 0, error: error instanceof Error ? error.message : '任务暂时无法读取，请重试。' })
      }
    })()
    return () => controller.abort()
  }, [key, identity.ownerId, identity.signal, workspace.version, workspace.today, workspace.taskScope, date])
  return { result: state?.key === key ? state.result : undefined, error: state?.key === key ? state.error : undefined,
    loaded: state?.key === key ? state.loaded : 0, retry: () => setAttempt(value => value + 1) }
}
