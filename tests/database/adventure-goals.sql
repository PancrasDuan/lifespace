begin;
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_task uuid;
  v_in uuid;
  v_out uuid;
  v_pending uuid;
  v_deleted uuid;
  v_completion uuid;
  v_receipt jsonb;
  v_preview jsonb;
  v_goal public.adventure_goals;
  v_version bigint;
  v_xp bigint;
  v_events bigint;
  v_role text;
  v_signature text;
  v_today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  v_receipt:=public.adventure_planning_command(v_owner,'goal-source-a',0,'{"type":"createGoal","destination":"","title":"历史来源 A","standards":["成果标准"]}');
  v_a:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-source-b',1,'{"type":"createGoal","destination":"","title":"历史来源 B","standards":["标准"]}');
  v_b:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-action-out',2,jsonb_build_object('type','createTask','title','迁出行动','description','','destination',v_a,'plannedOn',v_today));
  v_out:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'goal-complete-out',3,jsonb_build_object('type','completeTask','id',v_out));
  v_receipt:=public.adventure_planning_command(v_owner,'goal-action-in',4,jsonb_build_object('type','createTask','title','迁入行动','description','','destination',v_b,'plannedOn',v_today));
  v_in:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'goal-complete-in',5,jsonb_build_object('type','completeTask','id',v_in));
  v_receipt:=public.adventure_planning_command(v_owner,'goal-action-cancel',6,jsonb_build_object('type','createTask','title','失效行动','description','','destination',v_a,'plannedOn',v_today));
  v_task:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-complete-cancel',7,jsonb_build_object('type','completeTask','id',v_task));
  v_completion:=(v_receipt->'result'->>'completionId')::uuid;
  perform public.adventure_planning_command(v_owner,'goal-cancel-action',8,jsonb_build_object('type','cancelTaskCompletion','completionId',v_completion));
  -- Migration is not exposed by #59; these current-row fixtures are rolled back.
  update public.adventure_tasks set goal_id=v_b where owner_id=v_owner and id=v_out;
  update public.adventure_tasks set goal_id=v_a where owner_id=v_owner and id=v_in;
  v_preview:=public.adventure_planning_preview(v_owner,9,jsonb_build_object('type','achieveGoal','id',v_a));
  if v_preview->'rewards'->2->'calculation'->>'count'<>'1'
    or v_preview->'rewards'->2->'calculation'->'actionIds'<>jsonb_build_array(v_out)
    or v_preview->'rewards'->2->>'amount'<>'3' then raise exception 'Current attribution or invalid completion changed historical N'; end if;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-frozen-achieve',9,jsonb_build_object('type','achieveGoal','id',v_a,'coefficient',3,'reflection','冻结评价'));
  select * into strict v_goal from public.adventure_goals where owner_id=v_owner and id=v_a;
  if v_goal.status<>'achieved' or v_goal.focused or v_goal.attainment_action_ids<>array[v_out] or v_goal.attainment_action_count<>1
    or v_goal.attainment_coefficient<>3 or v_goal.attainment_reflection<>'冻结评价'
    or v_goal.attainment_snapshot->'actionSources'->0->'source'->>'title'<>'迁出行动' then raise exception 'Goal frozen evidence mismatch'; end if;
  if (select total_xp from public.adventure_accounts where owner_id=v_owner)<>5 then raise exception 'Goal XP mismatch'; end if;
  select id into v_completion from public.adventure_events where owner_id=v_owner and task_id=v_out and kind='task_completed' and invalidated_at is null;
  begin
    perform public.adventure_planning_command(v_owner,'goal-historical-lock',10,jsonb_build_object('type','cancelTaskCompletion','completionId',v_completion));
    raise exception 'Historical source terminal lock bypassed';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  select id into v_completion from public.adventure_events where owner_id=v_owner and task_id=v_in and kind='task_completed' and invalidated_at is null;
  begin
    perform public.adventure_planning_command(v_owner,'goal-current-lock',10,jsonb_build_object('type','cancelTaskCompletion','completionId',v_completion));
    raise exception 'Current source terminal lock bypassed';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  if public.adventure_planning_command(v_owner,'goal-frozen-achieve',0,jsonb_build_object('type','achieveGoal','id',v_a,'coefficient',3,'reflection','冻结评价'))<>v_receipt
    then raise exception 'Achievement historical replay changed'; end if;
  begin
    insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,goal_id,occurred_on,actor_owner_id,amount,calculation,snapshot)
      select owner_id,gen_random_uuid(),kind,entity_type,entity_id,mainline_id,goal_id,occurred_on,actor_owner_id,amount,calculation,snapshot
      from public.adventure_events where owner_id=v_owner and kind='goal_achieved';
    raise exception 'Duplicate achievement index missing';
  exception when unique_violation then null; end;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-rollback-create',10,'{"type":"createGoal","destination":"","title":"回滚成果","standards":["标准"]}');
  v_c:=(v_receipt->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(v_owner,'goal-rollback-focus',11,jsonb_build_object('type','focusGoal','id',v_c,'focused',true));
  v_receipt:=public.adventure_planning_command(v_owner,'goal-rollback-pending',12,jsonb_build_object('type','createTask','title','保持待完成','description','','destination',v_c,'plannedOn',v_today));
  v_pending:=(v_receipt->'result'->>'entityId')::uuid;
  v_receipt:=public.adventure_planning_command(v_owner,'goal-deleted-pending',13,jsonb_build_object('type','createTask','title','已删除不传播','description','','destination',v_c,'plannedOn',v_today));
  v_deleted:=(v_receipt->'result'->>'entityId')::uuid;
  update public.adventure_tasks set deleted_at=clock_timestamp() where owner_id=v_owner and id=v_deleted;
  select revision,total_xp into v_version,v_xp from public.adventure_accounts where owner_id=v_owner;
  select count(*) into v_events from public.adventure_events where owner_id=v_owner;
  update public.adventure_accounts set total_xp=total_xp+1 where owner_id=v_owner;
  begin
    perform public.adventure_planning_command(v_owner,'goal-force-rollback',v_version,jsonb_build_object('type','achieveGoal','id',v_c));
    raise exception 'Inconsistent rewards accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if not exists(select 1 from public.adventure_goals where owner_id=v_owner and id=v_c and status='active' and focused)
    or not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_pending and status='pending')
    or (select count(*) from public.adventure_events where owner_id=v_owner)<>v_events
    or (select revision from public.adventure_accounts where owner_id=v_owner)<>v_version
    or (select total_xp from public.adventure_accounts where owner_id=v_owner)<>v_xp+1 then raise exception 'Partial achievement survived rollback'; end if;
  update public.adventure_accounts set total_xp=v_xp where owner_id=v_owner;
  perform public.adventure_planning_command(v_owner,'goal-propagate-final',v_version,jsonb_build_object('type','achieveGoal','id',v_c));
  if not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_pending and status='ended' and end_cause='goal_achieved')
    or not exists(select 1 from public.adventure_tasks where owner_id=v_owner and id=v_deleted and status='pending') then raise exception 'Goal termination propagation mismatch'; end if;
  select id into v_task from public.adventure_goals where owner_id=v_owner and kind='inbox';
  begin
    perform public.adventure_planning_command(v_owner,'inbox-achieve-invalid',v_version+1,jsonb_build_object('type','achieveGoal','id',v_task));
    raise exception 'Inbox achieved';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_signature in array array['adventure_goal_reward(uuid,uuid,integer)','adventure_goal_apply(uuid,text,bigint,jsonb,timestamptz)',
      'adventure_goal_view(uuid,uuid)','adventure_task_view(uuid,uuid,date)'] loop
      if has_function_privilege(v_role,'public.'||v_signature,'EXECUTE') then raise exception 'Browser can call goal RPC'; end if;
    end loop;
  end loop;
end $$;
rollback;
