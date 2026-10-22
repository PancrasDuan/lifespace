-- Isolated lifecycle invariants: rollback, ownership, permissions, terminal locks and history.
begin;
create function pg_temp.lifecycle_command(p_owner uuid,p_command jsonb) returns jsonb language sql as $$
  select public.adventure_planning_command(p_owner,gen_random_uuid()::text,
    coalesce((select revision from public.adventure_accounts where owner_id=p_owner),0),p_command);
$$;
create function pg_temp.fail_lifecycle_propagation() returns trigger language plpgsql as $$
begin
  if new.title='lifecycle-failpoint' and new.status='ended' then raise exception 'LIFECYCLE_FAILPOINT'; end if;
  return new;
end $$;
create trigger lifecycle_failpoint before update on public.adventure_tasks
  for each row execute function pg_temp.fail_lifecycle_propagation();
do $$
declare o uuid:=gen_random_uuid(); m uuid; g uuid; r jsonb; v bigint; c bigint;
begin
  r:=pg_temp.lifecycle_command(o,'{"type":"createMainline","name":"中途失败"}'); m:=(r->'result'->>'entityId')::uuid;
  r:=pg_temp.lifecycle_command(o,jsonb_build_object('type','createGoal','destination',m,'title','中途失败目标','standards',jsonb_build_array('标准'))); g:=(r->'result'->>'entityId')::uuid;
  perform pg_temp.lifecycle_command(o,jsonb_build_object('type','createTask','destination',g,'title','lifecycle-failpoint','description','','plannedOn',(clock_timestamp() at time zone 'Asia/Shanghai')::date));
  select revision into v from public.adventure_accounts where owner_id=o;
  select count(*) into c from public.adventure_events where owner_id=o;
  begin
    perform pg_temp.lifecycle_command(o,jsonb_build_object('type','endMainline','id',m));
    raise exception 'Propagation failpoint ignored';
  exception when others then if sqlerrm<>'LIFECYCLE_FAILPOINT' then raise; end if; end;
  if not exists(select 1 from public.adventure_mainlines where owner_id=o and id=m and status='active')
    or not exists(select 1 from public.adventure_goals where owner_id=o and id=g and status='active')
    or exists(select 1 from public.adventure_tasks where owner_id=o and status<>'pending')
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select count(*) from public.adventure_events where owner_id=o)<>c then raise exception 'Mid-propagation mainline failure leaked'; end if;
  begin
    perform pg_temp.lifecycle_command(o,jsonb_build_object('type','endGoal','id',g));
    raise exception 'Goal failpoint ignored';
  exception when others then if sqlerrm<>'LIFECYCLE_FAILPOINT' then raise; end if; end;
  if not exists(select 1 from public.adventure_goals where owner_id=o and id=g and status='active')
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select count(*) from public.adventure_events where owner_id=o)<>c then raise exception 'Mid-propagation goal failure leaked'; end if;
end $$;
drop trigger lifecycle_failpoint on public.adventure_tasks;
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_other uuid:=gen_random_uuid();
  v_main uuid;
  v_goal uuid;
  v_other_goal uuid;
  v_task uuid;
  v_future uuid;
  v_done uuid;
  v_revision bigint;
  v_events bigint;
  v_receipt jsonb;
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','createMainline','name','回滚主线'));
  v_main:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','createGoal','destination',v_main,'title','回滚目标','standards',jsonb_build_array('标准')));
  v_goal:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','createTask','destination',v_goal,'title','回滚待办','description','','plannedOn',v_today));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','createTask','destination','','title','未来误建','description','','plannedOn',v_today+2));
  v_future:=(v_receipt->'result'->>'entityId')::uuid;
  select id into v_other_goal from public.adventure_goals where owner_id=v_owner and kind='inbox';
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','endGoal','id',v_other_goal));
    raise exception 'System inbox ended';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  select revision into v_revision from public.adventure_accounts where owner_id=v_owner;
  select count(*) into v_events from public.adventure_events where owner_id=v_owner;
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','endMainline','id',v_main));
    raise exception 'Inconsistent lifecycle accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_mainlines where owner_id=v_owner and id=v_main and status<>'active')
    or exists(select 1 from public.adventure_goals where owner_id=v_owner and id=v_goal and status<>'active')
    or exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task and status<>'pending')
    or (select revision from public.adventure_accounts where owner_id=v_owner)<>v_revision
    or (select count(*) from public.adventure_events where owner_id=v_owner)<>v_events then raise exception 'Partial mainline end survived rollback'; end if;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','endTask','id',v_task));
    raise exception 'Inconsistent task end accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','deleteTask','id',v_future));
    raise exception 'Inconsistent delete accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_tasks where owner_id=v_owner and (status<>'pending' or deleted_at is not null))
    or (select revision from public.adventure_accounts where owner_id=v_owner)<>v_revision
    or (select count(*) from public.adventure_events where owner_id=v_owner)<>v_events then raise exception 'Partial task lifecycle survived rollback'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','completeTask','id',v_task));
  v_done:=(v_receipt->'result'->>'completionId')::uuid;
  v_receipt:=pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','endGoal','id',v_goal));
  if not exists(select 1 from public.adventure_events where owner_id=v_owner and id=v_done and invalidated_at is null and amount=1)
    or (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1 then raise exception 'Ending goal changed frozen reward'; end if;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Ended goal allowed cancellation';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','endTask','id',v_task));
    raise exception 'Completed task ended';
  exception when others then if sqlerrm<>'TASK_NOT_PENDING' then raise; end if; end;
  begin
    perform pg_temp.lifecycle_command(v_owner,jsonb_build_object('type','deleteTask','id',v_task));
    raise exception 'Completed history deleted';
  exception when others then if sqlerrm<>'TASK_NOT_PENDING' then raise; end if; end;
  begin
    perform pg_temp.lifecycle_command(v_other,jsonb_build_object('type','endGoal','id',v_goal));
    raise exception 'Cross-owner goal ended';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  v_receipt:=pg_temp.lifecycle_command(v_other,jsonb_build_object('type','createGoal','destination','','title','其他目标','standards',jsonb_build_array('标准')));
  v_other_goal:=(v_receipt->'result'->>'entityId')::uuid;
  begin
    perform pg_temp.lifecycle_command(v_other,jsonb_build_object('type','endMainline','id',v_main));
    raise exception 'Cross-owner mainline ended';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  if exists(select 1 from public.adventure_goals where owner_id=v_other and id=v_other_goal and status<>'active') then raise exception 'Other owner changed'; end if;
