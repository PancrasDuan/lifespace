-- Isolated test databases only. Make real transactional task facts, then move
-- their dates into the past so date-bound Worker paths can be exercised.
create function public.adventure_test_history_seed(p_owner uuid,p_request_id text,p_expected_version bigint,p_command jsonb,p_occurred_on date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; v_now timestamptz; v_command jsonb; v_result jsonb; v_task uuid;
begin
  if p_owner is null or p_occurred_on is null or p_occurred_on>=v_today
    or p_command->>'type' not in ('createTask','completeTask') then raise exception 'INVALID_HISTORY_FIXTURE'; end if;
  v_now:=(p_occurred_on + time '12:00') at time zone 'Asia/Shanghai';
  v_command:=case when p_command->>'type'='createTask' then jsonb_set(p_command,'{plannedOn}',to_jsonb(v_today)) else p_command end;
  v_result:=public.adventure_planning_command(p_owner,p_request_id,p_expected_version,v_command);
  v_task:=(v_result->'result'->>'entityId')::uuid;
  if p_command->>'type'='createTask' then
    if (p_command->>'plannedOn')::date<>p_occurred_on then raise exception 'INVALID_HISTORY_FIXTURE'; end if;
    update public.adventure_tasks set planned_on=p_occurred_on,created_at=v_now,updated_at=v_now where owner_id=p_owner and id=v_task;
    update public.adventure_events set occurred_at=v_now,occurred_on=p_occurred_on,created_at=v_now,
      command_hash=encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),
      snapshot=jsonb_set(jsonb_set(snapshot,'{plannedOn}',to_jsonb(p_occurred_on)),'{after,planned_on}',to_jsonb(p_occurred_on))
      where owner_id=p_owner and request_id=p_request_id;
  else
    update public.adventure_tasks set completed_at=v_now,completed_on=p_occurred_on,updated_at=v_now where owner_id=p_owner and id=v_task;
    update public.adventure_events set occurred_at=v_now,occurred_on=p_occurred_on,created_at=v_now,
      snapshot=jsonb_set(jsonb_set(snapshot,'{after,completed_on}',to_jsonb(p_occurred_on)),'{after,completed_at}',to_jsonb(v_now))
      where owner_id=p_owner and request_id=p_request_id;
  end if;
  return v_result;
end $$;
revoke execute on function public.adventure_test_history_seed(uuid,text,bigint,jsonb,date) from public,anon,authenticated;
grant execute on function public.adventure_test_history_seed(uuid,text,bigint,jsonb,date) to service_role;

-- Model a focus value preserved by migration; new focus commands are retired.
create function public.adventure_test_focus_seed(p_owner uuid,p_goal uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.adventure_goals set focused=true where owner_id=p_owner and id=p_goal and kind='real' and status='active';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke execute on function public.adventure_test_focus_seed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.adventure_test_focus_seed(uuid,uuid) to service_role;

-- Model a legacy completed task migrated after completion; current commands do
-- not permit this state, but its historical completion must remain readable.
create function public.adventure_test_move_completed(p_owner uuid,p_task uuid,p_goal uuid,p_request_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_revision bigint; v_task public.adventure_tasks; v_source public.adventure_goals; v_target public.adventure_goals;
  v_now timestamptz:=clock_timestamp(); v_before jsonb; v_after jsonb; v_before_growth jsonb; v_after_growth jsonb;
  v_command jsonb:=jsonb_build_object('type','migrateTask','id',p_task,'destination',p_goal);
  v_result jsonb;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_COMMAND'; end if;
  select revision into strict v_revision from public.adventure_accounts where owner_id=p_owner for update;
  select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=p_task and status='completed' and deleted_at is null;
  select * into strict v_source from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id and status='active';
  select * into strict v_target from public.adventure_goals where owner_id=p_owner and id=p_goal and kind='real' and status='active';
  if v_source.id=v_target.id or exists(select 1 from public.adventure_events e join public.adventure_goals g on (g.owner_id,g.id)=(e.owner_id,e.goal_id)
    where e.owner_id=p_owner and e.task_id=p_task and e.kind='task_completed' and e.invalidated_at is null and g.status<>'active') then raise exception 'READ_ONLY'; end if;
  v_before:=to_jsonb(v_task)-'owner_id';
  v_before_growth:=public.adventure_growth(p_owner);
  update public.adventure_tasks set goal_id=p_goal,updated_at=v_now where owner_id=p_owner and id=p_task returning * into v_task;
  v_after:=to_jsonb(v_task)-'owner_id';
  update public.adventure_accounts set revision=v_revision+1,updated_at=v_now where owner_id=p_owner;
  v_after_growth:=public.adventure_growth(p_owner);
  v_result:=jsonb_build_object('entityId',p_task,'message','已迁移任务','completionId',null,'reward',null,
    'growthChange',jsonb_build_object('xpDelta',0,'before',v_before_growth,'after',v_after_growth,'unlocked','[]'::jsonb,'lost','[]'::jsonb));
  insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,snapshot,created_at)
  values(gen_random_uuid(),p_owner,gen_random_uuid(),'task_migrated','task',p_task,p_task,p_goal,
    v_now,(v_now at time zone 'Asia/Shanghai')::date,p_owner,p_request_id,encode(sha256(convert_to(v_command::text,'UTF8')),'hex'),'migrateTask',v_revision+1,
    jsonb_build_object('before',v_before,'after',v_after,'origin',jsonb_build_object('goalId',case when v_source.kind='real' then v_source.id end,'goalTitle',case when v_source.kind='real' then v_source.title end),
      'title',v_task.title,'description',v_task.description,'completionId',null,'plannedOn',v_task.planned_on,'goalTitle',v_target.title,'goalStandards',v_target.standards,'impact',null,'result',v_result),v_now);
  return jsonb_build_object('version',v_revision+1,'result',v_result);
end $$;
revoke execute on function public.adventure_test_move_completed(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.adventure_test_move_completed(uuid,uuid,uuid,text) to service_role;
