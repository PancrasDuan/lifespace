-- Run only against the temporary database, after real Worker HTTP and optional browser flows.
do $$
begin
  if exists(select 1 from public.adventure_accounts a where
    a.total_xp<>(select coalesce(sum(e.amount),0) from public.adventure_events e where e.owner_id=a.owner_id
      and e.kind in ('task_completed','goal_achieved') and e.invalidated_at is null)
    or a.revision<>(select count(*) from public.adventure_events e where e.owner_id=a.owner_id and e.request_id is not null))
    then raise exception 'HTTP audit: account XP or revision diverged from frozen events/receipts'; end if;
  if exists(select 1 from public.adventure_tasks t left join public.adventure_events e on
    e.owner_id=t.owner_id and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null
    where (t.status='completed')<>(e.id is not null) or (e.id is not null and (t.completed_at<>e.occurred_at or t.completed_on<>e.occurred_on)))
    then raise exception 'HTTP audit: task/current completion diverged'; end if;
  if exists(select 1 from public.adventure_events e where e.kind='task_completed' and (
    e.snapshot->'result'->'reward' is distinct from jsonb_build_object('amount',e.amount,'calculation',e.calculation)
    or e.snapshot->'result'->>'completionId' is distinct from e.id::text))
    then raise exception 'HTTP audit: receipt lost frozen reward'; end if;
  if exists(select 1 from public.adventure_events e left join public.adventure_events c on
    c.owner_id=e.owner_id and c.id=e.invalidated_by_event_id where e.invalidated_at is not null and (
    c.kind is distinct from 'task_completion_cancelled' or c.snapshot->>'completionId' is distinct from e.id::text
    or c.snapshot->'result'->'reward' is distinct from jsonb_build_object('amount',e.amount,'calculation',e.calculation)))
    then raise exception 'HTTP audit: invalidation detached from its completion/reward'; end if;
  if exists(select 1 from public.adventure_goals where kind='real' and status='active' and focused
    group by owner_id,mainline_id having count(*)>3) then raise exception 'HTTP audit: focus quota exceeded'; end if;
  if exists(select 1 from public.adventure_events where command_type in ('focusGoal','reorderGoals') and
    (goal_id is null or mainline_id is null or snapshot->'after' is null or snapshot->'result' is null))
    then raise exception 'HTTP audit: focus/order receipt or history missing'; end if;
end $$;
