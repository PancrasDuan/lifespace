import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, validateMappings } from '../support/goal-migration-reconcile.mjs'

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
