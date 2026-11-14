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
    if v_type='completeTask' and v_task.planned_on>p_today then raise exception 'DATE_LOCKED'; end if;
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

