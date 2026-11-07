-- Synthetic legacy rows in the isolated database only. The previous API could end tasks.
create temporary table adventure_legacy_request(owner_id uuid, task_id uuid, command jsonb, receipt jsonb);
do $$
declare o uuid:=gen_random_uuid(); g uuid; t uuid; r jsonb; c jsonb; v bigint;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=public.adventure_planning_command(o,'upgrade-goal-create',0,jsonb_build_object('type','createGoal','title','升级历史目标','standards',jsonb_build_array('标准'),'destination',''));
  g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'upgrade-ended-create',1,jsonb_build_object('type','createTask','title','旧已结束任务','description','保留原记录','plannedOn',today,'destination',g));
  t:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','endTask','id',t);
  r:=public.adventure_task_apply(o,'upgrade-legacy-ended',2,c,clock_timestamp());
  insert into adventure_legacy_request values(o,t,c,r);
  r:=public.adventure_planning_command(o,'upgrade-done-create',3,jsonb_build_object('type','createTask','title','已完成奖励','description','','plannedOn',today,'destination',g));
  perform public.adventure_planning_command(o,'upgrade-done-finish',4,jsonb_build_object('type','completeTask','id',r->'result'->>'entityId'));
  perform public.adventure_planning_command(o,'upgrade-goal-ended',5,jsonb_build_object('type','endGoal','id',g));
  perform public.adventure_planning_command(o,'upgrade-keep-pending',6,jsonb_build_object('type','createTask','title','保留未完成','description','','plannedOn',today,'destination',''));
end $$;
create temporary table adventure_upgrade_snapshot as
select jsonb_build_object(
  'accounts',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.adventure_accounts t),
  'mainlines',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_mainlines t),
  'goals',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_goals t),
  'tasks',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_tasks t),
  'events',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_events t)) value;
