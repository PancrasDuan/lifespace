-- This entire fixture is rolled back in a newly created isolated database.
begin;
create function pg_temp.command(p_owner uuid,p_command jsonb) returns jsonb language sql as $$
  select public.adventure_planning_command(p_owner,gen_random_uuid()::text,coalesce((select revision from public.adventure_accounts where owner_id=p_owner),0),p_command);
$$;
do $$
declare
  o uuid:=gen_random_uuid(); m uuid; n uuid; g uuid; t uuid; e uuid; r jsonb; frozen jsonb;
  v bigint; c bigint; origin uuid; role_name text; signature text;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=pg_temp.command(o,'{"type":"createMainline","name":"原主线"}'); m:=(r->'result'->>'entityId')::uuid;
  r:=pg_temp.command(o,jsonb_build_object('type','createGoal','destination',m,'title','保留身份','standards',jsonb_build_array('标准'))); g:=(r->'result'->>'entityId')::uuid;
  r:=pg_temp.command(o,jsonb_build_object('type','createTask','destination',g,'title','任务','description','说明','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  begin
    perform public.adventure_migration_check(o,jsonb_build_object('type',null,'id',g,'destination',''));
    raise exception 'Null migration command accepted';
  exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
  -- Force a failure after inbox creation and task reparenting. Neither may survive.
  select revision into v from public.adventure_accounts where owner_id=o;
  select count(*) into c from public.adventure_events where owner_id=o;
  update public.adventure_accounts set total_xp=1 where owner_id=o;
  begin
    perform pg_temp.command(o,jsonb_build_object('type','migrateTask','id',t,'destination',''));
    raise exception 'Expected inconsistent reward failure';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_mainlines where owner_id=o and kind='independent')
    or exists(select 1 from public.adventure_goals where owner_id=o and kind='inbox')
    or (select goal_id from public.adventure_tasks where owner_id=o and id=t)<>g
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select count(*) from public.adventure_events where owner_id=o)<>c then raise exception 'Partial task migration survived rollback'; end if;
  begin
    perform pg_temp.command(o,jsonb_build_object('type','migrateGoal','id',g,'destination',''));
    raise exception 'Expected inconsistent reward failure';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_mainlines where owner_id=o and kind='independent')
    or (select mainline_id from public.adventure_goals where owner_id=o and id=g)<>m
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select count(*) from public.adventure_events where owner_id=o)<>c then raise exception 'Partial goal migration survived rollback'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=o;
  r:=pg_temp.command(o,jsonb_build_object('type','completeTask','id',t)); e:=(r->'result'->>'completionId')::uuid;
  select to_jsonb(x) into frozen from public.adventure_events x where owner_id=o and id=e;
  r:=pg_temp.command(o,'{"type":"createMainline","name":"新主线"}'); n:=(r->'result'->>'entityId')::uuid;
  perform pg_temp.command(o,jsonb_build_object('type','migrateGoal','id',g,'destination',n));
  perform pg_temp.command(o,jsonb_build_object('type','migrateTask','id',t,'destination',''));
  if (select to_jsonb(x) from public.adventure_events x where owner_id=o and id=e)<>frozen then raise exception 'Migration rewrote frozen completion'; end if;
  if not exists(select 1 from public.adventure_events where owner_id=o and kind='task_migrated' and snapshot->'origin'->>'goalId'=g::text and amount is null)
    or not exists(select 1 from public.adventure_events where owner_id=o and kind='goal_migrated' and snapshot->'origin'->>'mainlineName'='原主线' and amount is null) then raise exception 'Migration history missing'; end if;
  -- Historical lock fixture: mainline terminal state blocks old-source mutations.
  update public.adventure_mainlines set status='ended',ended_at=clock_timestamp() where owner_id=o and id=m;
  select revision into v from public.adventure_accounts where owner_id=o;
  begin
    perform pg_temp.command(o,jsonb_build_object('type','migrateTask','id',t,'destination',g));
    raise exception 'Historical mainline lock bypassed';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  begin
    perform pg_temp.command(o,jsonb_build_object('type','cancelTaskCompletion','completionId',e));
    raise exception 'Historical cancel lock bypassed';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  if (public.adventure_task_view(o,t,today)->'capabilities'->'migrate'->>'allowed')::boolean then raise exception 'Historical migration capability incorrect'; end if;
  update public.adventure_mainlines set status='active',ended_at=null where owner_id=o and id=m;
  perform pg_temp.command(o,jsonb_build_object('type','cancelTaskCompletion','completionId',e));
  update public.adventure_tasks set status='ended',ended_at=clock_timestamp(),end_cause='manual' where owner_id=o and id=t;
  begin
    perform pg_temp.command(o,jsonb_build_object('type','migrateTask','id',t,'destination',g));
    raise exception 'Ended task revived';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  perform pg_temp.command(o,jsonb_build_object('type','achieveGoal','id',g));
  begin
    perform pg_temp.command(o,jsonb_build_object('type','migrateGoal','id',g,'destination',''));
    raise exception 'Achieved goal moved';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  foreach role_name in array array['anon','authenticated'] loop
    foreach signature in array array['adventure_migration_check(uuid,jsonb)','adventure_migration_capability(uuid,jsonb,boolean)','adventure_migration_options(uuid,text,uuid,integer)'] loop
      if has_function_privilege(role_name,'public.'||signature,'EXECUTE') then raise exception 'Browser role can call migration RPC'; end if;
      if not has_function_privilege('service_role','public.'||signature,'EXECUTE') then raise exception 'Service migration grant missing'; end if;
    end loop;
  end loop;
  if (select count(*) from pg_class where relname in ('adventure_event_request','adventure_one_valid_completion','adventure_one_goal_achievement'))<>3
    or exists(select 1 from pg_class where relname like 'adventure_%' and relkind='r' and not relrowsecurity) then raise exception 'Constraint/index/RLS regression'; end if;
end $$;
rollback;
