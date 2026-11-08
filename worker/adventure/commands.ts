import type { PlanningCommand } from '../../src/shared/adventure-planning'
import { reject, type Transaction } from '../database'
import {
  bounded,
  check,
  entity,
  growth,
  growthChange,
  growthMessage,
  independent,
  type Event,
  type Goal,
  type Mainline,
  type Task,
} from './model'

type CommandContext = {
  db: Transaction
  owner: string
  requestId: string
  version: number
  command: PlanningCommand
  now: string
  today: string
  digest: string
}
type Fact = {
  id?: string
  kind: string
  entityType: string
  entityId: string
  mainlineId: string
  goalId?: string | null
  taskId?: string
  amount?: number
  calculation?: unknown
  snapshot: Record<string, unknown>
}
async function fact(ctx: CommandContext, value: Fact) {
  const id = value.id ?? crypto.randomUUID()
  await ctx.db.rows(
    `insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,mainline_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2,$12,$13,$14,$15,$16,$17,$18,$10)`,
    [
      id,
      ctx.owner,
      crypto.randomUUID(),
      value.kind,
      value.entityType,
      value.entityId,
      value.taskId ?? null,
      value.mainlineId,
      value.goalId ?? null,
      ctx.now,
      ctx.today,
      ctx.requestId,
      ctx.digest,
      ctx.command.type,
      ctx.version + 1,
      value.amount ?? null,
      value.calculation ? JSON.stringify(value.calculation) : null,
      JSON.stringify(value.snapshot),
    ]
  )
  return id
}
async function settle(ctx: CommandContext, eventId: string, result: Record<string, unknown>, xpDelta = 0) {
  bounded(result, 1_000_000)
  await ctx.db.rows(
    "update public.adventure_events set snapshot=snapshot || jsonb_build_object('result',$3::jsonb) where owner_id=$1 and id=$2",
    [ctx.owner, eventId, JSON.stringify(result)]
  )
  await ctx.db.rows('update public.adventure_accounts set total_xp=total_xp+$3,revision=$4,updated_at=$2 where owner_id=$1', [
    ctx.owner,
    ctx.now,
    xpDelta,
    ctx.version + 1,
  ])
  await consistent(ctx.db, ctx.owner)
  return { version: ctx.version + 1, result }
}
export async function consistent(db: Transaction, owner: string) {
  const row = await db.one(
    `select a.total_xp=(select coalesce(sum(amount),0) from public.adventure_events
    where owner_id=$1 and kind in ('task_completed','goal_achieved') and invalidated_at is null) valid from public.adventure_accounts a where owner_id=$1`,
    [owner]
  )
  if (!row.valid) reject('INCONSISTENT_REWARDS')
}
export async function goalReward(db: Transaction, owner: string, id: string, coefficient: number) {
  // Strip successful receipts in SQL and enforce the historical jsonb size
  // limit before transferring sources to the Worker. The SQL reward header
  // exists only to measure that same envelope; TypeScript decides the reward.
  const row = await db.one<{ count: string; facts: { actionIds: string[]; actionSources: Array<Record<string, unknown>> } | null }>(
    `
    with actions as materialized (
      select distinct on(task_id) task_id,id,mainline_id,goal_id,occurred_on,snapshot-'result' source
      from public.adventure_events where owner_id=$1 and goal_id=$2 and kind='task_completed' and invalidated_at is null
      order by task_id,occurred_at,id
    ), collected as (
      select count(*) count,coalesce(jsonb_agg(task_id order by task_id),'[]') ids,
        coalesce(jsonb_agg(jsonb_build_object('taskId',task_id,'completionId',id,'mainlineId',mainline_id,
          'goalId',goal_id,'occurredOn',occurred_on,'source',source) order by task_id),'[]') sources from actions
    ), measured as (
      select *,jsonb_build_object('reward',jsonb_build_object('amount',case when count=0 then 1 else count*$3::integer end,
        'calculation',jsonb_build_object('type','goal_actions','actionIds',ids,'count',count,'coefficient',$3::integer,'fallback',count=0)),
        'actionSources',sources) plan from collected
    ) select count,case when octet_length(plan::text)<=900000 then jsonb_build_object('actionIds',ids,'actionSources',sources) end facts
      from measured`,
    [owner, id, coefficient]
  )
  if (!row.facts) reject('CAPACITY_REACHED')
  const count = Number(row.count)
  return {
    reward: {
      amount: count ? count * coefficient : 1,
      calculation: { type: 'goal_actions', actionIds: row.facts.actionIds, count, coefficient, fallback: count === 0 },
    },
    actionSources: row.facts.actionSources,
  }
}
export async function impact(db: Transaction, owner: string, command: PlanningCommand) {
  if (command.type === 'deleteTask') {
    const task = await entity<Task>(db, owner, 'tasks', command.id),
      goal = await entity<Goal>(db, owner, 'goals', task.goal_id)
    return {
      operation: command.type,
      entityId: task.id,
      title: task.title,
      stoppingGoals: [],
      stoppingTasks: [],
      preservedCompletedTasks: 0,
      preservedAchievedGoals: 0,
      historicalArrangements: Number(
        (
          await db.one("select count(*) from public.adventure_events where owner_id=$1 and task_id=$2 and kind='task_rescheduled'", [
            owner,
            task.id,
          ])
        ).count
      ),
      goalId: goal.kind === 'real' ? goal.id : null,
      plannedOn: task.planned_on,
    }
  }
  if (command.type !== 'endGoal' && command.type !== 'endMainline') reject('INVALID_COMMAND')
  const isGoal = command.type === 'endGoal'
  const current = isGoal ? await entity<Goal>(db, owner, 'goals', command.id) : await entity<Mainline>(db, owner, 'mainlines', command.id)
  const completed = await db.one(
    `select count(*) from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.owner_id=$1 and ${isGoal ? 'g.id=$2' : "g.mainline_id=$2 and g.kind='real'"} and t.status='completed' and t.deleted_at is null`,
    [owner, command.id]
  )
  const stoppingGoals = isGoal
    ? []
    : await db.rows(
        "select id,title from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='active' order by sort_order,id",
        [owner, command.id]
      )
  const achieved = isGoal
    ? 0
    : Number(
        (
          await db.one(
            "select count(*) from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='achieved'",
            [owner, command.id]
          )
        ).count
      )
  return bounded({
    operation: command.type,
    entityId: current.id,
    title: 'title' in current ? current.title : current.name,
    stoppingGoals,
    stoppingTasks: [],
    preservedCompletedTasks: Number(completed.count),
    preservedAchievedGoals: achieved,
  })
}

