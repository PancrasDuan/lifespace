import type { Task } from '../shared/adventure/model'
export type DialogRequest =
  | {
      kind: 'new' | 'container' | 'goal' | 'taskCreate' | 'achievements'
      id?: string
    }
  | {
      kind:
        | 'editContainer'
        | 'editGoal'
        | 'completeGoal'
        | 'migrate'
        | 'goalDetail'
        | 'cycleRule'
        | 'cycleDetail'
        | 'ledger'
      id: string
    }
  | { kind: 'taskDetail' | 'editTask' | 'reschedule'; task: Task }
  | { kind: 'archive'; id: string; entity: 'container' | 'goal' }
  | {
      kind: 'cycleAction'
      id: string
      operation: 'pauseCycle' | 'resumeCycle' | 'endCycle' | 'extraComplete'
    }
export type OpenDialog = (request: DialogRequest) => void
