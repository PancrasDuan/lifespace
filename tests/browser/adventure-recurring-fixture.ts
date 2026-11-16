import type { BrowserContext } from '@playwright/test'
import { planningGoalSchema, planningTaskSchema, type PlanningEnvelope, type PlanningPage } from '../../src/shared/adventure-planning'
import { recurringChildSchema, recurringParentSchema, type RecurringChild, type RecurringParent } from '../../src/shared/adventure-recurring'
import { emptyPlanning } from './adventure-fixture'

export const today = '2026-11-15'
export const uuid = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const yes = { allowed: true }, no = { allowed: false, reason: '当前状态不可操作' }
export const parent = recurringParentSchema.parse({
  kind: 'recurring', id: uuid(1), title: '刷 LeetCode', description: '周期内自由安排，完成一道题记录一次。', periodType: 'week', startOn: '2026-11-04', requiredCount: 5,
  goalId: uuid(10), goalTitle: '提升编程能力', categoryLabel: null, independent: false, status: 'active', endedAt: null, endedOn: null, completedPeriods: 1, effectiveChildren: 3,
  currentPeriod: { number: 2, startOn: '2026-11-11', endOn: '2026-11-17', completed: 3, required: 5, ratio: .6, satisfied: false },
  capabilities: { editRecurringTask: yes, changeDestination: yes, changeStartOn: no, recordRecurringCompletion: yes, endRecurringTask: yes, deleteRecurringTask: no },
})
export const book = recurringParentSchema.parse({ ...parent, id: uuid(2), title: '读完一本书', description: '不赶进度，读完再记录。', periodType: 'month', startOn: '2026-11-01', goalId: uuid(11), goalTitle: '保持阅读', effectiveChildren: 5,
  currentPeriod: { number: 1, startOn: '2026-11-01', endOn: '2026-11-30', completed: 5, required: 5, ratio: 1, satisfied: true }, capabilities: { ...parent.capabilities, recordRecurringCompletion: no } })
export const future = recurringParentSchema.parse({ ...parent, id: uuid(3), title: '季度作品复盘', description: '复盘一个值得留下的作品。', periodType: 'quarter', startOn: '2026-12-01', requiredCount: 3, goalId: null, goalTitle: null, independent: true, status: 'not_started', currentPeriod: null, completedPeriods: 0, effectiveChildren: 0,
  capabilities: { editRecurringTask: yes, changeDestination: yes, changeStartOn: yes, recordRecurringCompletion: no, endRecurringTask: no, deleteRecurringTask: yes } })
export const ended = recurringParentSchema.parse({ ...parent, id: uuid(4), title: '写一篇读书笔记', description: '已结束，保留完成记录。', startOn: '2026-11-01', requiredCount: 2, goalId: uuid(11), goalTitle: '保持阅读', status: 'ended', endedAt: '2026-11-14T09:00:00+08:00', endedOn: '2026-11-14', effectiveChildren: 1,
  currentPeriod: { number: 2, startOn: '2026-11-08', endOn: '2026-11-14', completed: 1, required: 2, ratio: .5, satisfied: false }, capabilities: Object.fromEntries(Object.keys(parent.capabilities).map(key => [key, no])) })
export function makeChild(id: number, source: RecurringParent, on: string, time: string, allowed = false): RecurringChild {
  return recurringChildSchema.parse({ kind: 'recurring_child', id: uuid(id), parentId: source.id, completionId: uuid(id + 1000), status: 'completed', invalidatedAt: null,
    snapshot: { parentId: source.id, childId: uuid(id), title: source.title, description: source.description, periodType: source.periodType, anchorOn: source.startOn, periodNumber: source.currentPeriod!.number,
      periodStartOn: source.currentPeriod!.startOn, periodEndOn: source.currentPeriod!.endOn, requiredCount: source.requiredCount, occurredOn: on, occurredAt: `${on}T${time}:00+08:00`, goalId: source.goalId, goalTitle: source.goalTitle, categoryLabel: null },
    reward: { amount: 1, calculation: { type: 'fixed_task', count: 1, coefficient: 1, completionId: uuid(id + 1000) } }, capabilities: { cancelRecurringCompletion: allowed ? yes : no } })
}
export const children = [makeChild(103, parent, today, '09:42', true), makeChild(102, parent, '2026-11-14', '10:24'), makeChild(101, parent, '2026-11-13', '10:24'),
  ...['15', '12', '09', '06', '03'].map((day, index) => makeChild(110 + index, book, `2026-11-${day}`, day === '15' ? '08:30' : '10:24', day === '15')), makeChild(120, ended, '2026-11-12', '10:24')]
