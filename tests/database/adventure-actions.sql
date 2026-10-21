begin;
set local role service_role;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_today date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_receipt jsonb;
  v_task uuid;
  v_done uuid;
  v_page jsonb;
begin
  v_receipt := public.adventure_planning_command(v_owner,'actions-create-01',0,
    jsonb_build_object('type','createTask','title','今天行动','description','完整行动','plannedOn',v_today,'destination','independent'));
  v_task := (v_receipt->'result'->>'entityId')::uuid;
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if v_page->'tasks'->0->>'id' <> v_task::text or v_page->'growth'->>'totalXp' <> '0' then raise exception 'Task create/read failed'; end if;
  v_receipt := public.adventure_planning_command(v_owner,'actions-complete-01',1,jsonb_build_object('type','completeTask','id',v_task));
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  v_done := (v_page->'tasks'->0->>'completionId')::uuid;
  if v_done is null or v_page->'growth'->>'totalXp' <> '1' or v_page->'growth'->>'actions' <> '1'
    or v_page->'tasks'->0->>'status' <> 'completed' then raise exception 'Atomic completion/reward failed'; end if;
  if (select count(*) from public.adventure_events where owner_id=v_owner and invalidated_at is null and kind in ('task_completed','reward_task')) <> 2 then raise exception 'Missing atomic facts'; end if;
  v_page := public.adventure_planning_preview(v_owner,2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if v_page->>'requiresConfirmation' <> 'true' or v_page->'growthAfter'->>'totalXp' <> '0' then raise exception 'Cancellation preview failed'; end if;
  perform public.adventure_planning_command(v_owner,'actions-cancel-01',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if v_page->'growth'->>'totalXp' <> '0' or v_page->'growth'->>'actions' <> '0' or v_page->'tasks'->0->>'status' <> 'pending' then raise exception 'Cancellation facts mismatch'; end if;
  if (select count(*) from public.adventure_events where owner_id=v_owner and kind in ('task_completed','reward_task') and invalidated_at is not null) <> 2 then raise exception 'Cancellation must retain invalidated facts'; end if;
  perform public.adventure_planning_command(v_owner,'actions-complete-02',3,jsonb_build_object('type','completeTask','id',v_task));
  perform public.adventure_planning_command(v_owner,'actions-cancel-01',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if public.adventure_planning_command(v_owner,'actions-complete-01',1,jsonb_build_object('type','completeTask','id',v_task)) <> v_receipt then raise exception 'Historical completion receipt changed'; end if;
  begin
    perform public.adventure_planning_command(v_owner,'actions-stale-cancel',4,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Old cancellation affected new completion';
  exception when others then if sqlerrm <> 'COMPLETION_CHANGED' then raise; end if; end;
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if v_page->>'version' <> '4' or v_page->'growth'->>'totalXp' <> '1' or v_page->'tasks'->0->>'status' <> 'completed' then raise exception 'Retries changed newer result'; end if;
end $$;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_task uuid;
  v_done uuid;
  v_goal uuid;
  v_receipt jsonb;
  v_page jsonb;
  v_table text;
  v_role text;
begin
  perform public.adventure_planning_read(v_owner,1,20);
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-create',0,jsonb_build_object('type','createTask','title','必须回滚','description','','plannedOn',v_today,'destination','independent'));
    raise exception 'Partial task accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_tasks where owner_id=v_owner) or exists(select 1 from public.adventure_mainlines where owner_id=v_owner)
    or exists(select 1 from public.adventure_events where owner_id=v_owner) or (select revision from public.adventure_accounts where owner_id=v_owner)<>0 then raise exception 'Partial task/structure/event survived rollback'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;
  v_receipt:=public.adventure_planning_command(v_owner,'clock-task-create',0,jsonb_build_object('type','createTask','title','冻结行动','description','','plannedOn',v_today,'destination','independent'));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-edit',1,jsonb_build_object('type','editTask','id',v_task,'title','错误改名','description','错误说明'));
    raise exception 'Partial edit accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-complete',1,jsonb_build_object('type','completeTask','id',v_task));
    raise exception 'Partial completion accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task and title='冻结行动' and status='pending')
    or (select count(*) from public.adventure_events where owner_id=v_owner)<>1 then raise exception 'Edit/completion rollback leaked facts'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;
  v_receipt:=public.adventure_planning_command(v_owner,'clock-task-complete',1,jsonb_build_object('type','completeTask','id',v_task));
  select id into v_done from public.adventure_events where owner_id=v_owner and kind='task_completed';
  update public.adventure_accounts set total_xp=2 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-cancel',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Partial cancellation accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task and status='completed')
    or exists(select 1 from public.adventure_events where owner_id=v_owner and invalidated_at is not null)
    or (select revision from public.adventure_accounts where owner_id=v_owner)<>2 then raise exception 'Cancellation rollback leaked facts'; end if;
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  -- Fixture models the same facts after a day has passed; no client clock enters a command.
  update public.adventure_events set occurred_on=v_today-1,occurred_at=occurred_at-interval '1 day' where owner_id=v_owner and kind in ('task_completed','reward_task');
  update public.adventure_tasks set completed_on=v_today-1,completed_at=completed_at-interval '1 day' where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'clock-cancel-new',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Past completion cancelled';
  exception when others then if sqlerrm<>'DATE_LOCKED' then raise; end if; end;
  if public.adventure_planning_command(v_owner,'clock-task-complete',1,jsonb_build_object('type','completeTask','id',v_task))<>v_receipt then raise exception 'Cross-day replay changed receipt'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1 then raise exception 'Cross-day replay changed XP'; end if;
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,'public.adventure_workspace_read(uuid,integer,integer,text,integer)','EXECUTE')
      or has_function_privilege(v_role,'public.adventure_task_apply(uuid,text,bigint,jsonb,timestamptz)','EXECUTE')
      or has_function_privilege(v_role,'public.adventure_growth(uuid,integer,integer)','EXECUTE') then raise exception 'Browser can access task RPC'; end if;
  end loop;
end $$;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_source uuid;
  v_destination uuid;
  v_main uuid;
  v_task uuid;
  v_done uuid;
  v_receipt jsonb;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'history-source-goal',0,'{"type":"createGoal","title":"原目标","standards":["结果"],"destination":""}');
  v_source:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'history-destination',1,'{"type":"createGoal","title":"当前目标","standards":["结果"],"destination":""}');
  v_destination:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'history-task-create',2,jsonb_build_object('type','createTask','title','行动快照','description','原始说明','plannedOn',v_today,'destination',v_source));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'history-task-complete',3,jsonb_build_object('type','completeTask','id',v_task));
  select id into v_done from public.adventure_events where owner_id=v_owner and kind='task_completed';
  -- Controlled facts for commands that later tickets will expose.
  update public.adventure_tasks set goal_id=v_destination where owner_id=v_owner and id=v_task;
  update public.adventure_goals set status='ended',terminated_at=clock_timestamp(),termination_cause='ended' where owner_id=v_owner and id=v_source;
  begin
    perform public.adventure_planning_command(v_owner,'history-cancel-denied',4,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Historical terminal goal bypassed';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  if not exists(select 1 from public.adventure_events where id=v_done and goal_id=v_source and snapshot->>'title'='行动快照' and snapshot->>'description'='原始说明' and invalidated_at is null) then raise exception 'History was rewritten'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1 then raise exception 'Terminal lock changed growth'; end if;
end $$;

rollback;
