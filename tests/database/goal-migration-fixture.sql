-- Synthetic legacy data only. Run against a freshly initialized isolated database.
insert into public.adventure_accounts(owner_id,total_xp,revision,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000001',4,31,'2020-01-01','2020-02-01'),
 ('00000000-0000-4000-8000-000000000002',1,9,'2020-01-01','2020-02-01');

insert into public.adventure_mainlines(id,owner_id,kind,name,status,created_at,updated_at,ended_at) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','normal','同名','active','2020-01-01','2020-01-01',null),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','normal','同名','active','2020-01-01','2020-01-01',null),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','independent','独立区','active','2020-01-02','2020-01-02',null),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','normal','已结束','ended','2020-01-03','2020-01-04','2020-01-04'),
 ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','normal','同名','active','2020-01-01','2020-01-01',null),
 ('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','independent','独立区','active','2020-01-02','2020-01-02',null);

insert into public.adventure_goals(id,owner_id,mainline_id,kind,title,standards,status,focused,sort_order,created_at,updated_at,terminated_at,termination_cause,achieved_at,achieved_on,attainment_coefficient,attainment_reflection,attainment_action_count,attainment_action_ids,attainment_snapshot) values
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','real','同名','["同名"]','active',true,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','real','同名','["标准"]','active',true,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','real','未聚焦','["标准"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','real','独立目标','["标准"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','inbox','独立任务','["系统"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','real','随主线结束','["标准"]','ended',false,0,'2020-01-05','2020-01-05','2020-01-06','mainline_ended',null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','real','已达成','["标准"]','achieved',false,0,'2020-01-05','2020-01-06','2020-01-06','achieved','2020-01-06','2020-01-06',3,'同名',1,array['30000000-0000-4000-8000-000000000001']::uuid[], '{"title":"同名","mainlineName":"旧名","actionSources":[{"mainlineId":"10000000-0000-4000-8000-000000000001","source":{"goalTitle":"同名","mainlineKind":"normal"}}]}'),
 ('20000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005','real','同名','["标准"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006','inbox','独立任务','["系统"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','real','未聚焦同组','["标准"]','active',false,0,'2020-01-05','2020-01-05',null,null,null,null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','real','手动结束','["标准"]','ended',false,0,'2020-01-05','2020-01-06','2020-01-06','ended',null,null,null,null,null,null,null);

-- Non-active rows must retain their original order keys during migration.
update public.adventure_goals set sort_order=37 where id='20000000-0000-4000-8000-000000000005';
update public.adventure_goals set sort_order=42 where id='20000000-0000-4000-8000-000000000006';
update public.adventure_goals set sort_order=51 where id='20000000-0000-4000-8000-000000000007';

insert into public.adventure_tasks(id,owner_id,goal_id,title,description,planned_on,status,completed_at,completed_on,ended_at,end_cause,deleted_at,created_at,updated_at) values
 ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','迁入后的完成','同名','2020-01-05','completed','2020-01-06','2020-01-06',null,null,null,'2020-01-05','2020-01-06'),
 ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','取消完成','保留','2020-01-05','pending',null,null,null,null,null,'2020-01-05','2020-01-06'),
 ('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','独立任务','保留','2020-01-05','pending',null,null,null,null,null,'2020-01-05','2020-01-05'),
 ('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','已删除','保留','2020-01-05','pending',null,null,null,null,'2020-01-06','2020-01-05','2020-01-06'),
 ('30000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006','已结束','保留','2020-01-05','ended',null,null,'2020-01-06','mainline_ended',null,'2020-01-05','2020-01-06'),
 ('30000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000009','独立完成','同名','2020-01-05','completed','2020-01-06','2020-01-06',null,null,null,'2020-01-05','2020-01-06');

insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,mainline_id,goal_id,occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at) values
 ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','task_completed','task','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','2020-01-06','2020-01-06','00000000-0000-4000-8000-000000000001','complete-001',repeat('a',64),'completeTask',10,1,'{"type":"fixed_task","count":1,"coefficient":1}', '{"title":"同名","mainlineName":"同名","origin":{"mainlineId":"10000000-0000-4000-8000-000000000002","goalTitle":"同名"},"result":{"entityId":"30000000-0000-4000-8000-000000000001","reward":{"amount":1}}}','2020-01-06'),
 ('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','task_completed','task','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2020-01-06','2020-01-06','00000000-0000-4000-8000-000000000001','complete-002',repeat('b',64),'completeTask',11,1,'{"type":"fixed_task","count":1}', '{"title":"取消完成","before":{"mainline_id":"10000000-0000-4000-8000-000000000001"},"result":{"message":"同名","reward":{"amount":1}}}','2020-01-06'),
 ('40000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','task_completion_cancelled','task','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2020-01-07','2020-01-07','00000000-0000-4000-8000-000000000001','cancel-002',repeat('c',64),'cancelTaskCompletion',12,null,null,'{"completionId":"40000000-0000-4000-8000-000000000002","result":{"message":"已取消"}}','2020-01-07'),
 ('40000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','goal_achieved','goal','20000000-0000-4000-8000-000000000007',null,'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','2020-01-06','2020-01-06','00000000-0000-4000-8000-000000000001','achieve-001',repeat('d',64),'achieveGoal',13,3,'{"type":"goal_actions","count":1,"coefficient":3,"actionIds":["30000000-0000-4000-8000-000000000001"]}', '{"title":"同名","mainlineName":"同名","result":{"reward":{"amount":3},"source":{"mainlineKind":"normal","title":"同名"}}}','2020-01-06'),
 ('40000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005','task_migrated','task','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','2020-01-05','2020-01-05','00000000-0000-4000-8000-000000000001','migrate-001',repeat('e',64),'migrateTask',9,null,null,'{"before":{"goal_id":"20000000-0000-4000-8000-000000000003"},"after":{"goal_id":"20000000-0000-4000-8000-000000000007"},"origin":{"mainlineName":"同名","goalTitle":"同名"},"result":{"message":"同名"}}','2020-01-05'),
 ('40000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000006','mainline_created','mainline','10000000-0000-4000-8000-000000000001',null,'10000000-0000-4000-8000-000000000001',null,'2020-01-01','2020-01-01','00000000-0000-4000-8000-000000000001','mainline-001',repeat('f',64),'createMainline',1,null,null,'{"result":{"message":"主线已创建"}}','2020-01-01'),
 ('40000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000007','task_completed','task','30000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000006',null,'2020-01-06','2020-01-06','00000000-0000-4000-8000-000000000002','complete-001',repeat('a',64),'completeTask',8,1,'{"type":"fixed_task","count":1}', '{"title":"独立完成","mainlineKind":"independent","result":{"reward":{"amount":1}}}','2020-01-06'),
 ('40000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000008','goal_migrated','goal','20000000-0000-4000-8000-000000000003',null,'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','2020-01-05','2020-01-05','00000000-0000-4000-8000-000000000001','goal-migrate-001',repeat('e',64),'migrateGoal',8,null,null,'{"before":{"mainline_id":"10000000-0000-4000-8000-000000000001","title":"同名"},"after":{"mainline_id":"10000000-0000-4000-8000-000000000002","title":"同名"},"result":{"entityId":"20000000-0000-4000-8000-000000000003"}}','2020-01-05');
update public.adventure_events set invalidated_at='2020-01-07', invalidated_by_event_id='40000000-0000-4000-8000-000000000003' where id='40000000-0000-4000-8000-000000000002';
update public.adventure_events set snapshot=snapshot || '{"mainlineDetail":{"id":"10000000-0000-4000-8000-000000000002","name":"同名"},"mainlines":[{"id":"10000000-0000-4000-8000-000000000002"}],"note":"同名"}'::jsonb where id='40000000-0000-4000-8000-000000000001';
-- The completion receipts use the real legacy command digest and can replay,
-- including the invalidated completion, before the new migration exists.
update public.adventure_events set command_hash=encode(sha256(convert_to(jsonb_build_object('type','completeTask','id',task_id)::text,'UTF8')),'hex')
where kind='task_completed';

-- Complement the fixed edge-case rows with genuine legacy RPC envelopes and
-- nested reward sources, retaining the exact commands for replay assertions.
create temporary table goal_fixture_receipts(owner_id uuid, request_id text, command jsonb, receipt jsonb);
do $$
declare o uuid:='00000000-0000-4000-8000-000000000003'; m uuid; source_goal uuid; target_goal uuid; task uuid; cancelled_task uuid; completion uuid;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; r jsonb; c jsonb;
begin
  r:=public.adventure_planning_command(o,'rpc-mainline',0,'{"type":"createMainline","name":"RPC主线"}'); m:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'rpc-source-goal',1,jsonb_build_object('type','createGoal','destination',m,'title','RPC来源','standards',jsonb_build_array('来源标准'))); source_goal:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'rpc-target-goal',2,jsonb_build_object('type','createGoal','destination',m,'title','RPC成果','standards',jsonb_build_array('成果标准'))); target_goal:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'rpc-create-task',3,jsonb_build_object('type','createTask','destination',source_goal,'title','RPC迁移任务','description','原始说明','plannedOn',today)); task:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','editTask','id',task,'destination',target_goal,'title','RPC迁移任务','description','原始说明','plannedOn',today);
  r:=public.adventure_planning_command(o,'rpc-move-task',4,c); insert into goal_fixture_receipts values(o,'rpc-move-task',c,r);
  c:=jsonb_build_object('type','completeTask','id',task);
  r:=public.adventure_planning_command(o,'rpc-complete-task',5,c); insert into goal_fixture_receipts values(o,'rpc-complete-task',c,r);
  r:=public.adventure_planning_command(o,'rpc-create-cancel',6,jsonb_build_object('type','createTask','destination','','title','RPC取消完成','description','保留说明','plannedOn',today)); cancelled_task:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','completeTask','id',cancelled_task);
  r:=public.adventure_planning_command(o,'rpc-complete-cancel',7,c); completion:=(r->'result'->>'completionId')::uuid;
  insert into goal_fixture_receipts values(o,'rpc-complete-cancel',c,r);
  c:=jsonb_build_object('type','cancelTaskCompletion','completionId',completion);
  r:=public.adventure_planning_command(o,'rpc-cancel-task',8,c); insert into goal_fixture_receipts values(o,'rpc-cancel-task',c,r);
  c:=jsonb_build_object('type','achieveGoal','id',target_goal,'coefficient',3,'reflection','冻结评价');
  r:=public.adventure_planning_command(o,'rpc-achieve-goal',9,c); insert into goal_fixture_receipts values(o,'rpc-achieve-goal',c,r);