const once = (id: number, title: string, completed: boolean, goal: boolean, date = today, description = '') => planningTaskSchema.parse({ id: uuid(id), title, description, plannedOn: date, completedOn: completed ? today : null, completionId: completed ? uuid(id + 1000) : null, status: completed ? 'completed' : 'pending', goalId: goal ? uuid(10) : null, goalTitle: goal ? '提升编程能力' : null, independent: !goal, overdue: false, progress: { completed: Number(completed), total: 1, ratio: Number(completed) }, reward: null, capabilities: { edit: { allowed: !completed }, complete: { allowed: !completed }, cancel: { allowed: completed }, delete: { allowed: !completed } } })
export const workspace: PlanningPage = { ...emptyPlanning, version: 20, today, recurring: { version: 1, clientVersion: 'recurring-1', timeZone: 'Asia/Shanghai' }, capabilities: { createTask: yes, createGoal: yes, growth: yes }, totalGoals: 3,
  goals: ['提升编程能力', '保持阅读', '准备下一份工作'].map((title, index) => planningGoalSchema.parse({ id: uuid(10 + index), title, standards: ['持续投入，并完成一项可衡量的成果。'], categoryLabel: null, focused: false, sortOrder: index, createdAt: '2026-11-01T08:00:00+08:00', progress: index ? { completed: 0, total: 0, ratio: null } : { completed: 1, total: 2, ratio: .5 }, taskCount: [3, 1, 0][index], capabilities: { createTask: yes, edit: yes, achieve: no, end: no } })),
  tasks: [once(200, '出门散步三十分钟', false, true, today, '放下手机，去附近走走。'), once(201, '准备一顿喜欢的早餐', true, true), once(202, '整理书桌和工作区', true, false, '2026-11-13', '给工作留一点空白。')], totalTasks: 3,
  taskProgress: { completed: 4, total: 5, ratio: .8 }, todayTaskProgress: { completed: 4, total: 5, ratio: .8 },
  growth: { level: 8, totalXp: 232, progress: 72, needed: 100, remaining: 28, actions: 126, achievedGoals: 6, achievements: [{ id: 'actions_150', label: '坚持行动', threshold: 150, count: 126, remaining: 24, unlocked: false }, { id: 'goals_10', label: '目标达成', threshold: 10, count: 6, remaining: 4, unlocked: false }] },
}
export type RecurringFixture = { workspace: PlanningPage; parents: RecurringParent[]; children: RecurringChild[] }
export const initial: RecurringFixture = { workspace, parents: [parent, book, future, ended], children }
export async function recurringFixture(context: BrowserContext, supplied = initial) {
  let state = structuredClone(supplied), next = state
  let failure: { status: number; code: string } | undefined
  let responseLoss = false, queryFailure = false, commandDelay = 0
  const requests: { path: string; body: unknown }[] = [], envelopes: PlanningEnvelope[] = [], lookups: unknown[] = []
  let lastReceipt = { version: state.workspace.version, result: { entityId: parent.id, message: '已完成，获得 1 点经验' } }
  await context.route('**/api/adventure**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined
    requests.push({ path, body })
    const basis = { version: state.workspace.version, today: state.workspace.today, timeZone: 'Asia/Shanghai' }
    if (path === '/api/adventure/compatibility') return route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } })
    if (path === '/api/adventure/receipts/lookup') { lookups.push(body); return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Model': 'goal-categories-1' }, json: { requestId: body.requestId, nonce: body.nonce, receipt: lastReceipt } }) }
    if (path === '/api/adventure/recovery') { lookups.push(body); return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: { requestId: body.requestId, nonce: body.nonce, outcome: 'confirmed', receipt: lastReceipt } }) }
    if (path === '/api/adventure') {
      if (queryFailure) { queryFailure = false; return route.fulfill({ status: 503, json: { error: { message: '读取失败' } } }) }
      return route.fulfill({ json: state.workspace })
    }
    if (path === '/api/adventure/recurring/detail') return route.fulfill({ json: { ...basis, parent: state.parents.find(parent => parent.id === body.id) } })
    if (path === '/api/adventure/recurring/child') return route.fulfill({ json: { ...basis, child: state.children.find(child => child.id === body.id) } })
    if (path === '/api/adventure/recurring/children') {
      const items = state.children.filter(child => child.parentId === body.parentId && child.status === 'completed')
      return route.fulfill({ json: { ...basis, parentId: body.parentId, page: body.page, pageSize: 10, total: items.length, children: items.slice((body.page - 1) * 10, body.page * 10) } })
    }
    if (path === '/api/adventure/recurring/list') {
      const parents = state.parents.filter(parent => (parent.status === 'active' && body.date === state.workspace.today || parent.status === 'not_started' && body.date === parent.startOn || parent.status === 'ended' && body.date === parent.endedOn) && `${parent.title} ${parent.description} ${parent.goalTitle}`.includes(body.search))
      return route.fulfill({ json: { ...basis, ...body, pageSize: 10, total: parents.length, parents: parents.slice((body.page - 1) * 10, body.page * 10) } })
    }
    if (path === '/api/adventure/date-tasks/list') {
      const tasks = [...state.workspace.tasks.filter(task => task.status === 'completed' ? task.completedOn === body.date
        : task.status === 'pending' && body.date >= state.workspace.today && (body.date === state.workspace.today ? task.plannedOn <= body.date : task.plannedOn === body.date)).map(task => ({ ...task, kind: 'once' })), ...state.children.filter(child => child.status === 'completed' && child.snapshot.occurredOn === body.date)]
        .filter(task => `${'snapshot' in task ? `${task.snapshot.title} ${task.snapshot.description} ${task.snapshot.goalTitle}` : `${task.title} ${task.description} ${task.goalTitle}`}`.includes(body.search))
      const completed = tasks.filter(task => task.status === 'completed').length
      const progress = body.date === state.workspace.today && !body.search ? state.workspace.todayTaskProgress : { completed, total: tasks.length, ratio: tasks.length ? completed / tasks.length : null }
      return route.fulfill({ json: { ...basis, ...body, pageSize: 10, total: tasks.length, tasks: tasks.slice((body.page - 1) * 10, body.page * 10), progress } })
    }
    if (path === '/api/adventure/preview') return route.fulfill({ json: { version: state.workspace.version, today: state.workspace.today, allowed: true, message: '请确认', operation: body.command.type, entityId: body.command.id, title: state.parents.find(parent => parent.id === body.command.id)?.title, requiresConfirmation: true, effectiveChildren: 3, completedPeriods: 1 } })
    if (path === '/api/adventure/commands') {
      envelopes.push(body)
      if (commandDelay) await new Promise(resolve => setTimeout(resolve, commandDelay))
      if (failure) { const fault = failure; failure = undefined; state = next; return route.fulfill({ status: fault.status, json: { error: { code: fault.code, message: '请刷新后重新确认' } } }) }
      state = next
      lastReceipt = { version: state.workspace.version, result: { entityId: 'id' in body.command ? body.command.id : parent.id, message: body.command.type === 'cancelRecurringCompletion' ? '已撤销 · −1 经验' : '已完成，获得 1 点经验' } }
      if (responseLoss) { responseLoss = false; return route.abort('failed') }
      return route.fulfill({ json: lastReceipt })
    }
    if (path === '/api/adventure/task-history') return route.fulfill({ json: { version: state.workspace.version, taskId: uuid(200), title: '任务', page: 1, pageSize: 5, total: 0, items: [] } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'fixture 未配置' } } })
  })
  return { requests, envelopes, lookups, saved: (value: RecurringFixture) => { next = structuredClone(value) }, show: (value: RecurringFixture) => { state = structuredClone(value) }, fail: (status: number, code: string) => { failure = { status, code } }, loseResponse: () => { responseLoss = true }, failRead: () => { queryFailure = true }, delay: (value: number) => { commandDelay = value } }
}
