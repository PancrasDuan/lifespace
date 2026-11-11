import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, validateMappings, isMappingFailure } from '../support/goal-migration-reconcile.mjs'

test('异常映射探针只接受带账户和目标标识的明确错误', () => {
  const expected = { code: 'GOAL_MIGRATION_INVALID_LABEL', ownerId: 'owner-a', goalId: 'goal-a' }
  assert.equal(isMappingFailure(new Error('GOAL_MIGRATION_INVALID_LABEL owner=owner-a goal=goal-a'), expected), true)
  for (const message of ['unrelated SQL failure', 'GOAL_MIGRATION_INVALID_LABEL', 'GOAL_MIGRATION_INVALID_MAPPING owner=owner-a goal=goal-a', 'GOAL_MIGRATION_INVALID_LABEL owner=owner-b goal=goal-a', 'GOAL_MIGRATION_INVALID_LABEL owner=owner-a goal=goal-b']) {
    assert.equal(isMappingFailure(new Error(message), expected), false)
  }
})

test('异常旧主线映射必须在升级前报告', () => {
  const before = { mainlines: [{ owner_id: 'a', id: 'm', kind: 'normal', name: '  标签  ' }], goals: [{ owner_id: 'a', id: 'g', kind: 'real', mainline_id: 'm' }] }
  assert.deepEqual(validateMappings(before), [])
  for (const change of [
    x => { x.mainlines[0].name = '   ' },
    x => { x.mainlines[0].name = '字'.repeat(201) },
    x => { x.goals[0].mainline_id = 'missing' },
    x => { x.mainlines[0].owner_id = 'other' },
  ]) {
    const bad = structuredClone(before)
    change(bad)
    assert.notDeepEqual(validateMappings(bad), [])
  }
})

test('逐账户和 ID 对账会发现等行数但事实、奖励或归属变化', () => {
  const legacy = {
    accounts: [{ owner_id: 'a', total_xp: 1, revision: 4, time_zone: 'Asia/Shanghai' }],
    mainlines: [{ owner_id: 'a', id: 'm', kind: 'normal', name: '同名', created_at: '2020-01-01' }],
    goals: [{ owner_id: 'a', id: 'g', mainline_id: 'm', kind: 'real', status: 'active', focused: true, sort_order: 0, title: '同名', attainment_snapshot: null }],
    tasks: [{ owner_id: 'a', id: 't', goal_id: 'g', end_cause: null, title: '同名' }],
    events: [{ owner_id: 'a', id: 'e', kind: 'task_completed', mainline_id: 'm', amount: 1, invalidated_at: null, snapshot: { title: '同名', mainlineName: '同名', result: { reward: { amount: 1 } } }, calculation: { count: 1 } }],
  }
  const migrated = {
    accounts: structuredClone(legacy.accounts),
    goals: [{ owner_id: 'a', id: 'g', kind: 'real', status: 'active', focused: true, sort_order: 0, title: '同名', attainment_snapshot: null, category_label: '同名' }],
    tasks: structuredClone(legacy.tasks),
    events: [{ owner_id: 'a', id: 'e', kind: 'task_completed', amount: 1, invalidated_at: null, snapshot: { title: '同名', result: { reward: { amount: 1 } } }, calculation: { count: 1 } }],
  }
  assert.deepEqual(reconcile(legacy, migrated), [])
  for (const change of [
    x => { x.accounts[0].revision++ },
    x => { x.goals[0].category_label = null },
    x => { x.tasks[0].goal_id = 'other' },
    x => { x.events[0].snapshot.result.reward.amount++ },
    x => { x.events[0].owner_id = 'other' },
    x => { x.events[0].snapshot.mainlineName = '同名' },
  ]) {
    const bad = structuredClone(migrated)
    change(bad)
    assert.notDeepEqual(reconcile(legacy, bad), [])
  }
})

test('每个账户的进行中目标必须有合法排序键，即使只有一条', () => {
  const owners = ['a', 'b']
  const before = {
    accounts: owners.map(owner_id => ({ owner_id, total_xp: 0 })),
    mainlines: owners.map(owner_id => ({ owner_id, id: `m${owner_id}`, kind: 'normal', name: '标签', created_at: '2020-01-01' })),
    goals: owners.map(owner_id => ({ owner_id, id: `g${owner_id}`, mainline_id: `m${owner_id}`, kind: 'real', status: 'active', focused: false, sort_order: 0 })),
    tasks: [], events: [],
  }
  const after = { accounts: structuredClone(before.accounts), tasks: [], events: [], goals: owners.map(owner_id => ({ owner_id, id: `g${owner_id}`, kind: 'real', status: 'active', focused: false, sort_order: 0, category_label: '标签' })) }
  assert.deepEqual(reconcile(before, after), [])
  for (const owner of owners) for (const invalid of [undefined, null, '0', NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(after)
    const goal = bad.goals.find(row => row.owner_id === owner)
    if (invalid === undefined) delete goal.sort_order
    else goal.sort_order = invalid
    assert.ok(reconcile(before, bad).some(error => error.includes(`${owner}/g${owner}`) && error.includes('sort_order')), `${owner}: ${String(invalid)}`)
  }
})