async function taskCommand(ctx: CommandContext) {
  const { db, owner, command, now, today } = ctx
  let task: Task,
    goal: Goal,
    before: Task | null = null,
    done: Event | null = null,
    kind: string
  const beforeGrowth = await growth(db, owner)
  if (command.type === 'createTask' || command.type === 'editTask') {
    goal = command.destination ? await entity<Goal>(db, owner, 'goals', command.destination) : (await independent(db, owner, now)).inbox
    if (command.type === 'createTask') {
      task = (
        await db.one(
          `insert into public.adventure_tasks(owner_id,goal_id,title,description,planned_on,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$6) returning to_jsonb(adventure_tasks)-'owner_id' value`,
          [owner, goal.id, command.title, command.description, command.plannedOn, now]
        )
      ).value
      kind = 'task_created'
    } else {
      before = await entity<Task>(db, owner, 'tasks', command.id)
      task = (
        await db.one(
          `update public.adventure_tasks set goal_id=$3,title=$4,description=$5,planned_on=$6,updated_at=$7
        where owner_id=$1 and id=$2 returning to_jsonb(adventure_tasks)-'owner_id' value`,
          [owner, command.id, goal.id, command.title, command.description, command.plannedOn, now]
        )
      ).value
      kind =
        before!.planned_on !== task.planned_on ? 'task_rescheduled' : before!.goal_id !== task.goal_id ? 'task_migrated' : 'task_updated'
    }
  } else {
    if (command.type === 'cancelTaskCompletion') {
      done = await entity<Event>(db, owner, 'events', command.completionId)
      task = await entity<Task>(db, owner, 'tasks', done.task_id)
    } else if (command.type === 'completeTask' || command.type === 'deleteTask') task = await entity<Task>(db, owner, 'tasks', command.id)
    else return reject('INVALID_COMMAND')
    before = task
    goal = await entity<Goal>(db, owner, 'goals', task.goal_id)
    const update =
      command.type === 'completeTask'
        ? "status='completed',completed_at=$3,completed_on=$4"
        : command.type === 'deleteTask'
          ? 'deleted_at=$3'
          : "status='pending',completed_at=null,completed_on=null"
    task = (
      await db.one(
        `update public.adventure_tasks set ${update},updated_at=$3 where owner_id=$1 and id=$2 returning to_jsonb(adventure_tasks)-'owner_id' value`,
        command.type === 'completeTask' ? [owner, task.id, now, today] : [owner, task.id, now]
      )
    ).value
    kind = command.type === 'completeTask' ? 'task_completed' : command.type === 'deleteTask' ? 'task_deleted' : 'task_completion_cancelled'
  }
  const mainline = await entity<Mainline>(db, owner, 'mainlines', goal.mainline_id),
    eventId = crypto.randomUUID()
  const delta = command.type === 'completeTask' ? 1 : done ? -done.amount : 0
  const reward =
    command.type === 'completeTask'
      ? { amount: 1, calculation: { type: 'fixed_task', completionId: eventId, count: 1, coefficient: 1 } }
      : done
        ? { amount: done.amount, calculation: done.calculation }
        : null
  const snapshot: Record<string, unknown> = {
    before,
    after: task,
    title: task.title,
    description: task.description,
    completionId: done?.id ?? null,
    plannedOn: task.planned_on,
    mainlineName: mainline.name,
    mainlineKind: mainline.kind,
    goalTitle: goal.kind === 'real' ? goal.title : null,
    goalStandards: goal.kind === 'real' ? goal.standards : null,
    impact: command.type === 'deleteTask' ? await impact(db, owner, command) : null,
  }
  if (kind === 'task_rescheduled') {
    snapshot.oldPlannedOn = before!.planned_on
    snapshot.newPlannedOn = task.planned_on
    snapshot.sourceEventId =
      (
        await db.rows(
          "select id from public.adventure_events where owner_id=$1 and task_id=$2 and kind in ('task_created','task_rescheduled') order by applied_revision desc,id desc limit 1",
          [owner, task.id]
        )
      )[0]?.id ?? null
  }
  if (before && before.goal_id !== task.goal_id) {
    const originGoal = await entity<Goal>(db, owner, 'goals', before.goal_id),
      originMain = await entity<Mainline>(db, owner, 'mainlines', originGoal.mainline_id)
    snapshot.origin = {
      goalId: originGoal.kind === 'real' ? originGoal.id : null,
      goalTitle: originGoal.kind === 'real' ? originGoal.title : null,
      mainlineId: originMain.id,
      mainlineName: originMain.name,
    }
  }
  await fact(ctx, {
    id: eventId,
    kind,
    entityType: 'task',
    entityId: task.id,
    taskId: task.id,
    mainlineId: mainline.id,
    goalId: goal.kind === 'real' ? goal.id : null,
    amount: command.type === 'completeTask' ? 1 : undefined,
    calculation: command.type === 'completeTask' ? reward!.calculation : undefined,
    snapshot,
  })
  if (done)
    await db.rows(
      'update public.adventure_events set invalidated_at=$3,invalidated_by_event_id=$4 where owner_id=$1 and id=$2 and invalidated_at is null',
      [owner, done.id, now, eventId]
    )
  // Preview growth from the just-written facts before updating the aggregate.
  const afterGrowth = await growth(db, owner, delta),
    change = growthChange(beforeGrowth, afterGrowth, delta)
  const message =
    command.type === 'createTask'
      ? '已创建任务'
      : command.type === 'editTask'
        ? '已保存任务'
        : command.type === 'deleteTask'
          ? '未完成任务已删除'
          : done
            ? '已取消完成，成长已同步更新'
            : '已完成，获得 1 点经验' + growthMessage(beforeGrowth, afterGrowth, change.unlocked)
  return settle(
    ctx,
    eventId,
    {
      entityId: task.id,
      message,
      completionId: command.type === 'completeTask' ? eventId : (done?.id ?? null),
      reward,
      growthChange: change,
    },
    delta
  )
}

