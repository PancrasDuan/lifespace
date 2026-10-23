import type { PlanningTask } from '../shared/adventure-planning'

export function PlanningCompletionOrigin({ origin }: { origin: NonNullable<PlanningTask['completionOrigin']> }) {
  return <>完成时：{origin.mainlineName} / {origin.goalTitle ?? '独立任务'} · {origin.title} · {origin.occurredOn}</>
}
