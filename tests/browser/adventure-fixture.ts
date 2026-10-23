import type { BrowserContext } from '@playwright/test'
import type { PlanningEnvelope, PlanningPage, PlanningPreview } from '../../src/shared/adventure-planning'

export const mainlineId = '00000000-0000-4000-8000-000000000054'
export const goalId = '00000000-0000-4000-8000-000000000055'
export const allowed = { allowed: true }
export const later = { allowed: false, reason: '此操作尚未交付' }
export const emptyPlanning: PlanningPage = {
  tasks: [], totalTasks: 0, taskPage: 1, taskRange: 'today', taskScope: 'all', search: '',
  includeTerminal: false,
  mainlineDetail: null,
  taskProgress: { completed: 0, total: 0, ratio: null },
  todayTaskProgress: { completed: 0, total: 0, ratio: null },
  goalDetail: null, version: 0, today: '2026-10-20', mainlines: [], goals: [],
  destinations: [],
  goalScope: 'all', page: 1, pageSize: 20, totalGoals: 0,
  growth: { level: 1, totalXp: 0, progress: 0, needed: 20, remaining: 20, actions: 0, achievedGoals: 0, achievements: [] },
  capabilities: { createMainline: allowed, createGoal: allowed, createTask: later, growth: later },
  limits: { name: 200, standard: 4000, standards: 50 },
}
export const withMainline: PlanningPage = {
  ...emptyPlanning, version: 1,
  mainlines: [{ id: mainlineId, name: '健康', activeGoalCount: 0, todayTaskCount: 0, status: 'active', endedAt: null, capabilities: { rename: allowed, end: later } }],
  destinations: [...emptyPlanning.destinations, { id: mainlineId, name: '健康' }],
}
export const withGoal: PlanningPage = {
  ...withMainline, version: 2, totalGoals: 1,
  goals: [{ id: goalId, title: '五公里', standards: ['连续跑完五公里'], mainlineId, mainlineName: '健康', independent: false, focused: false, sortOrder: 0, status: 'active', terminatedAt: null, achievement: null,
    progress: { completed: 0, total: 0, ratio: null }, createdAt: '2026-10-20T04:00:00Z', capabilities: { edit: allowed, focus: later, migrate: later, achieve: later, end: later } }],
}

// UI-only fixture: supplied snapshots are independent expectations, not a second domain engine.
export async function planningFixture(context: BrowserContext, initial = emptyPlanning) {
  let page = structuredClone(initial)
  let saved = page
  let queryFailures = 0
  let loseResponse = false
  let conflict = false
  let stale = false
  let queryDelay = 0
  let commandDelay = 0
  const envelopes: PlanningEnvelope[] = []
  const previews: unknown[] = []
  let previewResult: PlanningPreview | undefined
  await context.route('**/api/adventure**', async route => {
    if (new URL(route.request().url()).pathname === '/api/adventure/task-history') {
      const query = new URL(route.request().url()).searchParams
      const task = page.tasks.find(item => item.id === query.get('id'))
      return route.fulfill({ json: { version: page.version, taskId: query.get('id'), title: task?.title ?? '任务', page: Number(query.get('page') ?? 1), pageSize: 5, total: 0, items: [] } })
    }
    if (route.request().method() === 'GET') {
      const delay = queryDelay
      queryDelay = 0
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      if (queryFailures > 0) {
        queryFailures--
        return route.fulfill({ status: 503, json: { error: { message: '读取失败' } } })
      }
      return route.fulfill({ json: stale ? initial : page })
    }
    if (new URL(route.request().url()).pathname.endsWith('/preview')) {
      previews.push(route.request().postDataJSON())
      if (!previewResult) throw new Error('必须显式配置预览结果')
      return route.fulfill({ json: previewResult })
    }
    envelopes.push(route.request().postDataJSON())
    const delay = commandDelay
    commandDelay = 0
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    page = saved
    if (conflict) {
      conflict = false
      return route.fulfill({ status: 409, json: { error: { code: 'VERSION_CONFLICT', message: '版本已变化' } } })
    }
    if (loseResponse) {
      loseResponse = false
      return route.abort('failed')
    }
    const command = envelopes.at(-1)!.command
    const entityId = 'id' in command ? command.id : mainlineId
    return route.fulfill({ json: { version: saved.version, result: { entityId, message: '已保存' } } })
  })
  return {
    envelopes, previews,
    preview(value: PlanningPreview) { previewResult = structuredClone(value) },
    saved(value: PlanningPage) { saved = structuredClone(value) },
    show(value: PlanningPage) { page = structuredClone(value) },
    failNextQuery() { queryFailures++ },
    loseNextResponse() { loseResponse = true },
    conflictNext() { conflict = true },
    staleQueries(value: boolean) { stale = value },
    delayNextQuery(ms: number) { queryDelay = ms },
    delayNextCommand(ms: number) { commandDelay = ms },
  }
}
