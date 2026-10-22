-- Run only against an isolated database after create-planning.sql. Probe rows roll back.
begin;
set local role service_role;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_goal uuid;
  v_main uuid;
  v_result jsonb;
  v_initial jsonb;
  v_read jsonb;
begin
  perform public.adventure_planning_preview(v_owner,0,'{"type":"createGoal","destination":"","title":"独立目标","standards":["标准一","标准二"]}');
  if exists(select 1 from public.adventure_accounts where owner_id=v_owner) then raise exception 'Preview initialized account'; end if;
  v_read := public.adventure_planning_read(v_owner,1,20);
  if v_read->>'version' <> '0' or v_read->'destinations' <> '[]'::jsonb or v_read->'goals' <> '[]'::jsonb then raise exception 'Invalid initial page'; end if;

  v_initial := public.adventure_planning_command(v_owner,'probe-goal-create',0,'{"type":"createGoal","destination":"","title":"独立目标","standards":["标准一","标准二"]}');
  v_goal := (v_initial->'result'->>'entityId')::uuid;
  v_read := public.adventure_planning_read(v_owner,1,20);
  if v_read->>'version' <> '1' or v_read->>'totalGoals' <> '1'
    or v_read->'goals'->0->>'independent' <> 'true'
    or v_read->'goals'->0->'standards' <> '["标准一","标准二"]'::jsonb then raise exception 'Default independent goal failed'; end if;

  v_result := public.adventure_planning_command(v_owner,'probe-main-create',1,'{"type":"createMainline","name":"健康"}');
  v_main := (v_result->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'probe-goal-mainline',2,jsonb_build_object('type','editGoal','id',v_goal,'destination',v_main,'title','独立目标','standards','["标准一"]'::jsonb));
  if not exists(select 1 from public.adventure_goals where id=v_goal and mainline_id=v_main) then raise exception 'Goal destination failed'; end if;
  perform public.adventure_planning_command(v_owner,'probe-goal-clear',3,jsonb_build_object('type','editGoal','id',v_goal,'destination','','title','更新后的目标','standards','["标准一","标准二"]'::jsonb));
  perform public.adventure_planning_command(v_owner,'probe-main-rename',4,jsonb_build_object('type','renameMainline','id',v_main,'name','健康与活力'));
  if (select count(*) from public.adventure_mainlines where owner_id=v_owner and kind='independent') <> 1
    or (select count(*) from public.adventure_goals where owner_id=v_owner and kind='inbox') <> 1 then raise exception 'Duplicate independent structure'; end if;
  v_read := public.adventure_planning_read(v_owner,1,20);
  if v_read->>'version' <> '5' or v_read->'goals'->0->>'independent' <> 'true'
    or v_read->'goals'->0->>'id' <> v_goal::text or v_read->'growth'->>'totalXp' <> '0' then raise exception 'Readback inconsistent'; end if;

  v_result := public.adventure_planning_command(v_owner,'probe-goal-create',0,'{"type":"createGoal","destination":"","title":"独立目标","standards":["标准一","标准二"]}');
  if v_result <> v_initial then raise exception 'Historical receipt changed'; end if;
  begin
    perform public.adventure_planning_command(v_owner,'probe-goal-create',5,'{"type":"createMainline","name":"错误复用"}');
    raise exception 'Reused key accepted';
  exception when others then if sqlerrm <> 'REQUEST_ID_REUSED' then raise; end if; end;
  begin
    perform public.adventure_planning_command(v_owner,'probe-stale-create',0,'{"type":"createMainline","name":"过期命令"}');
    raise exception 'Stale version accepted';
  exception when others then if sqlerrm <> 'VERSION_CONFLICT' then raise; end if; end;
  begin
    perform public.adventure_planning_command(v_other,'probe-other-owner',0,jsonb_build_object('type','editGoal','id',v_goal,'destination','','title','越权','standards','["标准"]'::jsonb));
    raise exception 'Other owner accepted';
  exception when others then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;

  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'probe-rollback-create',5,'{"type":"createMainline","name":"必须回滚"}');
    raise exception 'Inconsistent rewards accepted';
  exception when others then if sqlerrm <> 'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_mainlines where owner_id=v_owner and name='必须回滚')
    or (select count(*) from public.adventure_events where owner_id=v_owner) <> 5
    or (select revision from public.adventure_accounts where owner_id=v_owner) <> 5 then raise exception 'Partial transaction persisted'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;

  if has_table_privilege('service_role','public.adventure_accounts','DELETE') then raise exception 'Unexpected delete privilege'; end if;
end $$;
reset role;
do $$
declare
  v_role text;
  v_table text;
  v_function text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_table in array array['adventure_accounts','adventure_mainlines','adventure_goals','adventure_tasks','adventure_events'] loop
      if has_table_privilege(v_role,'public.'||v_table,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Browser table privilege: % %',v_role,v_table; end if;
      if not (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass) then raise exception 'RLS disabled'; end if;
    end loop;
    foreach v_function in array array['adventure_planning_capability(uuid,jsonb)','adventure_planning_check(uuid,jsonb)','adventure_planning_read(uuid,integer,integer)','adventure_planning_preview(uuid,bigint,jsonb)','adventure_planning_command(uuid,text,bigint,jsonb)'] loop
      if has_function_privilege(v_role,'public.'||v_function,'EXECUTE') then raise exception 'Browser RPC privilege: % %',v_role,v_function; end if;
    end loop;
  end loop;
end $$;
rollback;