end $$;

do $$
declare
  o uuid:=gen_random_uuid(); g uuid; t uuid; r jsonb; v bigint; c bigint;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=pg_temp.lifecycle_command(o,jsonb_build_object('type','createTask','title','历史安排','description','','destination','','plannedOn',today+2));
  t:=(r->'result'->>'entityId')::uuid;
  select revision into v from public.adventure_accounts where owner_id=o;
  -- #61 is not implemented here: a rolled-back event models an earlier arrangement.
  insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,task_id,occurred_on,actor_owner_id,snapshot)
    values(o,gen_random_uuid(),'task_rescheduled','task',t,t,today,o,jsonb_build_object('oldPlannedOn',today+1,'newPlannedOn',today+2));
  begin
    perform public.adventure_planning_command(o,'history-delete-denied',v,jsonb_build_object('type','deleteTask','id',t));
    raise exception 'Historical arrangement deleted';
  exception when others then if sqlerrm<>'HISTORY_LOCKED' then raise; end if; end;
  if exists(select 1 from public.adventure_tasks where owner_id=o and id=t and deleted_at is not null) then raise exception 'Historical deletion changed facts'; end if;
  r:=pg_temp.lifecycle_command(o,jsonb_build_object('type','createGoal','destination','','title','全量停止','standards',jsonb_build_array('标准')));
  g:=(r->'result'->>'entityId')::uuid;
  for i in 1..201 loop
    perform pg_temp.lifecycle_command(o,jsonb_build_object('type','createTask','title','待停 '||i,'description','','destination',g,'plannedOn',today+1));
  end loop;
  select revision into v from public.adventure_accounts where owner_id=o;
  r:=public.adventure_planning_preview(o,v,jsonb_build_object('type','endGoal','id',g));
  if jsonb_array_length(r->'stoppingTasks')<>201 then raise exception 'Lifecycle preview truncated tasks'; end if;
  perform pg_temp.lifecycle_command(o,jsonb_build_object('type','endGoal','id',g));
  if exists(select 1 from public.adventure_tasks where owner_id=o and goal_id=g and status<>'ended') then raise exception 'Large lifecycle propagation partial'; end if;
end $$;

do $$
declare
  v_role text;
  v_signature text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_signature in array array[
      'adventure_lifecycle_check(uuid,jsonb,date)',
      'adventure_lifecycle_impact(uuid,jsonb,date)',
      'adventure_lifecycle_capability(uuid,jsonb,date)',
      'adventure_lifecycle_apply(uuid,text,bigint,jsonb,timestamptz)',
      'adventure_task_impact(uuid,jsonb,date)'
    ] loop
      if has_function_privilege(v_role,'public.'||v_signature,'EXECUTE') then raise exception 'Browser lifecycle privilege: % %',v_role,v_signature; end if;
      if not has_function_privilege('service_role','public.'||v_signature,'EXECUTE') then raise exception 'Service lifecycle grant missing: %',v_signature; end if;
    end loop;
  end loop;
  if exists(select 1 from pg_class where relname like 'adventure_%' and relkind='r' and not relrowsecurity) then raise exception 'Lifecycle table without RLS'; end if;
end $$;
rollback;
