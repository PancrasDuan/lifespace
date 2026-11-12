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
create function public.adventure_test_move_completed(p_owner uuid,p_task uuid,p_goal uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.adventure_accounts where owner_id=p_owner for update;
  if not found or not exists(select 1 from public.adventure_goals where owner_id=p_owner and id=p_goal and kind='real') then raise exception 'NOT_FOUND'; end if;
  update public.adventure_tasks set goal_id=p_goal where owner_id=p_owner and id=p_task and status='completed' and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.adventure_accounts set revision=revision+1 where owner_id=p_owner;
end $$;
revoke execute on function public.adventure_test_move_completed(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.adventure_test_move_completed(uuid,uuid,uuid) to service_role;
