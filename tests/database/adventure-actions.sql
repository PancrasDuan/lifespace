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
    jsonb_build_object('type','createTask','title','今天行动','description','完整行动','plannedOn',v_today,'destination',''));
  v_task := (v_receipt->'result'->>'entityId')::uuid;
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if v_page->'tasks'->0->>'id' is distinct from v_task::text or v_page->'growth'->>'totalXp' is distinct from '0' then raise exception 'Task create/read failed'; end if;
  v_receipt := public.adventure_planning_command(v_owner,'actions-complete-01',1,jsonb_build_object('type','completeTask','id',v_task));
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  v_done := (v_page->'tasks'->0->>'completionId')::uuid;
  if v_done is null or v_page->'growth'->>'totalXp' is distinct from '1' or v_page->'growth'->>'actions' is distinct from '1'
    or v_page->'tasks'->0->>'status' is distinct from 'completed' then raise exception 'Atomic completion/reward failed'; end if;
  if (select count(*) from public.adventure_events where owner_id=v_owner) <> 2
    or not exists(select 1 from public.adventure_events where id=v_done and amount=1 and calculation->>'type'='fixed_task'
      and calculation->>'completionId'=v_done::text and calculation->>'count'='1' and calculation->>'coefficient'='1')
    then raise exception 'Completion must be the single frozen reward event'; end if;
  v_page := public.adventure_planning_preview(v_owner,2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if v_page->>'requiresConfirmation' is distinct from 'true' or v_page->'growthAfter'->>'totalXp' is distinct from '0' then raise exception 'Cancellation preview failed'; end if;
  perform public.adventure_planning_command(v_owner,'actions-cancel-01',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if v_page->'growth'->>'totalXp' is distinct from '0' or v_page->'growth'->>'actions' is distinct from '0' or v_page->'tasks'->0->>'status' is distinct from 'pending' then raise exception 'Cancellation facts mismatch'; end if;
  if (select count(*) from public.adventure_events where owner_id=v_owner and kind='task_completed' and invalidated_at is not null) <> 1
    or not exists(select 1 from public.adventure_events c join public.adventure_events e on e.invalidated_by_event_id=c.id
      where e.id=v_done and e.amount=1 and c.kind='task_completion_cancelled' and c.snapshot->>'completionId'=v_done::text and c.amount is null)
    then raise exception 'Cancellation must retain the frozen reward on its original completion'; end if;
  if (v_page->'growth'->'achievements'->0->>'unlocked')::boolean is distinct from false then raise exception 'Cancelled action achievement remained lit'; end if;
  perform public.adventure_planning_command(v_owner,'actions-complete-02',3,jsonb_build_object('type','completeTask','id',v_task));
  perform public.adventure_planning_command(v_owner,'actions-cancel-01',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if public.adventure_planning_command(v_owner,'actions-complete-01',1,jsonb_build_object('type','completeTask','id',v_task)) <> v_receipt then raise exception 'Historical completion receipt changed'; end if;
  begin
    perform public.adventure_planning_command(v_owner,'actions-stale-cancel',4,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Old cancellation affected new completion';
  exception when others then if sqlerrm is distinct from 'COMPLETION_CHANGED' then raise; end if; end;
  v_page := public.adventure_workspace_read(v_owner,1,20,'today',1);
  if (select count(*) from public.adventure_events where owner_id=v_owner and kind='task_completed')<>2
    or (select count(*) from public.adventure_events where owner_id=v_owner and kind='task_completed' and invalidated_at is null and amount=1)<>1
    then raise exception 'Recompletion reused history or duplicated reward'; end if;
  if v_page->>'version' is distinct from '4' or v_page->'growth'->>'totalXp' is distinct from '1' or v_page->'tasks'->0->>'status' is distinct from 'completed' then raise exception 'Retries changed newer result'; end if;
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
    perform public.adventure_planning_command(v_owner,'rollback-task-create',0,jsonb_build_object('type','createTask','title','必须回滚','description','','plannedOn',v_today,'destination',''));
    raise exception 'Partial task accepted';
  exception when others then if sqlerrm is distinct from 'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_tasks where owner_id=v_owner) or exists(select 1 from public.adventure_mainlines where owner_id=v_owner)
    or exists(select 1 from public.adventure_events where owner_id=v_owner) or (select revision from public.adventure_accounts where owner_id=v_owner)<>0 then raise exception 'Partial task/structure/event survived rollback'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;
  v_receipt:=public.adventure_planning_command(v_owner,'clock-task-create',0,jsonb_build_object('type','createTask','title','冻结行动','description','','plannedOn',v_today,'destination',''));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-edit',1,jsonb_build_object('type','editTask','id',v_task,'title','错误改名','description','错误说明'));
    raise exception 'Partial edit accepted';
  exception when others then if sqlerrm is distinct from 'INCONSISTENT_REWARDS' then raise; end if; end;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-complete',1,jsonb_build_object('type','completeTask','id',v_task));
    raise exception 'Partial completion accepted';
  exception when others then if sqlerrm is distinct from 'INCONSISTENT_REWARDS' then raise; end if; end;
  if not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task and title='冻结行动' and status='pending')
    or (select count(*) from public.adventure_events where owner_id=v_owner)<>1 then raise exception 'Edit/completion rollback leaked facts'; end if;
  update public.adventure_accounts set total_xp=0 where owner_id=v_owner;
  v_receipt:=public.adventure_planning_command(v_owner,'clock-task-complete',1,jsonb_build_object('type','completeTask','id',v_task));
  select id into v_done from public.adventure_events where owner_id=v_owner and kind='task_completed';
  update public.adventure_accounts set total_xp=2 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'rollback-task-cancel',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Partial cancellation accepted';
  exception when others then if sqlerrm is distinct from 'INCONSISTENT_REWARDS' then raise; end if; end;
  if not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_task and status='completed')
    or exists(select 1 from public.adventure_events where owner_id=v_owner and invalidated_at is not null)
    or (select revision from public.adventure_accounts where owner_id=v_owner)<>2 then raise exception 'Cancellation rollback leaked facts'; end if;
  update public.adventure_accounts set total_xp=1 where owner_id=v_owner;
  -- Fixture models the same facts after a day has passed; no client clock enters a command.
  update public.adventure_events set occurred_on=v_today-1,occurred_at=occurred_at-interval '1 day' where owner_id=v_owner and kind='task_completed';
  update public.adventure_tasks set completed_on=v_today-1,completed_at=completed_at-interval '1 day' where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'clock-cancel-new',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
    raise exception 'Past completion cancelled';
  exception when others then if sqlerrm is distinct from 'DATE_LOCKED' then raise; end if; end;
  if public.adventure_planning_command(v_owner,'clock-task-complete',1,jsonb_build_object('type','completeTask','id',v_task))<>v_receipt then raise exception 'Cross-day replay changed receipt'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1 then raise exception 'Cross-day replay changed XP'; end if;
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,'public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer)','EXECUTE')
      or has_function_privilege(v_role,'public.adventure_task_apply(uuid,text,bigint,jsonb,timestamptz)','EXECUTE')
      or has_function_privilege(v_role,'public.adventure_growth(uuid,bigint,integer)','EXECUTE') then raise exception 'Browser can access task RPC'; end if;
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
  exception when others then if sqlerrm is distinct from 'READ_ONLY' then raise; end if; end;
  if not exists(select 1 from public.adventure_events where id=v_done and goal_id=v_source and snapshot->>'title'='行动快照' and snapshot->>'description'='原始说明' and invalidated_at is null) then raise exception 'History was rewritten'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>1 then raise exception 'Terminal lock changed growth'; end if;
end $$;

-- A historical rule fixture proves preview/cancellation use the stored amount, not today's +1 rule.
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_receipt jsonb;
  v_task uuid;
  v_done uuid;
  v_page jsonb;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'frozen-create-task',0,
    jsonb_build_object('type','createTask','title','历史规则行动','description','','plannedOn',v_today,'destination',''));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'frozen-complete-task',1,jsonb_build_object('type','completeTask','id',v_task));
  select id into strict v_done from public.adventure_events where owner_id=v_owner and kind='task_completed';
  update public.adventure_events set amount=3000000000,calculation=jsonb_set(calculation,'{coefficient}','3000000000') where id=v_done;
  update public.adventure_accounts set total_xp=3000000000 where owner_id=v_owner;
  v_page:=public.adventure_workspace_read(v_owner);
  if v_page->'tasks'->0->'reward'->>'amount' is distinct from '3000000000'
    or v_page->'tasks'->0->'reward'->'calculation'->>'coefficient' is distinct from '3000000000' then raise exception 'Historical reward recalculated'; end if;
  v_page:=public.adventure_planning_preview(v_owner,2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if v_page->'growthAfter'->>'totalXp' is distinct from '0' or v_page->'reward'->>'amount' is distinct from '3000000000' then raise exception 'Preview did not use frozen amount'; end if;
  v_receipt:=public.adventure_planning_command(v_owner,'frozen-cancel-task',2,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  if v_receipt->'result'->'growthChange'->>'xpDelta' is distinct from '-3000000000'
    or v_receipt->'result'->'reward'->>'amount' is distinct from '3000000000' then raise exception 'Cancellation recalculated reward'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>0
    or not exists(select 1 from public.adventure_events where id=v_done and amount=3000000000 and invalidated_at is not null)
    then raise exception 'Frozen reward cancellation mismatch'; end if;
end $$;

-- Storage contracts prevent split reward facts, duplicate completions and reversible goal achievements.
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_task uuid;
  v_done public.adventure_events;
  v_goal uuid;
  v_main uuid;
  v_id uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_receipt jsonb;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'shape-create-task',0,
    jsonb_build_object('type','createTask','title','约束行动','description','','plannedOn',v_today,'destination',''));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'shape-complete-task',1,jsonb_build_object('type','completeTask','id',v_task));
  select * into strict v_done from public.adventure_events where owner_id=v_owner and kind='task_completed';
  begin
    insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,task_id,occurred_on,actor_owner_id,amount,calculation,snapshot)
      values(v_owner,gen_random_uuid(),'task_completed','task',v_task,v_task,v_today,v_owner,1,'{}','{}');
    raise exception 'Duplicate valid completion accepted';
  exception when unique_violation then null; end;
  begin
    update public.adventure_events set amount=null where id=v_done.id;
    raise exception 'Completion without reward accepted';
  exception when check_violation then null; end;
  begin
    update public.adventure_events set amount=1,calculation='{}' where owner_id=v_owner and kind='task_created';
    raise exception 'Separate reward attached to creation';
  exception when check_violation then null; end;
  begin
    update public.adventure_events set task_id=null where id=v_done.id;
    raise exception 'Completion without task accepted';
  exception when check_violation then null; end;
  if exists(select 1 from pg_indexes where schemaname='public' and indexname='adventure_one_valid_task_reward')
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='adventure_events' and column_name in ('reward_task_id','reward_goal_id'))
    then raise exception 'Independent reward storage survived'; end if;
  v_receipt:=public.adventure_planning_command(v_owner,'shape-create-goal',2,'{"type":"createGoal","title":"未来达成契约","standards":["明确结果"],"destination":""}');
  v_goal:=(v_receipt->'result'->>'entityId')::uuid;
  select mainline_id into v_main from public.adventure_goals where id=v_goal;
  -- Storage fixture only: there is deliberately no goal achievement command in this slice.
  insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,goal_id,mainline_id,occurred_on,actor_owner_id,amount,calculation,snapshot)
    values(v_id,v_owner,gen_random_uuid(),'goal_achieved','goal',v_goal,v_goal,v_main,v_today,v_owner,1,
      '{"type":"goal_actions","actionIds":[],"count":0,"coefficient":1,"fallback":true}',jsonb_build_object('title','未来达成契约','standards',jsonb_build_array('明确结果')));
  begin
    insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,goal_id,occurred_on,actor_owner_id,amount,calculation,snapshot)
      values(v_owner,gen_random_uuid(),'goal_achieved','goal',v_goal,v_goal,v_today,v_owner,1,'{}','{}');
    raise exception 'Second goal achievement accepted';
  exception when unique_violation then null; end;
  begin
    update public.adventure_events set invalidated_at=clock_timestamp(),invalidated_by_event_id=v_done.id where id=v_id;
    raise exception 'Goal achievement invalidated';
  exception when check_violation then null; end;
