begin;
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_task uuid;
  v_done uuid;
  v_receipt jsonb;
  v_cancel jsonb;
  v_view jsonb;
  v_event public.adventure_events;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'future-create-task',0,jsonb_build_object(
    'type','createTask','title','提前完成事实','description','原计划保留','plannedOn',v_today+7,'destination',''));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  v_view:=public.adventure_task_view(v_owner,v_task,v_today);
  if v_view->'capabilities'->'complete'->>'allowed' is distinct from 'true' then raise exception 'future completion capability denied'; end if;
  v_receipt:=public.adventure_planning_command(v_owner,'future-complete-task',1,jsonb_build_object('type','completeTask','id',v_task));
  v_done:=(v_receipt->'result'->>'completionId')::uuid;
  select * into strict v_event from public.adventure_events where owner_id=v_owner and id=v_done;
  if v_event.occurred_on<>v_today or (v_event.occurred_at at time zone 'Asia/Shanghai')::date<>v_today
    or v_event.snapshot->>'plannedOn' is distinct from (v_today+7)::text
    or v_event.snapshot->'after'->>'completed_on' is distinct from v_today::text
    or not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task
      and planned_on=v_today+7 and completed_on=v_today and completed_at=v_event.occurred_at)
    then raise exception 'future completion dates diverged from actual completion'; end if;
  v_view:=public.adventure_task_list(v_owner,v_today,'all',2,v_today);
  if v_view->'progress' is distinct from '{"completed":1,"total":1,"ratio":1}'::jsonb
    or v_view->'tasks'->0->>'id' is distinct from v_task::text then raise exception 'future completion missing from today'; end if;
  v_view:=public.adventure_task_list(v_owner,v_today+7,'all',2,v_today);
  if v_view->>'total' is distinct from '0' then raise exception 'completed task remains in future pending list'; end if;
  begin
    perform public.adventure_task_check(v_owner,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done),v_today+1);
    raise exception 'future plan bypassed past completion lock';
  exception when others then if sqlerrm<>'DATE_LOCKED' then raise; end if; end;
  if public.adventure_planning_command(v_owner,'future-complete-task',0,jsonb_build_object('type','completeTask','id',v_task)) is distinct from v_receipt
    then raise exception 'successful receipt changed'; end if;
  update public.adventure_events set amount=7,calculation=jsonb_set(calculation,'{coefficient}','7') where owner_id=v_owner and id=v_done;
  update public.adventure_accounts set total_xp=7 where owner_id=v_owner;
  v_cancel:=public.adventure_planning_command(v_owner,'future-cancel-task',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if v_cancel->'result'->'growthChange'->>'xpDelta' is distinct from '-7'
    or v_cancel->'result'->'growthChange'->'after'->>'actions' is distinct from '0'
    or not exists(select 1 from public.adventure_events where owner_id=v_owner and id=v_done and invalidated_at is not null and amount=7)
    then raise exception 'cancellation lost the frozen reward'; end if;
  v_view:=public.adventure_task_list(v_owner,v_today+7,'all',3,v_today);
  if v_view->'tasks'->0->>'status' is distinct from 'pending' then raise exception 'cancellation did not restore future plan'; end if;
  v_view:=public.adventure_task_list(v_owner,v_today,'all',3,v_today);
  if v_view->>'total' is distinct from '0' then raise exception 'canceled future task remains in today'; end if;
  perform public.adventure_planning_command(v_owner,'future-redo-task',3,jsonb_build_object('type','completeTask','id',v_task));
  if public.adventure_planning_command(v_owner,'future-cancel-task',0,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done)) is distinct from v_cancel
    or (select count(*) from public.adventure_events where owner_id=v_owner and kind='task_completed' and invalidated_at is null)<>1
    or (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1
    then raise exception 'old cancellation replay changed new completion'; end if;
  if has_function_privilege('anon','public.adventure_task_check(uuid,jsonb,date)','execute')
    or has_function_privilege('authenticated','public.adventure_planning_preview(uuid,bigint,jsonb)','execute')
    or has_function_privilege('anon','public.adventure_task_capability(uuid,jsonb,date)','execute')
    or not has_function_privilege('service_role','public.adventure_task_check(uuid,jsonb,date)','execute')
    then raise exception 'future completion migration changed RPC permissions'; end if;
end $$;
rollback;