async function achieve(ctx: CommandContext, command: Extract<PlanningCommand, { type: 'achieveGoal' }>) {
  const { db, owner, now, today } = ctx
  const goal = await entity<Goal>(db, owner, 'goals', command.id),
    mainline = await entity<Mainline>(db, owner, 'mainlines', goal.mainline_id)
  const before = await growth(db, owner),
    plan = await goalReward(db, owner, goal.id, command.coefficient),
    amount = plan.reward.amount
  if (before.totalXp > Number.MAX_SAFE_INTEGER - amount) reject('CAPACITY_REACHED')
  const source = bounded({
    goalId: goal.id,
    title: goal.title,
    standards: goal.standards,
    mainlineId: mainline.id,
    mainlineName: mainline.name,
    mainlineKind: mainline.kind,
    actionSources: plan.actionSources,
    stoppedTasks: [],
  })
  await db.rows(
    `update public.adventure_goals set status='achieved',focused=false,terminated_at=$3,termination_cause='achieved',achieved_at=$3,achieved_on=$4,
    attainment_coefficient=$5,attainment_reflection=$6,attainment_action_count=$7,attainment_action_ids=$8::uuid[],attainment_snapshot=$9,updated_at=$3
    where owner_id=$1 and id=$2`,
    [
      owner,
      goal.id,
      now,
      today,
      command.coefficient,
      command.reflection,
      plan.reward.calculation.count,
      plan.reward.calculation.actionIds,
      JSON.stringify(source),
    ]
  )
  const eventId = await fact(ctx, {
    kind: 'goal_achieved',
    entityType: 'goal',
    entityId: goal.id,
    mainlineId: mainline.id,
    goalId: goal.id,
    amount,
    calculation: plan.reward.calculation,
    snapshot: { ...source, before: goal, reflection: command.reflection },
  })
  const after = await growth(db, owner, amount),
    change = growthChange(before, after, amount)
  return settle(
    ctx,
    eventId,
    {
      entityId: goal.id,
      achievementId: eventId,
      reward: plan.reward,
      message: `目标已达成，获得 ${amount} 点经验` + growthMessage(before, after, change.unlocked),
      growthChange: change,
    },
    amount
  )
}
async function end(ctx: CommandContext, command: Extract<PlanningCommand, { type: 'endGoal' | 'endMainline' }>) {
  const { db, owner, now } = ctx,
    endingGoal = command.type === 'endGoal'
  const affected = await impact(db, owner, command)
  const before = endingGoal
    ? await entity<Goal>(db, owner, 'goals', command.id)
    : await entity<Mainline>(db, owner, 'mainlines', command.id)
  let after: unknown, mainlineId: string
  if (endingGoal) {
    mainlineId = (before as Goal).mainline_id
    after = (
      await db.one(
        `update public.adventure_goals set status='ended',focused=false,terminated_at=$3,termination_cause='ended',updated_at=$3
      where owner_id=$1 and id=$2 returning to_jsonb(adventure_goals)-'owner_id' value`,
        [owner, command.id, now]
      )
    ).value
  } else {
    mainlineId = command.id
    after = (
      await db.one(
        `update public.adventure_mainlines set status='ended',ended_at=$3,updated_at=$3 where owner_id=$1 and id=$2 returning to_jsonb(adventure_mainlines)-'owner_id' value`,
        [owner, command.id, now]
      )
    ).value
    await db.rows(
      "update public.adventure_goals set status='ended',focused=false,terminated_at=$3,termination_cause='mainline_ended',updated_at=$3 where owner_id=$1 and mainline_id=$2 and kind='real' and status='active'",
      [owner, command.id, now]
    )
  }
  const eventId = await fact(ctx, {
    kind: endingGoal ? 'goal_ended' : 'mainline_ended',
    entityType: endingGoal ? 'goal' : 'mainline',
    entityId: before.id,
    mainlineId,
    goalId: endingGoal ? before.id : null,
    snapshot: { before, after, impact: affected },
  })
  return settle(ctx, eventId, { entityId: before.id, message: endingGoal ? '目标已结束' : '主线已结束，进行中目标已结束' })
}
async function planning(ctx: CommandContext) {
  const { db, owner, command, now } = ctx
  let before: unknown = null,
    after: unknown,
    kind: string,
    entityId: string,
    mainlineId: string,
    goalId: string | null = null,
    origin: unknown = null
  if (command.type === 'createMainline' || command.type === 'renameMainline') {
    if (command.type === 'renameMainline') before = await entity<Mainline>(db, owner, 'mainlines', command.id)
    const mainline: Mainline =
      command.type === 'createMainline'
        ? (
            await db.one(
              "insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at) values($1,'normal',$2,$3,$3) returning to_jsonb(adventure_mainlines)-'owner_id' value",
              [owner, command.name, now]
            )
          ).value
        : (
            await db.one(
              "update public.adventure_mainlines set name=$3,updated_at=$4 where owner_id=$1 and id=$2 returning to_jsonb(adventure_mainlines)-'owner_id' value",
              [owner, command.id, command.name, now]
            )
          ).value
    entityId = mainlineId = mainline.id
    after = mainline
    kind = command.type === 'createMainline' ? 'mainline_created' : 'mainline_updated'
  } else if (command.type === 'createGoal' || command.type === 'editGoal' || command.type === 'migrateGoal') {
    const mainline =
      !command.destination || command.destination === 'independent'
        ? (await independent(db, owner, now)).mainline
        : await entity<Mainline>(db, owner, 'mainlines', command.destination)
    const old = command.type === 'createGoal' ? null : await entity<Goal>(db, owner, 'goals', command.id)
    const order =
      old?.mainline_id === mainline.id
        ? old.sort_order
        : Number(
            (
              await db.one(
                "select coalesce(max(sort_order),-1)+1 value from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real'",
                [owner, mainline.id]
              )
            ).value
          )
    if (!Number.isSafeInteger(order)) reject('CAPACITY_REACHED')
    const goal: Goal =
      command.type === 'createGoal'
        ? (
            await db.one(
              `insert into public.adventure_goals(owner_id,mainline_id,title,standards,sort_order,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$6) returning to_jsonb(adventure_goals)-'owner_id' value`,
              [owner, mainline.id, command.title, JSON.stringify(command.standards), order, now]
            )
          ).value
        : (
            await db.one(
              `update public.adventure_goals set mainline_id=$3,title=$4,standards=$5,sort_order=$6,updated_at=$7 where owner_id=$1 and id=$2 returning to_jsonb(adventure_goals)-'owner_id' value`,
              [
                owner,
                old!.id,
                mainline.id,
                command.type === 'editGoal' ? command.title : old!.title,
                JSON.stringify(command.type === 'editGoal' ? command.standards : old!.standards),
                order,
                now,
              ]
            )
          ).value
    kind = old ? (old.mainline_id !== mainline.id ? 'goal_migrated' : 'goal_updated') : 'goal_created'
    if (kind === 'goal_migrated') {
      const from = await entity<Mainline>(db, owner, 'mainlines', old!.mainline_id)
      origin = { mainlineId: from.id, mainlineName: from.name }
    }
    before = old
    after = goal
    entityId = goalId = goal.id
    mainlineId = mainline.id
  } else if (command.type === 'focusGoal' || command.type === 'reorderGoals') {
    const goal = await entity<Goal>(db, owner, 'goals', command.id)
    entityId = goalId = goal.id
    mainlineId = goal.mainline_id
    before = goal
    if (command.type === 'focusGoal') {
      after = (
        await db.one(
          "update public.adventure_goals set focused=$3,updated_at=$4 where owner_id=$1 and id=$2 returning to_jsonb(adventure_goals)-'owner_id' value",
          [owner, goal.id, command.focused, now]
        )
      ).value
      kind = 'goal_focused'
    } else {
      const ids = async () =>
        (
          await db.rows(
            "select id from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='active' order by sort_order,id",
            [owner, goal.mainline_id]
          )
        ).map((row) => row.id as string)
      before = { goalIds: await ids() }
      const group = (
        await db.rows(
          "select id from public.adventure_goals where owner_id=$1 and mainline_id=$2 and kind='real' and status='active' and focused=$3 order by sort_order,id",
          [owner, goal.mainline_id, goal.focused]
        )
      ).map((row) => row.id as string)
      const index = group.indexOf(goal.id),
        target = command.targetId
          ? group.indexOf(command.targetId.toLowerCase())
          : Math.max(0, Math.min(group.length - 1, index + (command.direction === 'up' ? -1 : 1)))
      group.splice(index, 1)
      group.splice(target, 0, goal.id)
      await db.rows(
        `update public.adventure_goals g set sort_order=s.n,updated_at=$3 from unnest($2::uuid[]) with ordinality s(id,n) where g.owner_id=$1 and g.id=s.id`,
        [owner, group, now]
      )
      after = { goalIds: await ids() }
      kind = 'goal_reordered'
    }
  } else return reject('INVALID_COMMAND')
  const eventId = await fact(ctx, {
    kind,
    entityType: goalId ? 'goal' : 'mainline',
    entityId,
    mainlineId,
    goalId,
    snapshot: { before, after, origin },
  })
  return settle(ctx, eventId, {
    entityId,
    message: command.type === 'createMainline' || command.type === 'createGoal' ? '已创建' : '已保存',
  })
}

