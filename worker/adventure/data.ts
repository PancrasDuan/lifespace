import { planningCommandSchema } from '../../src/shared/adventure-planning'
import { transaction, type DatabaseEnv } from '../database'
import { applyCommand } from './commands'
import { preview } from './preview'

// Existing bounded SQL projections retain their pagination and snapshot shape.
// Mutation entry points are deliberately absent from this allowlist.
const projections = {
  adventure_workspace_read: [
    'p_page',
    'p_page_size',
    'p_task_range',
    'p_task_page',
    'p_task_scope',
    'p_search',
    'p_goal_id',
    'p_goal_task_page',
    'p_include_terminal',
    'p_mainline_id',
    'p_goal_scope',
  ],
  adventure_migration_options: ['p_kind', 'p_id', 'p_page'],
  adventure_task_history: ['p_task', 'p_page'],
  adventure_growth_read: ['p_version', 'p_cursor'],
  adventure_reward_source: ['p_event', 'p_page', 'p_version'],
  adventure_task_list: ['p_date', 'p_scope', 'p_expected_version', 'p_today', 'p_page'],
} as const
export function queryPlanning(env: DatabaseEnv, owner: string, operation: string, params: Record<string, unknown>): Promise<unknown> {
  owner = owner.toLowerCase()
  return transaction(env, owner, async (db) => {
    if (operation === 'adventure_planning_command')
      return applyCommand(
        db,
        owner,
        String(params.p_request_id),
        Number(params.p_expected_version),
        planningCommandSchema.parse(params.p_command)
      )
    if (operation === 'adventure_planning_preview')
      return preview(db, owner, Number(params.p_expected_version), planningCommandSchema.parse(params.p_command))
    if (!Object.hasOwn(projections, operation)) throw new Error('DATABASE_OPERATION_INVALID')
    const keys = projections[operation as keyof typeof projections]
    const values = [
      owner,
      ...keys.map((key) => (typeof params[key] === 'object' && params[key] !== null ? JSON.stringify(params[key]) : params[key])),
    ]
    return (await db.one(`select public.${operation}(${values.map((_, index) => '$' + (index + 1)).join(',')}) value`, values)).value
  })
}
