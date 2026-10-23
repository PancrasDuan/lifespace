-- Temporary empty database only; fail after the task update to prove atomic rollback.
begin;
create function pg_temp.reschedule_command(o uuid,c jsonb) returns jsonb language sql as $$
  select public.adventure_planning_command(o,gen_random_uuid()::text,
    coalesce((select revision from public.adventure_accounts where owner_id=o),0),c);
$$;
create function pg_temp.fail_reschedule_event() returns trigger language plpgsql as $$
begin
  if new.kind='task_rescheduled' and new.snapshot->>'title'='reschedule-failpoint' then raise exception 'RESCHEDULE_FAILPOINT'; end if;
  return new;
end $$;
create trigger reschedule_failpoint before insert on public.adventure_events for each row execute function pg_temp.fail_reschedule_event();
do $$
declare o uuid:=gen_random_uuid(); t uuid; r jsonb; v bigint; c bigint;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=pg_temp.reschedule_command(o,jsonb_build_object('type','createTask','title','reschedule-failpoint','description','','plannedOn',today-2,'destination',''));
  t:=(r->'result'->>'entityId')::uuid;
  select revision into v from public.adventure_accounts where owner_id=o;
  select count(*) into c from public.adventure_events where owner_id=o;
  begin
    perform pg_temp.reschedule_command(o,jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today));
    raise exception 'Reschedule failure ignored';
  exception when others then if sqlerrm<>'RESCHEDULE_FAILPOINT' then raise; end if; end;
  if (select planned_on from public.adventure_tasks where owner_id=o and id=t)<>today-2
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select total_xp from public.adventure_accounts where owner_id=o)<>0
    or (select count(*) from public.adventure_events where owner_id=o)<>c then raise exception 'Partial reschedule survived'; end if;
end $$;
drop trigger reschedule_failpoint on public.adventure_events;
do $$
declare o uuid:=gen_random_uuid(); t uuid; r jsonb; v bigint; c jsonb; done uuid;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  yesterday timestamptz:=clock_timestamp()-interval '1 day';
begin
  r:=pg_temp.reschedule_command(o,jsonb_build_object('type','createTask','title','过去完成冻结','description','','plannedOn',today-1,'destination',''));
  t:=(r->'result'->>'entityId')::uuid;
  select revision into v from public.adventure_accounts where owner_id=o;
  r:=public.adventure_task_apply(o,'past-completion-key',v,jsonb_build_object('type','completeTask','id',t),yesterday);
  done:=(r->'result'->>'completionId')::uuid;
  begin
    perform pg_temp.reschedule_command(o,jsonb_build_object('type','cancelTaskCompletion','completionId',done));
    raise exception 'Past completion cancelled';
  exception when others then if sqlerrm<>'DATE_LOCKED' then raise; end if; end;
  begin
    perform pg_temp.reschedule_command(o,jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today));
    raise exception 'Past completed task moved';
  exception when others then if sqlerrm<>'TASK_NOT_PENDING' then raise; end if; end;
  -- A prior successful request is returned before current date/version validation.
  if public.adventure_planning_command(o,'past-completion-key',0,jsonb_build_object('type','completeTask','id',t))<>r then raise exception 'Cross-day replay executed again'; end if;

  r:=pg_temp.reschedule_command(o,jsonb_build_object('type','createTask','title','跨日重试改期','description','','plannedOn',today-3,'destination',''));
  t:=(r->'result'->>'entityId')::uuid;
  select revision into v from public.adventure_accounts where owner_id=o;
  c:=jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today-1);
  r:=public.adventure_task_apply(o,'past-reschedule-key',v,c,yesterday);
  if public.adventure_planning_command(o,'past-reschedule-key',0,c)<>r then raise exception 'Cross-day reschedule replay changed'; end if;
  if (select planned_on from public.adventure_tasks where owner_id=o and id=t)<>today-1 then raise exception 'Cross-day replay changed date'; end if;
end $$;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name,'public.adventure_task_history(uuid,uuid,integer)','EXECUTE') then raise exception 'Task history RPC exposed'; end if;
  end loop;
  if not has_function_privilege('service_role','public.adventure_task_history(uuid,uuid,integer)','EXECUTE') then raise exception 'Task history RPC unavailable to Worker'; end if;
end $$;
rollback;
