import type { z } from 'zod'
import { growthSchema, type PlanningCommand } from '../../src/shared/adventure-planning'
import { reject, type Transaction } from '../database'

export type Mainline = { id: string; kind: string; name: string; status: string }
export type Goal = {
  id: string
  mainline_id: string
  kind: string
  title: string
  standards: string[]
  status: string
  focused: boolean
  sort_order: number
}
export type Task = {
  id: string
  goal_id: string
  title: string
  description: string
  planned_on: string
  status: string
  completed_on: string | null
  completed_at: string | null
  deleted_at: string | null
}
export type Event = {
  id: string
  kind: string
  task_id: string
  goal_id: string | null
  mainline_id: string
  occurred_on: string
  occurred_at: string
  amount: number
  calculation: Record<string, unknown>
  invalidated_at: string | null
  snapshot: Record<string, unknown>
}
export type Growth = z.infer<typeof growthSchema>
export type EntityTable = 'mainlines' | 'goals' | 'tasks' | 'events'

export async function entity<T>(db: Transaction, owner: string, table: EntityTable, id: string): Promise<T> {
  const row = (
    await db.rows(`select to_jsonb(e)-'owner_id' value from public.adventure_${table} e where owner_id=$1 and id=$2`, [owner, id])
  )[0]
  return row?.value ?? reject('NOT_FOUND')
}
export async function activeGoal(db: Transaction, owner: string, id: string, real = true) {
  const goal = await entity<Goal>(db, owner, 'goals', id)
  if (real && goal.kind !== 'real') reject('NOT_FOUND')
  if (goal.status !== 'active' || (await entity<Mainline>(db, owner, 'mainlines', goal.mainline_id)).status !== 'active')
    reject('READ_ONLY')
  return goal
}
export async function count(db: Transaction, sql: string, args: unknown[]) {
  return Number((await db.one(sql, args)).count)
}
export async function check(db: Transaction, owner: string, command: PlanningCommand, today: string): Promise<void> {
  const type = command.type
  if (['rescheduleTask', 'migrateTask', 'endTask'].includes(type)) reject('INVALID_COMMAND')
  if (type === 'createTask') {
    if (command.plannedOn < today) reject('RESCHEDULE_PAST')
    if (command.destination) await activeGoal(db, owner, command.destination)
    return
  }
  if (type === 'cancelTaskCompletion') {
    const done = await entity<Event>(db, owner, 'events', command.completionId)
    if (done.kind !== 'task_completed') reject('NOT_FOUND')
    if (done.invalidated_at) reject('COMPLETION_CHANGED')
    if (done.occurred_on !== today) reject('DATE_LOCKED')
    const task = await entity<Task>(db, owner, 'tasks', done.task_id)
    if (task.deleted_at) reject('NOT_FOUND')
    if (task.status === 'ended') reject('READ_ONLY')
    if (task.status !== 'completed' || task.completed_on !== today || task.completed_at !== done.occurred_at) reject('COMPLETION_CHANGED')
    if (
      (done.goal_id && (await entity<Goal>(db, owner, 'goals', done.goal_id)).status !== 'active') ||
      (await entity<Mainline>(db, owner, 'mainlines', done.mainline_id)).status !== 'active'
    )
      reject('READ_ONLY')
    await activeGoal(db, owner, task.goal_id, false)
    return
  }
  if (type === 'editTask' || type === 'completeTask' || type === 'deleteTask') {
    if (type === 'editTask' && (command.plannedOn === undefined || command.destination === undefined)) reject('INVALID_COMMAND')
    const task = await entity<Task>(db, owner, 'tasks', command.id)
    if (task.deleted_at) reject('NOT_FOUND')
    if (task.status === 'ended') reject('READ_ONLY')
    if (task.status !== 'pending') reject('TASK_NOT_PENDING')
    if (type === 'editTask') {
      if (command.plannedOn === undefined || command.destination === undefined) reject('INVALID_COMMAND')
      if (command.plannedOn < today && command.plannedOn !== task.planned_on) reject('RESCHEDULE_PAST')
      if (command.destination) await activeGoal(db, owner, command.destination)
    }
    if (type === 'completeTask' && task.planned_on > today) reject('DATE_LOCKED')
    await activeGoal(db, owner, task.goal_id, false)
    return
  }
  if (type === 'createMainline') {
    if (
      (await count(db, "select count(*) from public.adventure_mainlines where owner_id=$1 and kind='normal' and status='active'", [
        owner,
      ])) >= 5
    )
      reject('MAINLINE_LIMIT')
    return
  }
  if (type === 'renameMainline' || type === 'endMainline') {
    const mainline = await entity<Mainline>(db, owner, 'mainlines', command.id)
    if (mainline.kind !== 'normal') reject('NOT_FOUND')
    if (mainline.status !== 'active') reject('READ_ONLY')
    if (
      type === 'endMainline' &&
      (await count(
        db,
        `select count(*) from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
      where t.owner_id=$1 and g.mainline_id=$2 and t.status='pending' and t.deleted_at is null`,
        [owner, mainline.id]
      ))
    )
      reject('PENDING_TASKS')
    return
  }
  if (type === 'createGoal') {
    if (command.destination && command.destination !== 'independent') {
      const mainline = await entity<Mainline>(db, owner, 'mainlines', command.destination)
      if (mainline.kind !== 'normal') reject('NOT_FOUND')
      if (mainline.status !== 'active') reject('READ_ONLY')
    }
    return
  }
  if (
    type === 'editGoal' ||
    type === 'migrateGoal' ||
    type === 'focusGoal' ||
    type === 'achieveGoal' ||
    type === 'endGoal' ||
    type === 'reorderGoals'
  ) {
    const goal = await activeGoal(db, owner, command.id)
    if (
      (type === 'achieveGoal' || type === 'endGoal') &&
      (await count(
        db,
        "select count(*) from public.adventure_tasks where owner_id=$1 and goal_id=$2 and status='pending' and deleted_at is null",
        [owner, goal.id]
      ))
    )
      reject('PENDING_TASKS')
    if (
      type === 'focusGoal' &&
      command.focused &&
      !goal.focused &&
      (await count(
        db,
        "select count(*) from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='active' and focused and id<>$3",
        [owner, goal.mainline_id, goal.id]
      )) >= 3
    )
      reject('FOCUS_LIMIT')
    if (type === 'editGoal' || type === 'migrateGoal') {
      const mainline =
        command.destination && command.destination !== 'independent'
          ? await entity<Mainline>(db, owner, 'mainlines', command.destination)
          : ((
              await db.rows(
                "select to_jsonb(m)-'owner_id' value from public.adventure_mainlines m where owner_id=$1 and kind='independent'",
                [owner]
              )
            )[0]?.value as Mainline | undefined)
      if (
        command.destination &&
        command.destination !== 'independent' &&
        mainline?.kind !== 'normal' &&
        (type !== 'editGoal' || mainline?.id !== goal.mainline_id)
      )
        reject('NOT_FOUND')
      if (type === 'migrateGoal' && mainline?.id === goal.mainline_id) reject('SAME_DESTINATION')
      if (mainline && mainline.status !== 'active') reject('READ_ONLY')
      if (
        mainline &&
        mainline.id !== goal.mainline_id &&
        goal.focused &&
        (await count(
          db,
          "select count(*) from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='active' and focused",
          [owner, mainline.id]
        )) >= 3
      )
        reject('FOCUS_LIMIT')
    }
    if (type === 'reorderGoals') {
      const mainline = await entity<Mainline>(db, owner, 'mainlines', command.mainlineId)
      if (mainline.status !== 'active') reject('READ_ONLY')
      if (goal.mainline_id !== mainline.id) reject('NOT_FOUND')
      if (command.targetId) {
        const other = (
          await db.rows<{ value: Goal }>("select to_jsonb(g)-'owner_id' value from public.adventure_goals g where owner_id=$1 and id=$2", [
            owner,
            command.targetId,
          ])
        )[0]?.value
        if (
          !other ||
          other.id === goal.id ||
          other.mainline_id !== mainline.id ||
          other.kind !== 'real' ||
          other.status !== 'active' ||
          other.focused !== goal.focused
        )
          reject('INVALID_COMMAND')
      }
    }
    return
  }
  reject('INVALID_COMMAND')
}

