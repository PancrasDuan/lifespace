begin;

do $$
begin
  if to_regclass('public.adventure_mainlines') is not null then raise exception 'GOAL_MODEL_REQUIRED'; end if;
end $$;

create or replace function public.adventure_task_check(p_owner uuid, p_command jsonb, p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text := p_command->>'type';
  v_keys text[];
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
  v_done public.adventure_events;
  v_day date;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command)>32768 then raise exception 'INVALID_COMMAND'; end if;
  if v_type is null or v_type not in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then raise exception 'INVALID_COMMAND'; end if;
  case v_type
    when 'createTask' then v_keys:=array['type','title','description','plannedOn','destination'];
    when 'editTask' then v_keys:=array['type','id','title','description','plannedOn','destination'];
    when 'completeTask' then v_keys:=array['type','id'];
    when 'deleteTask' then v_keys:=array['type','id'];
    when 'cancelTaskCompletion' then v_keys:=array['type','completionId'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if p_command-v_keys <> '{}'::jsonb or not(p_command ?& v_keys) then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createTask','editTask') then
    if jsonb_typeof(p_command->'title') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'description') is distinct from 'string' or length(p_command->>'description')>4000 then raise exception 'INVALID_COMMAND'; end if;
  end if;
  if v_type='createTask' then
    if jsonb_typeof(p_command->'plannedOn') is distinct from 'string' or p_command->>'plannedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    v_day:=(p_command->>'plannedOn')::date;
    if v_day::text<>p_command->>'plannedOn' then raise exception 'INVALID_COMMAND'; end if;
    if v_day<p_today then raise exception 'RESCHEDULE_PAST'; end if;
    if coalesce(p_command->>'destination','')='' then return jsonb_build_object('allowed',true); end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
  else
    if v_type='cancelTaskCompletion' then
      if jsonb_typeof(p_command->'completionId') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
      select * into v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid and kind='task_completed';
      if not found then raise exception 'NOT_FOUND'; end if;
      if v_done.invalidated_at is not null then raise exception 'COMPLETION_CHANGED'; end if;
      if v_done.occurred_on<>p_today then raise exception 'DATE_LOCKED'; end if;
      select * into v_task from public.adventure_tasks where owner_id=p_owner and id=v_done.task_id and deleted_at is null;
    else
      if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
      select * into v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
    end if;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_task.status='ended' then raise exception 'READ_ONLY'; end if;
    if v_type in ('editTask','completeTask') and v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
    if v_type='editTask' then
      if jsonb_typeof(p_command->'plannedOn') is distinct from 'string' or p_command->>'plannedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_COMMAND'; end if;
      v_day:=(p_command->>'plannedOn')::date;
      if v_day::text<>p_command->>'plannedOn' then raise exception 'INVALID_COMMAND'; end if;
      if v_day<p_today and v_day<>v_task.planned_on then raise exception 'RESCHEDULE_PAST'; end if;
      if v_type='editTask' then
        if jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
        if p_command->>'destination'<>'' then
          select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid and kind='real';
          if not found then raise exception 'NOT_FOUND'; end if;
          if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
        end if;
      end if;
    end if;
    if v_type='deleteTask' then
      if v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
    end if;
    if v_type='cancelTaskCompletion' then
      if v_task.status<>'completed' or v_task.completed_on<>p_today or v_task.completed_at<>v_done.occurred_at then raise exception 'COMPLETION_CHANGED'; end if;
      if exists(select 1 from public.adventure_goals where owner_id=p_owner and id=v_done.goal_id and status<>'active') then raise exception 'READ_ONLY'; end if;
    end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  return jsonb_build_object('allowed',true,'taskId',v_task.id,'completionId',v_done.id);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_task_capability(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform public.adventure_task_check(p_owner,p_command,p_today);
  return jsonb_build_object('allowed',true);
exception when others then
  return jsonb_build_object('allowed',false,'reason',case sqlerrm
    when 'READ_ONLY' then '任务或相关规划已进入终态，只能查看'
    when 'TASK_NOT_PENDING' then '仅待完成任务可以执行此操作'
    when 'DATE_LOCKED' then '仅能取消实际完成日为今天的完成记录'
    when 'COMPLETION_CHANGED' then '这次完成已变化，请重新读取'
    when 'RESCHEDULE_PAST' then '只能改到今天或未来'
    when 'SAME_DATE' then '无需改到相同日期'
    when 'DATE_STARTED' then '执行日已到，此操作不可用'
    else '当前不可操作，请重新读取' end);
end $$;

create or replace function public.adventure_planning_preview(p_owner uuid, p_expected_version bigint, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_revision bigint;
  v_before jsonb;
  v_after jsonb;
  v_today date;
  v_done public.adventure_events;
  v_goal public.adventure_goals;
  v_plan jsonb;
  v_count bigint;
  v_preview jsonb;
begin
  if p_owner is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id = p_owner for share;
  v_revision := coalesce(v_revision,0);
  if v_revision <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  v_today:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  if p_command->>'type'='endTask' then raise exception 'INVALID_COMMAND'; end if;
  if p_command->>'type' in ('endGoal','deleteTask') then
    if p_command->>'type'='deleteTask' then
      v_preview:=public.adventure_task_impact(p_owner,p_command,v_today)
        || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
          'message','删除后任务将从规划中移除，保留历史事实和请求回执，不扣除经验。');
    else
      v_preview:=public.adventure_lifecycle_impact(p_owner,p_command,v_today)
      || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
        'message','结束目标后不可恢复；已有完成记录和经验保持不变。');
    end if;
    if octet_length(v_preview::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
    return v_preview;
  end if;
  if p_command->>'type' in ('rescheduleTask','migrateTask') then raise exception 'INVALID_COMMAND'; end if;
  if p_command->>'type' in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    perform public.adventure_task_check(p_owner,p_command,v_today);
  else perform public.adventure_planning_check(p_owner,p_command); end if;
  if p_command->>'type'='achieveGoal' then
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
    v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,1);
    v_count:=(v_plan->'reward'->'calculation'->>'count')::bigint;
    v_preview:=jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,'operation','achieveGoal',
      'goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
      'message','达成后不可撤销，已有成果与任务历史将只读保留。',
      'rewards',(select jsonb_agg(jsonb_build_object('amount',case when v_count=0 then 1 else v_count*c end,
        'calculation',(v_plan->'reward'->'calculation')||jsonb_build_object('coefficient',c)) order by c) from generate_series(1,3) c),
      'stoppingTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
        from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null));
    if octet_length(v_preview::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
    return v_preview;
  end if;
  if p_command->>'type'='cancelTaskCompletion' then
    select * into strict v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
    v_before:=public.adventure_growth(p_owner);v_after:=public.adventure_growth(p_owner,-v_done.amount,-1);
    return jsonb_build_object('version',v_revision,'today',v_today,
      'allowed',true,'requiresConfirmation',true,'message','取消后移除这次行动和 '||v_done.amount||' 点经验，等级及成就随有效记录更新',
      'reward',jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation),
      'growthBefore',v_before,'growthAfter',v_after,'completionId',p_command->>'completionId');
  end if;
  return jsonb_build_object('version',v_revision,'today',v_today,
    'allowed',true,'requiresConfirmation',false,'message',case when p_command->>'type'='completeTask' then '可直接完成行动，按实际完成日记录并实时获得 1 点经验' else '保存后更新规划，不改变目标状态或经验' end);
end $$;

revoke execute on function public.adventure_task_check(uuid,jsonb,date), public.adventure_task_capability(uuid,jsonb,date), public.adventure_planning_preview(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.adventure_task_check(uuid,jsonb,date), public.adventure_task_capability(uuid,jsonb,date), public.adventure_planning_preview(uuid,bigint,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;

