-- Run against both fresh and upgraded isolated databases as the real service role.
begin;
create function pg_temp.apply_boundary_failpoint() returns trigger language plpgsql as $$
begin
  if new.request_id like 'apply-fault-%' then raise exception 'SYNTHETIC_APPLY_FAILPOINT'; end if;
  return new;
end $$;
create trigger apply_boundary_failpoint before insert on public.adventure_events
  for each row execute function pg_temp.apply_boundary_failpoint();
set local role service_role;
do $$
declare
  o uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); g uuid; ended_goal uuid; t uuid;
  r jsonb; saved jsonb; cmd jsonb; before_facts jsonb; after_facts jsonb;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=public.adventure_planning_command(o,'apply-create-goal',0,'{"type":"createGoal","title":"Goal","standards":["Done"]}');
  g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'apply-create-end-goal',1,'{"type":"createGoal","title":"End","standards":["Done"]}');
  ended_goal:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'apply-create-task',2,jsonb_build_object('type','createTask','title','Task','description','','destination','','plannedOn',today));
  t:=(r->'result'->>'entityId')::uuid;
  select jsonb_build_object('account',(select to_jsonb(a) from public.adventure_accounts a where owner_id=o),
    'goals',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_goals x where owner_id=o),
    'tasks',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_tasks x where owner_id=o),
    'events',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_events x where owner_id=o)) into before_facts;
  for cmd in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type','endGoal','id',g),
    jsonb_build_object('type','editGoal','id',g,'title','Edited','standards',jsonb_build_array('Done')),
    jsonb_build_object('type','reorderGoals','id',g,'direction','down'),
    jsonb_build_object('type','completeTask','id',t))) loop
    begin
      perform public.adventure_goal_apply(o,'wrong-goal-apply',3,cmd,clock_timestamp());
      raise exception 'goal apply accepted %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
  end loop;
  for cmd in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type','achieveGoal','id',g),jsonb_build_object('type','endGoal','id',g))) loop
    begin perform public.adventure_task_apply(o,'wrong-task-apply',3,cmd,clock_timestamp()); raise exception 'task apply accepted %',cmd->>'type';
    exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
  end loop;
  begin perform public.adventure_lifecycle_apply(o,'wrong-end-apply',3,jsonb_build_object('type','achieveGoal','id',g),clock_timestamp()); raise exception 'lifecycle apply accepted achieveGoal';
  exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
  -- Valid commands must not bypass the version check or cross owner boundaries.
  begin perform public.adventure_goal_apply(o,'stale-goal-apply',0,jsonb_build_object('type','achieveGoal','id',g),clock_timestamp()); raise exception 'goal apply accepted stale version';
  exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
  begin perform public.adventure_lifecycle_apply(o,'stale-end-apply',0,jsonb_build_object('type','endGoal','id',ended_goal),clock_timestamp()); raise exception 'lifecycle apply accepted stale version';
  exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
  begin perform public.adventure_task_apply(o,'stale-task-apply',0,jsonb_build_object('type','completeTask','id',t),clock_timestamp()); raise exception 'task apply accepted stale version';
  exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
  begin perform public.adventure_goal_apply(other_owner,'other-goal-apply',0,jsonb_build_object('type','achieveGoal','id',g),clock_timestamp()); raise exception 'goal apply crossed owner';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  begin perform public.adventure_lifecycle_apply(other_owner,'other-end-apply',0,jsonb_build_object('type','endGoal','id',ended_goal),clock_timestamp()); raise exception 'lifecycle apply crossed owner';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  begin perform public.adventure_task_apply(other_owner,'other-task-apply',0,jsonb_build_object('type','completeTask','id',t),clock_timestamp()); raise exception 'task apply crossed owner';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  begin perform public.adventure_goal_apply(o,'bad',3,jsonb_build_object('type','achieveGoal','id',g),clock_timestamp()); raise exception 'invalid request id accepted';
  exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;
  -- Fault after entity update but before the event insert must roll back the
  -- entire helper call, including account creation and reward changes.
  begin perform public.adventure_goal_apply(o,'apply-fault-goal',3,jsonb_build_object('type','achieveGoal','id',g),clock_timestamp()); raise exception 'goal fault ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_APPLY_FAILPOINT' then raise; end if; end;
  begin perform public.adventure_lifecycle_apply(o,'apply-fault-end',3,jsonb_build_object('type','endGoal','id',ended_goal),clock_timestamp()); raise exception 'end fault ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_APPLY_FAILPOINT' then raise; end if; end;
  begin perform public.adventure_task_apply(o,'apply-fault-task',3,jsonb_build_object('type','completeTask','id',t),clock_timestamp()); raise exception 'task fault ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_APPLY_FAILPOINT' then raise; end if; end;
  select jsonb_build_object('account',(select to_jsonb(a) from public.adventure_accounts a where owner_id=o),
    'goals',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_goals x where owner_id=o),
    'tasks',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_tasks x where owner_id=o),
    'events',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_events x where owner_id=o)) into after_facts;
  if before_facts<>after_facts or exists(select 1 from public.adventure_accounts where owner_id=other_owner) then raise exception 'rejected apply changed facts'; end if;
  cmd:=jsonb_build_object('type','achieveGoal','id',g);
  saved:=public.adventure_goal_apply(o,'valid-goal-apply',3,cmd,'2000-01-01 00:00Z');
  if saved->>'version'<>'4' or saved->'result'->'reward'->>'amount'<>'1' then raise exception 'valid achievement failed'; end if;
  r:=public.adventure_goal_apply(o,'valid-goal-apply',0,cmd,clock_timestamp());
  if r<>saved then raise exception 'goal apply did not replay receipt'; end if;
  begin perform public.adventure_goal_apply(o,'valid-goal-apply',0,jsonb_build_object('type','achieveGoal','id',ended_goal),clock_timestamp()); raise exception 'goal receipt reused';
  exception when others then if sqlerrm<>'REQUEST_ID_REUSED' then raise; end if; end;
  saved:=public.adventure_lifecycle_apply(o,'valid-end-apply',4,jsonb_build_object('type','endGoal','id',ended_goal),clock_timestamp());
  if saved->>'version'<>'5' or (select status from public.adventure_goals where owner_id=o and id=ended_goal)<>'ended'
    or (select total_xp from public.adventure_accounts where owner_id=o)<>1 then raise exception 'valid end failed'; end if;
  r:=public.adventure_lifecycle_apply(o,'valid-end-apply',0,jsonb_build_object('type','endGoal','id',ended_goal),clock_timestamp());
  if r<>saved then raise exception 'lifecycle apply did not replay receipt'; end if;
  saved:=public.adventure_task_apply(o,'valid-task-apply',5,jsonb_build_object('type','completeTask','id',t),clock_timestamp());
  r:=public.adventure_task_apply(o,'valid-task-apply',0,jsonb_build_object('type','completeTask','id',t),clock_timestamp());
  if r<>saved or (select total_xp from public.adventure_accounts where owner_id=o)<>2 then raise exception 'task receipt failed'; end if;
  if (select achieved_on from public.adventure_goals where owner_id=o and id=g)<>today then raise exception 'caller supplied execution time used'; end if;
end $$;
rollback;