export function bounded<T>(value: T, limit = 900_000): T {
  if (new TextEncoder().encode(JSON.stringify(value)).length > limit) reject('CAPACITY_REACHED')
  return value
}
export async function growth(db: Transaction, owner: string, xpDelta = 0, actionDelta = 0): Promise<Growth> {
  const row = await db.one(
    `select coalesce((select total_xp from public.adventure_accounts where owner_id=$1),0) xp,
    (select count(*) from public.adventure_events where owner_id=$1 and kind='task_completed' and invalidated_at is null) actions,
    (select count(*) from public.adventure_goals where owner_id=$1 and kind='real' and status='achieved') goals`,
    [owner]
  )
  const totalXp = Number(row.xp) + xpDelta,
    actions = Number(row.actions) + actionDelta,
    achievedGoals = Number(row.goals)
  if (!Number.isSafeInteger(totalXp) || totalXp < 0 || actions < 0) reject('INCONSISTENT_REWARDS')
  let n = BigInt(Math.floor((Math.sqrt(1225 + 40 * totalXp) - 35) / 10))
  const threshold = (value: bigint) => (value * (5n * value + 35n)) / 2n
  while (threshold(n) > BigInt(totalXp)) n--
  while (threshold(n + 1n) <= BigInt(totalXp)) n++
  const progress = Number(BigInt(totalXp) - threshold(n)),
    needed = 20 + 5 * Number(n)
  const badges = [
    ['actions', 1, '迈出第一步'],
    ['actions', 10, '十次行动'],
    ['actions', 50, '五十次行动'],
    ['actions', 100, '百次行动'],
    ['goals', 1, '首个成果'],
    ['goals', 3, '三个成果'],
    ['goals', 10, '十个成果'],
  ] as const
  return {
    level: Number(n) + 1,
    totalXp,
    progress,
    needed,
    remaining: needed - progress,
    actions,
    achievedGoals,
    achievements: badges.map(([kind, threshold, label]) => {
      const count = kind === 'actions' ? actions : achievedGoals
      return {
        id: `${kind}_${threshold}`,
        label,
        threshold,
        count,
        remaining: Math.max(0, threshold - count),
        unlocked: count >= threshold,
      }
    }),
  }
}
export function growthChange(before: Growth, after: Growth, xpDelta: number) {
  const unlocked = after.achievements
    .filter((a) => a.unlocked && !before.achievements.find((b) => b.id === a.id)?.unlocked)
    .map((a) => a.label)
  const lost = before.achievements.filter((b) => b.unlocked && !after.achievements.find((a) => a.id === b.id)?.unlocked).map((b) => b.label)
  return { xpDelta, before, after, unlocked, lost }
}
export function growthMessage(before: Growth, after: Growth, unlocked: string[]) {
  return (after.level > before.level ? `，升至 ${after.level} 级` : '') + (unlocked.length ? `，点亮：${unlocked.join('、')}` : '')
}

export async function independent(db: Transaction, owner: string, now: string): Promise<{ mainline: Mainline; inbox: Goal }> {
  let mainline = (
    await db.rows("select to_jsonb(m)-'owner_id' value from public.adventure_mainlines m where owner_id=$1 and kind='independent'", [owner])
  )[0]?.value as Mainline | undefined
  if (!mainline)
    mainline = (
      await db.one(
        `insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at)
    values($1,'independent','独立区',$2,$2) returning to_jsonb(adventure_mainlines)-'owner_id' value`,
        [owner, now]
      )
    ).value
  let inbox = (
    await db.rows("select to_jsonb(g)-'owner_id' value from public.adventure_goals g where owner_id=$1 and kind='inbox'", [owner])
  )[0]?.value as Goal | undefined
  if (!inbox)
    inbox = (
      await db.one(
        `insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
    values($1,$2,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]',$3,$3) returning to_jsonb(adventure_goals)-'owner_id' value`,
        [owner, mainline!.id, now]
      )
    ).value
  return { mainline: mainline!, inbox: inbox! }
}