export async function applyCommand(db: Transaction, owner: string, requestId: string, expectedVersion: number, command: PlanningCommand) {
  await db.rows('insert into public.adventure_accounts(owner_id) values($1) on conflict do nothing', [owner])
  const account = await db.one('select revision from public.adventure_accounts where owner_id=$1 for update', [owner])
  const digest = (await db.one("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') value", [JSON.stringify(command)]))
    .value as string
  const prior = (
    await db.rows('select command_hash,applied_revision,snapshot from public.adventure_events where owner_id=$1 and request_id=$2', [
      owner,
      requestId,
    ])
  )[0]
  if (prior) {
    if (prior.command_hash !== digest) reject('REQUEST_ID_REUSED')
    return { version: Number(prior.applied_revision), result: prior.snapshot.result }
  }
  if (['rescheduleTask', 'migrateTask', 'endTask'].includes(command.type)) reject('INVALID_COMMAND')
  const version = Number(account.revision)
  if (version !== expectedVersion) reject('VERSION_CONFLICT')
  if (version >= Number.MAX_SAFE_INTEGER) reject('CAPACITY_REACHED')
  const clock = await db.one(
    "select t::text now,(t at time zone 'Asia/Shanghai')::date::text today from (select clock_timestamp() t) clock"
  )
  await check(db, owner, command, clock.today)
  const ctx: CommandContext = { db, owner, requestId, version, command, now: clock.now, today: clock.today, digest }
  if (['createTask', 'editTask', 'completeTask', 'cancelTaskCompletion', 'deleteTask'].includes(command.type)) return taskCommand(ctx)
  if (command.type === 'achieveGoal') return achieve(ctx, command)
  if (command.type === 'endGoal' || command.type === 'endMainline') return end(ctx, command)
  return planning(ctx)
}
