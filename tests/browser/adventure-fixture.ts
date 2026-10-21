import type { BrowserContext } from '@playwright/test'
import type { PlanningEnvelope, PlanningPage } from '../../src/shared/adventure-planning'

export const mainlineId = '00000000-0000-4000-8000-000000000054'
export const goalId = '00000000-0000-4000-8000-000000000055'
export const allowed = { allowed: true }
export const later = { allowed: false, reason: '此操作尚未交付' }
export const emptyPlanning: PlanningPage = {
  version: 0, today: '2026-10-20', mainlines: [], goals: [],
  destinations: [],
  page: 1, pageSize: 20, totalGoals: 0,
  growth: { level: 1, totalXp: 0, progress: 0, needed: 20, remaining: 20, actions: 0, achievedGoals: 0 },
  capabilities: { createMainline: allowed, createGoal: allowed, createTask: later, growth: later },
  limits: { name: 200, standard: 4000, standards: 50 },
}
export const withMainline: PlanningPage = {
  ...emptyPlanning, version: 1,
  mainlines: [{ id: mainlineId, name: '健康', capabilities: { rename: allowed, end: later } }],
  destinations: [...emptyPlanning.destinations, { id: mainlineId, name: '健康' }],
}
export const withGoal: PlanningPage = {
  ...withMainline, version: 2, totalGoals: 1,
  goals: [{ id: goalId, title: '五公里', standards: ['连续跑完五公里'], mainlineId, mainlineName: '健康', independent: false,
    createdAt: '2026-10-20T04:00:00Z', capabilities: { edit: allowed, focus: later, migrate: later, achieve: later, end: later } }],
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
  await context.route('**/api/adventure**', async route => {
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
    return route.fulfill({ json: { version: saved.version, result: { entityId: mainlineId, message: '已保存' } } })
  })
  return {
    envelopes,
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
