import type { PlanningTask } from '../shared/adventure-planning'

export function PlanningCompletionOrigin({ origin }: { origin: NonNullable<PlanningTask['completionOrigin']> }) {
  return <>完成时：{[origin.categoryLabel, origin.goalTitle ?? '独立任务'].filter(Boolean).join(' / ')} · {origin.title} · {origin.occurredOn}</>
}
