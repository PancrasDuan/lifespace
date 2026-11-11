import { isDeepStrictEqual } from 'node:util'

// Only structured field names are removed. User text, including identical names,
// is never searched or rewritten. Extend this explicit list if the old schema
// contains another mainline-bearing structured field.
const mainlineKeys = new Set(['mainline_id', 'mainlineId', 'mainlineName', 'mainlineKind', 'mainline_name', 'mainline_kind', 'mainlineType', 'mainline_type'])
function sanitize(value, taskEndCause) {
  if (Array.isArray(value)) return value.map(item => sanitize(item, taskEndCause))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !mainlineKeys.has(key)).map(([key, item]) => {
    if (item === 'mainline_ended' && ['termination_cause', 'terminationCause'].includes(key)) return [key, 'ended']
    if (item === 'mainline_ended' && ['end_cause', 'endCause'].includes(key)) return [key, taskEndCause]
    return [key, sanitize(item, taskEndCause)]
  }))
}

// Capture in the same session/transaction before and after migration. JSON is
// read by PostgreSQL to preserve all persisted columns, IDs, and nested values.
export async function capture(client, { legacy = false } = {}) {
  const result = {}
  for (const table of ['accounts', ...(legacy ? ['mainlines'] : []), 'goals', 'tasks', 'events']) {
    const { rows } = await client.query(`select to_jsonb(t) as row from public.adventure_${table} t order by owner_id${table === 'accounts' ? '' : ', id'}`)
    result[table] = rows.map(({ row }) => row)
  }
  return result
}

export function validateMappings(before) {
  const errors = []
  const mainlines = new Map(before.mainlines.map(m => [`${m.owner_id}/${m.id}`, m]))
  for (const goal of before.goals) {
    const mainline = mainlines.get(`${goal.owner_id}/${goal.mainline_id}`)
    if (!mainline || !['normal', 'independent'].includes(mainline.kind)) {
      errors.push(`goals ${goal.owner_id}/${goal.id}: invalid mainline mapping`)
    } else if (goal.kind === 'real' && mainline.kind === 'normal' &&
      (typeof mainline.name !== 'string' || [...mainline.name.trim()].length < 1 || [...mainline.name.trim()].length > 200)) {
      errors.push(`goals ${goal.owner_id}/${goal.id}: invalid category label`)
    }
  }
  return errors
}

export function reconcile(before, after, { taskEndCause = 'historical_ended' } = {}) {
  const errors = validateMappings(before)
  const key = (row, table) => table === 'accounts' ? row.owner_id : `${row.owner_id}/${row.id}`
  const mainlines = new Map(before.mainlines.map(m => [`${m.owner_id}/${m.id}`, m]))
  const clean = row => sanitize(row, taskEndCause)
  const project = (row, table) => {
    const value = clean(row)
    if (table === 'goals') {
      const mainline = mainlines.get(`${row.owner_id}/${row.mainline_id}`)
      if (!mainline) errors.push(`goals ${key(row, table)}: missing legacy mainline`)
      value.category_label = row.kind === 'real' && mainline?.kind === 'normal' ? mainline.name.trim() : null
      if (row.status === 'active' && row.kind === 'real') delete value.sort_order
    }
    return value
  }
  for (const table of ['accounts', 'goals', 'tasks', 'events']) {
    const oldRows = before[table].filter(row => table !== 'events' || !['mainline_created', 'mainline_updated', 'mainline_ended'].includes(row.kind))
    const oldMap = new Map(oldRows.map(row => [key(row, table), row]))
    const newMap = new Map(after[table].map(row => [key(row, table), row]))
    if (oldMap.size !== oldRows.length || newMap.size !== after[table].length) errors.push(`${table}: duplicate owner/id`)
    for (const [id, row] of oldMap) {
      const actual = newMap.get(id)
      if (!actual) { errors.push(`${table} ${id}: missing`); continue }
      const expected = project(row, table)
      const observed = structuredClone(actual)
      if (table === 'goals' && row.status === 'active' && row.kind === 'real') delete observed.sort_order
      if (!isDeepStrictEqual(expected, observed)) errors.push(`${table} ${id}: retained fields differ`)
    }
    for (const id of newMap.keys()) if (!oldMap.has(id)) errors.push(`${table} ${id}: unexpected`)
  }
  for (const account of after.accounts) {
    const sum = after.events.filter(e => e.owner_id === account.owner_id && ['task_completed', 'goal_achieved'].includes(e.kind) && e.invalidated_at == null).reduce((n, e) => n + BigInt(e.amount), 0n)
    if (BigInt(account.total_xp) !== sum) errors.push(`accounts ${account.owner_id}: total_xp differs from valid frozen rewards`)
  }
  for (const account of before.accounts) {
    const old = before.goals.filter(g => g.owner_id === account.owner_id && g.kind === 'real' && g.status === 'active')
    old.sort((a, b) => {
      const ma = mainlines.get(`${a.owner_id}/${a.mainline_id}`), mb = mainlines.get(`${b.owner_id}/${b.mainline_id}`)
      if (!ma || !mb) return 0
      return ma.created_at.localeCompare(mb.created_at) || ma.id.localeCompare(mb.id) || Number(b.focused) - Number(a.focused) || Number(a.sort_order) - Number(b.sort_order) || a.id.localeCompare(b.id)
    })
    const actual = after.goals.filter(g => g.owner_id === account.owner_id && g.kind === 'real' && g.status === 'active')
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || a.id.localeCompare(b.id))
    if (!isDeepStrictEqual(old.map(g => g.id), actual.map(g => g.id))) errors.push(`goals ${account.owner_id}: active order differs`)
  }
  return errors
}
