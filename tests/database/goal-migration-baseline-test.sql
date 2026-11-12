-- Test the reusable fixture at the persistence boundary, independent of a future migration.
do $$
declare ids uuid[]; receipt jsonb; original jsonb; saved record; source jsonb; achievement jsonb; goal_source jsonb;
begin
  if (select count(*) from public.adventure_accounts) <> 5 then raise exception 'expected five owners including RPC history and receipt matrix'; end if;
  if (select count(*) from public.adventure_mainlines where kind='normal') < 3 then raise exception 'missing ordinary mainlines'; end if;
  if (select count(*) from public.adventure_goals where kind='real') < 6 then raise exception 'missing goals'; end if;
  if not exists(select from public.adventure_events where kind='task_completed' and invalidated_at is not null) then raise exception 'missing cancelled completion'; end if;
  if exists(select from public.adventure_accounts a where total_xp <> (select coalesce(sum(amount),0) from public.adventure_events e where e.owner_id=a.owner_id and e.kind in ('task_completed','goal_achieved') and e.invalidated_at is null)) then raise exception 'invalid total_xp'; end if;
  if (select count(*) from public.adventure_mainlines where kind='independent')<>4 or (select count(*) from public.adventure_goals where kind='inbox')<>4 then raise exception 'missing independent/inbox'; end if;
  if not exists(select from public.adventure_tasks where deleted_at is not null) or not exists(select from public.adventure_tasks where end_cause='mainline_ended') then raise exception 'missing deleted/ended task'; end if;
  if not exists(select from public.adventure_goals where termination_cause='mainline_ended') or not exists(select from public.adventure_goals where status='achieved' and attainment_action_count=1 and attainment_snapshot->'actionSources'->0->'source'->>'goalTitle'='同名') then raise exception 'missing terminal goal/achievement snapshot'; end if;
  if not exists(select from public.adventure_events where kind='task_migrated' and snapshot->'before'->>'goal_id'<>snapshot->'after'->>'goal_id') or not exists(select from public.adventure_events where kind='goal_migrated') then raise exception 'missing migration history'; end if;
  select array_agg(g.id order by m.created_at,m.id,g.focused desc,g.sort_order,g.id) into ids
    from public.adventure_goals g join public.adventure_mainlines m on (g.owner_id,g.mainline_id)=(m.owner_id,m.id)
    where g.owner_id='00000000-0000-4000-8000-000000000001' and g.kind='real' and g.status='active';
  if ids<>array['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004']::uuid[] then raise exception 'unexpected legacy ordering'; end if;
  select snapshot->'result' into original from public.adventure_events where id='40000000-0000-4000-8000-000000000002';
  receipt:=public.adventure_planning_command('00000000-0000-4000-8000-000000000001','complete-002',0,jsonb_build_object('type','completeTask','id','30000000-0000-4000-8000-000000000002'));
  if receipt<>jsonb_build_object('version',11,'result',original) then raise exception 'cancelled completion receipt cannot replay'; end if;
  begin
    perform public.adventure_planning_command('00000000-0000-4000-8000-000000000001','complete-002',0,jsonb_build_object('type','completeTask','id','30000000-0000-4000-8000-000000000001'));
    raise exception 'digest conflict was accepted';
  exception when others then
    if sqlerrm <> 'REQUEST_ID_REUSED' then raise; end if;
  end;
  select e.snapshot,g.attainment_snapshot into strict achievement,goal_source
    from public.adventure_events e join public.adventure_goals g on (g.owner_id,g.id)=(e.owner_id,e.goal_id)
    where e.owner_id='00000000-0000-4000-8000-000000000003' and e.kind='goal_achieved';
  source:=achievement->'actionSources'->0;
  if source is null or not(source ?& array['taskId','completionId','goalId','occurredOn','source'])
    or source is distinct from goal_source->'actionSources'->0 or source->'source'->>'title' is distinct from 'RPC迁移任务'
    or achievement->'result'->'reward'->'calculation'->>'count' is distinct from '1'
    or achievement->'result'->'growthChange'->>'xpDelta' is distinct from '3' then raise exception 'incomplete RPC achievement source/receipt'; end if;
  if not exists(select from public.adventure_events where owner_id='00000000-0000-4000-8000-000000000003' and kind='task_migrated'
    and snapshot->'before'->>'goal_id'<>snapshot->'after'->>'goal_id' and snapshot->'origin'->>'goalTitle'='RPC来源') then raise exception 'incomplete RPC migration history'; end if;
  if not exists(select from public.adventure_events where owner_id='00000000-0000-4000-8000-000000000003' and kind='task_completed' and invalidated_at is not null
    and snapshot->'result'->>'completionId'=id::text and snapshot->'result'->'reward'->'calculation'->>'completionId'=id::text
    and snapshot->'result'->'growthChange'->>'xpDelta'='1') then raise exception 'incomplete cancelled RPC receipt'; end if;
  for saved in select * from goal_fixture_receipts loop
    receipt:=public.adventure_planning_command(saved.owner_id,saved.request_id,0,saved.command);
    if receipt<>saved.receipt then raise exception 'RPC receipt changed: %',saved.request_id; end if;
  end loop;
  begin
    perform public.adventure_planning_command('00000000-0000-4000-8000-000000000003','rpc-complete-cancel',0,jsonb_build_object('type','completeTask','id','30000000-0000-4000-8000-000000000001'));
    raise exception 'RPC digest conflict was accepted';
  exception when others then
    if sqlerrm <> 'REQUEST_ID_REUSED' then raise; end if;
  end;
end $$;
