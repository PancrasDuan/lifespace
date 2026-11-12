-- Only isolated synthetic databases. Exercise the actual service role and roll back.
begin;
set local role service_role;
do $$
declare o uuid:=gen_random_uuid(); today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  t uuid; g uuid; r jsonb; cmd jsonb; before_account jsonb; before_task jsonb; before_events jsonb; capability jsonb;
  v_request text; v_kind text; v_result jsonb;
begin
  r:=public.adventure_planning_command(o,'retired-create-goal',0,'{"type":"createGoal","title":"目的地","standards":["完成"]}'); g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'retired-create-task',1,jsonb_build_object('type','createTask','title','待完成','description','','destination','','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  select to_jsonb(a) into before_account from public.adventure_accounts a where owner_id=o;
  select to_jsonb(x) into before_task from public.adventure_tasks x where owner_id=o and id=t;
  select jsonb_agg(to_jsonb(e) order by e.id) into before_events from public.adventure_events e where owner_id=o;
  for cmd in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type','endTask','id',t),
    jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today+1),
    jsonb_build_object('type','migrateTask','id',t,'destination',g),
    jsonb_build_object('type','migrateGoal','id',g,'destination','independent'),
    jsonb_build_object('type','focusGoal','id',g,'focused',true),
    jsonb_build_object('type','endMainline','id',g),
    jsonb_build_object('type','renameMainline','id',g,'name','旧名'),
    jsonb_build_object('type','createMainline','name','旧名')
  )) loop
    begin perform public.adventure_task_check(o,cmd,today); raise exception 'retired task check accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_planning_check(o,cmd); raise exception 'retired planning check accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_task_apply(o,'retired-apply-check',2,cmd,clock_timestamp()); raise exception 'retired apply accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_task_impact(o,cmd,today); raise exception 'retired impact accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_lifecycle_check(o,cmd,today); raise exception 'retired lifecycle check accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_lifecycle_apply(o,'retired-lifecycle',2,cmd,clock_timestamp()); raise exception 'retired lifecycle apply accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_goal_apply(o,'retired-goal-apply',2,cmd,clock_timestamp()); raise exception 'retired goal apply accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_planning_capability(o,cmd); raise exception 'retired planning capability accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_planning_command(o,'retired-new-check',2,cmd); raise exception 'retired command accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_planning_preview(o,2,cmd); raise exception 'retired preview accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    begin perform public.adventure_migration_check(o,cmd); raise exception 'retired migration check accepted: %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
    capability:=public.adventure_task_capability(o,cmd,today);
    if capability->>'allowed' is distinct from 'false' then raise exception 'retired capability allowed: %',cmd->>'type'; end if;
    capability:=public.adventure_migration_capability(o,cmd,true);
    if capability->>'allowed' is distinct from 'false' then raise exception 'retired migration capability allowed: %',cmd->>'type'; end if;
  end loop;
  r:=public.adventure_migration_options(o,'task',t,1);
  if not exists(select 1 from jsonb_array_elements(r->'options') option where option->>'id'=g::text and option->'capability'->>'allowed'='true')
    then raise exception 'task edit destination unavailable'; end if;
  if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account
    or (select to_jsonb(x) from public.adventure_tasks x where owner_id=o and id=t)<>before_task
    or (select jsonb_agg(to_jsonb(e) order by e.id) from public.adventure_events e where owner_id=o)<>before_events
    then raise exception 'retired endTask changed persisted facts'; end if;
  -- A fresh database can contain imported legacy receipts. Replaying them is
  -- permitted before version and command eligibility checks, without writes.
  for cmd in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type','endTask','id',t),
    jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today+1),
    jsonb_build_object('type','migrateTask','id',t,'destination',g)
  )) loop
    v_request:='retired-receipt-'||lower(cmd->>'type');
    v_kind:=case cmd->>'type' when 'endTask' then 'task_ended' when 'rescheduleTask' then 'task_rescheduled' else 'task_migrated' end;
    v_result:=jsonb_build_object('entityId',t,'message','已保存的历史结果');
    insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,task_id,occurred_on,actor_owner_id,
      request_id,command_hash,command_type,applied_revision,snapshot)
      values(o,gen_random_uuid(),v_kind,'task',t,t,today,o,v_request,encode(sha256(convert_to(cmd::text,'UTF8')),'hex'),cmd->>'type',1,jsonb_build_object('result',v_result));
    select jsonb_agg(to_jsonb(e) order by e.id) into before_events from public.adventure_events e where owner_id=o;
    r:=public.adventure_planning_command(o,v_request,0,cmd);
    if r<>jsonb_build_object('version',1,'result',v_result) then raise exception 'retired receipt did not replay: %',cmd->>'type'; end if;
    begin perform public.adventure_planning_command(o,v_request,0,jsonb_build_object('type','deleteTask','id',t)); raise exception 'retired receipt hash reused';
    exception when others then if sqlerrm<>'REQUEST_ID_REUSED' then raise; end if; end;
    if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account
      or (select to_jsonb(x) from public.adventure_tasks x where owner_id=o and id=t)<>before_task
      or (select jsonb_agg(to_jsonb(e) order by e.id) from public.adventure_events e where owner_id=o)<>before_events
      then raise exception 'retired replay changed persisted facts'; end if;
  end loop;
end $$;
rollback;