end $$;

-- A completion remains locked if its former mainline ends after its goal moved.
-- The current goal and task stay active/completed, so their state alone is not
-- enough to reconstruct this legacy cancellation rule.
create temporary table goal_fixture_historical_lock(owner_id uuid, completion_id uuid, cancel_command jsonb, unlocked_completion_id uuid, invalidated_completion_id uuid, expected_version bigint);
do $$
declare o uuid:='00000000-0000-4000-8000-000000000004'; a uuid; b uuid; g uuid; t uuid; e uuid; unlocked uuid; cancelled uuid;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; r jsonb; c jsonb;
begin
  r:=public.adventure_planning_command(o,'lock-main-a',0,'{"type":"createMainline","name":"旧方向"}'); a:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'lock-main-b',1,'{"type":"createMainline","name":"新方向"}'); b:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'lock-goal-a',2,jsonb_build_object('type','createGoal','destination',a,'title','转移的目标','standards',jsonb_build_array('标准'))); g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'lock-task-a',3,jsonb_build_object('type','createTask','destination',g,'title','历史锁定任务','description','','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'lock-complete',4,jsonb_build_object('type','completeTask','id',t)); e:=(r->'result'->>'completionId')::uuid;
  r:=public.adventure_planning_command(o,'lock-cancelled-create',5,jsonb_build_object('type','createTask','destination',g,'title','已取消历史','description','','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','completeTask','id',t);
  r:=public.adventure_planning_command(o,'lock-cancelled-complete',6,c); cancelled:=(r->'result'->>'completionId')::uuid;
  insert into goal_fixture_receipts values(o,'lock-cancelled-complete',c,r);
  c:=jsonb_build_object('type','cancelTaskCompletion','completionId',cancelled);
  r:=public.adventure_planning_command(o,'lock-cancelled-cancel',7,c); insert into goal_fixture_receipts values(o,'lock-cancelled-cancel',c,r);
  perform public.adventure_planning_command(o,'lock-cancelled-delete',8,jsonb_build_object('type','deleteTask','id',t));
  c:=jsonb_build_object('type','migrateGoal','id',g,'destination',b);
  r:=public.adventure_planning_command(o,'lock-move-goal',9,c); insert into goal_fixture_receipts values(o,'lock-move-goal',c,r);
  perform public.adventure_planning_command(o,'lock-end-main',10,jsonb_build_object('type','endMainline','id',a));
  c:=jsonb_build_object('type','cancelTaskCompletion','completionId',e);
  begin
    perform public.adventure_planning_command(o,'lock-cancel',11,c);
    raise exception 'historical lock missing before migration';
  exception when others then
    if sqlerrm <> 'READ_ONLY' then raise; end if;
  end;
  r:=public.adventure_planning_command(o,'lock-new-task',11,jsonb_build_object('type','createTask','destination',g,'title','可以取消的任务','description','','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','completeTask','id',t);
  r:=public.adventure_planning_command(o,'lock-new-complete',12,c); unlocked:=(r->'result'->>'completionId')::uuid;
  insert into goal_fixture_receipts values(o,'lock-new-complete',c,r);
  -- Build genuine legacy helper receipts under the account lock. They represent
  -- old successful commands, even though new requests are now disabled.
  r:=public.adventure_planning_command(o,'legacy-retired-create',13,jsonb_build_object('type','createTask','destination',g,'title','旧命令回执','description','','plannedOn',today)); t:=(r->'result'->>'entityId')::uuid;
  perform 1 from public.adventure_accounts where owner_id=o for update;
  c:=jsonb_build_object('type','rescheduleTask','id',t,'plannedOn',today+1);
  r:=public.adventure_task_apply(o,'legacy-reschedule',14,c,clock_timestamp()); insert into goal_fixture_receipts values(o,'legacy-reschedule',c,r);
  c:=jsonb_build_object('type','migrateTask','id',t,'destination','');
  r:=public.adventure_task_apply(o,'legacy-migrate-task',15,c,clock_timestamp()); insert into goal_fixture_receipts values(o,'legacy-migrate-task',c,r);
  c:=jsonb_build_object('type','endTask','id',t);
  r:=public.adventure_task_apply(o,'legacy-end-task',16,c,clock_timestamp()); insert into goal_fixture_receipts values(o,'legacy-end-task',c,r);
  insert into goal_fixture_historical_lock values(o,e,jsonb_build_object('type','cancelTaskCompletion','completionId',e),unlocked,cancelled,17);
end $$;
