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
  if exists(select 1 from public.adventure_events where kind in ('goal_migrated','task_migrated') and (amount is not null or calculation is not null or snapshot->'before' is null or snapshot->'origin' is null or snapshot->'after' is null or snapshot->'result' is null)) then raise exception 'HTTP audit: migration history/reward invariant failed'; end if;
  if exists(select 1 from public.adventure_events where kind in ('goal_ended','mainline_ended','task_ended','task_deleted') and
    (amount is not null or calculation is not null or snapshot->'before' is null or snapshot->'after' is null or snapshot->'impact' is null or snapshot->'result' is null))
    then raise exception 'HTTP audit: lifecycle history/reward invariant failed'; end if;
  if exists(select 1 from public.adventure_tasks t where t.deleted_at is not null and (
    t.status<>'pending' or t.planned_on<=(clock_timestamp() at time zone 'Asia/Shanghai')::date
    or exists(select 1 from public.adventure_events e where e.owner_id=t.owner_id and e.task_id=t.id
      and e.kind in ('task_completed','task_rescheduled'))))
    then raise exception 'HTTP audit: ineligible task was deleted'; end if;
  if exists(select 1 from public.adventure_events e left join public.adventure_events source
    on source.owner_id=e.owner_id and source.id=(e.snapshot->>'sourceEventId')::uuid
    where e.kind='task_rescheduled' and (e.amount is not null or e.calculation is not null
      or e.snapshot->'before' is null or e.snapshot->'after' is null or e.snapshot->'result' is null
      or source.id is null or source.task_id is distinct from e.task_id
      or source.kind not in ('task_created','task_rescheduled') or source.applied_revision>=e.applied_revision
      or coalesce(source.snapshot->>'newPlannedOn',source.snapshot->>'plannedOn') is distinct from e.snapshot->>'oldPlannedOn'
      or e.snapshot->>'oldPlannedOn' is distinct from e.snapshot->'before'->>'planned_on'
      or e.snapshot->>'newPlannedOn' is distinct from e.snapshot->'after'->>'planned_on'
      or (e.snapshot->>'newPlannedOn')::date<e.occurred_on
      or e.snapshot->'result'->'growthChange'->>'xpDelta' is distinct from '0'))
    then raise exception 'HTTP audit: reschedule source chain, date or zero reward diverged'; end if;
  if exists(select 1 from public.adventure_tasks t join lateral (
    select e.snapshot from public.adventure_events e where e.owner_id=t.owner_id and e.task_id=t.id
      and e.kind in ('task_created','task_rescheduled') order by e.applied_revision desc limit 1
    ) latest on true where t.planned_on::text is distinct from coalesce(latest.snapshot->>'newPlannedOn',latest.snapshot->>'plannedOn'))
    then raise exception 'HTTP audit: task date diverged from current arrangement'; end if;
  if exists(select 1 from public.adventure_goals g left join public.adventure_events e on e.owner_id=g.owner_id and e.goal_id=g.id and e.kind='goal_achieved'
    where (g.status='achieved')<>(e.id is not null) or (e.id is not null and (
      e.amount is distinct from (e.snapshot->'result'->'reward'->>'amount')::bigint
      or e.calculation is distinct from e.snapshot->'result'->'reward'->'calculation'
      or e.snapshot->'result'->>'achievementId' is distinct from e.id::text
      or e.calculation->>'count' is distinct from g.attainment_action_count::text
      or e.calculation->>'coefficient' is distinct from g.attainment_coefficient::text
      or e.calculation->'actionIds' is distinct from to_jsonb(g.attainment_action_ids)
      or e.snapshot->>'reflection' is distinct from g.attainment_reflection
      or e.snapshot->>'title' is distinct from g.attainment_snapshot->>'title'
      or g.focused or g.achieved_at is distinct from e.occurred_at
      or exists(select 1 from public.adventure_tasks t where t.owner_id=g.owner_id and t.goal_id=g.id and t.status='pending' and t.deleted_at is null))))
    then raise exception 'HTTP audit: achievement/frozen reward/terminal propagation diverged'; end if;
end $$;