end $$;

-- A frozen historical reward aligns the XP and tenth-action badge thresholds at the same boundary.
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_task uuid;
  v_done uuid;
  v_version bigint:=0;
  v_result jsonb;
  v_page jsonb;
begin
  for i in 1..10 loop
    v_result:=public.adventure_planning_command(v_owner,'threshold-create-'||i,v_version,
      jsonb_build_object('type','createTask','title','临界行动 '||i,'description','','plannedOn',v_today,'destination',''));
    v_task:=(v_result->'result'->>'entityId')::uuid;v_version:=v_version+1;
    if i=10 then
      v_page:=public.adventure_workspace_read(v_owner);
      if v_page->'growth'->>'totalXp' is distinct from '19' or v_page->'growth'->>'actions' is distinct from '9' or v_page->'growth'->>'level' is distinct from '1'
        or (v_page->'growth'->'achievements'->1->>'unlocked')::boolean is distinct from false then raise exception '19 XP / nine actions fixture mismatch'; end if;
    end if;
    v_result:=public.adventure_planning_command(v_owner,'threshold-complete-'||i,v_version,jsonb_build_object('type','completeTask','id',v_task));
    v_version:=v_version+1;v_done:=(v_result->'result'->>'completionId')::uuid;
    if i=1 then
      update public.adventure_events set amount=11,calculation=jsonb_set(calculation,'{coefficient}','11') where id=v_done;
      update public.adventure_accounts set total_xp=11 where owner_id=v_owner;
    end if;
  end loop;
  if v_result->'result'->'growthChange'->'after'->>'totalXp' is distinct from '20'
    or v_result->'result'->'growthChange'->'after'->>'level' is distinct from '2'
    or v_result->'result'->'growthChange'->'unlocked' is distinct from '["十次行动"]'::jsonb then raise exception '20 XP / tenth action not unlocked'; end if;
  v_result:=public.adventure_planning_command(v_owner,'threshold-cancel-10',v_version,jsonb_build_object('type','cancelTaskCompletion','completionId',v_done));
  v_version:=v_version+1;
  if v_result->'result'->'growthChange'->'after'->>'totalXp' is distinct from '19'
    or v_result->'result'->'growthChange'->'after'->>'level' is distinct from '1'
    or v_result->'result'->'growthChange'->'lost' is distinct from '["十次行动"]'::jsonb then raise exception 'Threshold cancellation did not roll back growth'; end if;
  v_result:=public.adventure_planning_command(v_owner,'threshold-redo-10',v_version,jsonb_build_object('type','completeTask','id',v_task));
  if v_result->'result'->'growthChange'->'after'->>'totalXp' is distinct from '20'
    or v_result->'result'->'growthChange'->'unlocked' is distinct from '["十次行动"]'::jsonb
    or (select sum(amount) from public.adventure_events where owner_id=v_owner and kind='task_completed' and invalidated_at is null)<>20
    or (select count(*) from public.adventure_events where owner_id=v_owner and kind='task_completed')<>11 then raise exception 'Threshold recompletion ledger mismatch'; end if;
