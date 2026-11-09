import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningPageSchema } from '../../src/shared/adventure-planning'

const adminUrl = process.env.WORKER_TEST_ADMIN_URL
describe.skipIf(!localPlanningRpc || !adminUrl)('人生冒险大集合仍在数据库内裁剪后返回', () => {
  const database = planningDatabase('boundaries@example.invalid')
  const admin = new Client({ connectionString: adminUrl! })
  beforeAll(() => admin.connect())
  afterAll(() => admin.end())
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  it('75 个长来源超过冻结封套时拒绝达成，版本与经验不变', async () => {
    const owner = crypto.randomUUID()
    const goal = (
      await database.command(owner, { type: 'createGoal', destination: '', title: '集合容量', standards: ['标准'] })
    ).result.entityId
    const state = planningPageSchema.parse(await database.read(owner))
    await admin.query(
      `with tasks as (
      insert into public.adventure_tasks(owner_id,goal_id,title,planned_on,status,completed_at,completed_on)
      select $1,$2,'历史任务',current_date,'completed',now(),current_date from generate_series(1,75) returning *
    ), planned as (
      select gen_random_uuid() event_id,t.* from tasks t
    ) insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,mainline_id,goal_id,occurred_at,occurred_on,actor_owner_id,amount,calculation,snapshot)
      select p.event_id,$1,gen_random_uuid(),'task_completed','task',p.id,p.id,g.mainline_id,g.id,p.completed_at,p.completed_on,$1,1,
        jsonb_build_object('type','fixed_task','completionId',p.event_id,'count',1,'coefficient',1),
        jsonb_build_object('title',p.title,'description','说明','plannedOn',p.planned_on,
          'result',jsonb_build_object('payload',repeat('x',100000),
            'reward',jsonb_build_object('amount',1,'calculation',jsonb_build_object('type','fixed_task','completionId',p.event_id,'count',1,'coefficient',1)),
            'completionId',p.event_id))
      from planned p join public.adventure_goals g on g.owner_id=p.owner_id and g.id=p.goal_id`,
      [owner, goal]
    )
    await admin.query('update public.adventure_accounts set total_xp=75 where owner_id=$1', [owner])
    await admin.query(
      "update public.adventure_events set snapshot=jsonb_set(snapshot,'{description}',to_jsonb(repeat('界',4000))) where owner_id=$1 and kind='task_completed'",
      [owner]
    )
    const response = await database.send(
      owner,
      database.envelope(state.version, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '' })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'CAPACITY_REACHED' } })
    expect((await admin.query('select revision,total_xp from public.adventure_accounts where owner_id=$1', [owner])).rows[0]).toEqual({
      revision: '1',
      total_xp: '75',
    })
  }, 20_000)
})