end $$;

-- #65: focus quota, stable adjacent ordering, task scope/search and full progress.
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_main uuid;
  v_goals uuid[]:=array[]::uuid[];
  v_receipt jsonb;
  v_page jsonb;
  v_task uuid;
  v_ids uuid[]:=array[]::uuid[];
  i integer;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'focus-main-create',0,jsonb_build_object('type','createMainline','name','聚焦主线'));
  v_main:=(v_receipt->'result'->>'entityId')::uuid;
  for i in 1..4 loop
    v_receipt:=public.adventure_planning_command(v_owner,'focus-goal-'||i,i,jsonb_build_object('type','createGoal','destination',v_main,'title','目标 '||i,'standards',jsonb_build_array('标准 '||i)));
    v_goals:=array_append(v_goals,(v_receipt->'result'->>'entityId')::uuid);
  end loop;
  for i in 1..3 loop
    perform public.adventure_planning_command(v_owner,'focus-on-'||i,4+i,jsonb_build_object('type','focusGoal','id',v_goals[i],'focused',true));
  end loop;
  begin
    perform public.adventure_planning_command(v_owner,'focus-over-limit',8,jsonb_build_object('type','focusGoal','id',v_goals[4],'focused',true));
    raise exception 'Fourth focused goal accepted';
  exception when others then if sqlerrm<>'FOCUS_LIMIT' then raise; end if; end;
  v_page:=public.adventure_workspace_read(v_owner);
  if (v_page->'goals'->0->>'focused')::boolean is not true or (v_page->'goals'->2->>'focused')::boolean is not true or (v_page->'goals'->3->>'focused')::boolean then raise exception 'Focused goals not ordered first'; end if;
  perform public.adventure_planning_command(v_owner,'focus-move-up',8,jsonb_build_object('type','reorderGoals','mainlineId',v_main,'direction','up','id',v_goals[3]));
  v_page:=public.adventure_workspace_read(v_owner);
  if v_page->'goals'->1->>'id'<>v_goals[3]::text then raise exception 'Reorder did not persist'; end if;
  for i in 1..4 loop
    v_receipt:=public.adventure_planning_command(v_owner,'scope-task-'||i,8+i,jsonb_build_object('type','createTask','title',case when i=4 then '另一项' else '匹配行动 '||i end,'description',case when i=4 then '匹配说明' else '' end,'plannedOn',v_today,'destination',v_goals[1]));
    v_ids:=array_append(v_ids,(v_receipt->'result'->>'entityId')::uuid);
  end loop;
  perform public.adventure_planning_command(v_owner,'scope-complete-1',13,jsonb_build_object('type','completeTask','id',v_ids[1]));
  perform public.adventure_planning_command(v_owner,'scope-complete-2',14,jsonb_build_object('type','completeTask','id',v_ids[2]));
  v_page:=public.adventure_workspace_read(v_owner,1,20,'today',1,'all','匹配');
  if v_page->'totalTasks'<>'4' or jsonb_array_length(v_page->'tasks')<>4 or v_page->'taskProgress'->>'completed'<>'2' or v_page->'taskProgress'->>'total'<>'4' or (v_page->'taskProgress'->>'ratio')::numeric<>0.5 then raise exception 'Search/progress failed'; end if;
  v_page:=public.adventure_workspace_read(v_owner,1,20,'today',1,'focus','');
  if v_page->'totalTasks'<>'4' or v_page->'taskProgress'->>'total'<>'4' then raise exception 'Focused task scope failed'; end if;
  perform public.adventure_planning_command(v_owner,'focus-off-1',15,jsonb_build_object('type','focusGoal','id',v_goals[1],'focused',false));
  v_page:=public.adventure_workspace_read(v_owner,1,20,'today',1,'focus','匹配');
  if v_page->'totalTasks'<>'0' or v_page->'taskProgress'->>'ratio' is not null then raise exception 'Unfocused goal leaked into scope'; end if;
  -- Fixtures for not-yet-exposed lifecycle operations remain inside this rolled-back probe.
  update public.adventure_tasks set status='ended',ended_at=clock_timestamp(),end_cause='manual' where owner_id=v_owner and id=v_ids[4];
  v_page:=public.adventure_workspace_read(v_owner,1,1,'today',1,'all','');
  if v_page->'taskProgress'->>'completed'<>'2' or v_page->'taskProgress'->>'total'<>'3'
    or (select item->'progress'->>'total' from jsonb_array_elements(v_page->'goals') item where item->>'id'=v_goals[1]::text)<>'3' then raise exception 'Ended task or pagination changed progress'; end if;
  update public.adventure_tasks set deleted_at=clock_timestamp() where owner_id=v_owner and id=v_ids[3];
  v_page:=public.adventure_workspace_read(v_owner);
  if v_page->'taskProgress'->>'total'<>'2' then raise exception 'Deleted task counted in progress'; end if;
  select id into v_task from public.adventure_events where owner_id=v_owner and task_id=v_ids[1] and kind='task_completed' and invalidated_at is null;
  perform public.adventure_planning_command(v_owner,'scope-cancel-1',16,jsonb_build_object('type','cancelTaskCompletion','completionId',v_task));
  v_page:=public.adventure_workspace_read(v_owner);
  if v_page->'taskProgress'->>'completed'<>'1' or v_page->'taskProgress'->>'total'<>'2' then raise exception 'Invalidated completion counted'; end if;
  update public.adventure_tasks set goal_id=v_goals[2] where owner_id=v_owner and id=v_ids[2];
  v_page:=public.adventure_workspace_read(v_owner);
  if (select item->'progress'->>'total' from jsonb_array_elements(v_page->'goals') item where item->>'id'=v_goals[1]::text)<>'1'
    or not exists(select 1 from public.adventure_events where owner_id=v_owner and task_id=v_ids[2] and kind='task_completed' and goal_id=v_goals[1])
    then raise exception 'Current attribution changed frozen historical source'; end if;
  update public.adventure_goals set status='ended',focused=false,terminated_at=clock_timestamp(),termination_cause='ended' where owner_id=v_owner and id=v_goals[4];
  begin
    perform public.adventure_planning_command(v_owner,'terminal-focus-invalid',17,jsonb_build_object('type','focusGoal','id',v_goals[4],'focused',true));
    raise exception 'Terminal focus accepted';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  select id into v_task from public.adventure_goals where owner_id=v_owner and kind='inbox';
  if v_task is not null then raise exception 'Unexpected inbox fixture'; end if;
  begin
    perform public.adventure_planning_command(v_owner,'null-sort-invalid',17,jsonb_build_object('type','reorderGoals','id',v_goals[1],'mainlineId',v_main,'direction',null));
    raise exception 'Null direction accepted';
  exception when others then if sqlerrm<>'INVALID_COMMAND' then raise; end if; end;

end $$;


rollback;
