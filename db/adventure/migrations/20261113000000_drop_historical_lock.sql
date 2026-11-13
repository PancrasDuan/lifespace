-- Remove the migration-only historical_lock column from an already upgraded
-- four-table installation (#183). No old backups remain and production has
-- fully cut over, so the legacy "ended mainline freezes its completions" rule
-- is intentionally dropped. Fresh installs never create the column; this file
-- only touches databases that already ran 20261111000000_goal_categories.
begin;
set local lock_timeout = '3s';
do $$
begin
  if to_regclass('public.adventure_mainlines') is not null then
    raise exception 'HISTORICAL_LOCK_MIGRATION_REQUIRES_GOAL_CATEGORIES';
  end if;
end $$;
alter table public.adventure_events drop constraint if exists adventure_events_historical_lock_check;
alter table public.adventure_events drop column if exists historical_lock;

create or replace function public.adventure_task_capability(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform public.adventure_task_check(p_owner,p_command,p_today);
  return jsonb_build_object('allowed',true);
exception when others then
  return jsonb_build_object('allowed',false,'reason',case sqlerrm
    when 'READ_ONLY' then '任务或相关规划已进入终态，只能查看'
    when 'TASK_NOT_PENDING' then '仅待完成任务可以执行此操作'
    when 'DATE_LOCKED' then '仅能完成今天的安排或取消今天的完成'
    when 'COMPLETION_CHANGED' then '这次完成已变化，请重新读取'
    when 'RESCHEDULE_PAST' then '只能改到今天或未来'
    when 'SAME_DATE' then '无需改到相同日期'
    when 'DATE_STARTED' then '执行日已到，此操作不可用'
    else '当前不可操作，请重新读取' end);
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

create or replace function public.adventure_migration_check(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals; v_task public.adventure_tasks; v_target public.adventure_goals; v_destination text:=p_command->>'destination';
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768
    or p_command->>'type' is distinct from 'taskDestination' or p_command-array['type','id','destination']<>'{}'::jsonb
    or not(p_command ?& array['type','id','destination']) or jsonb_typeof(p_command->'id') is distinct from 'string'
    or jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
  select * into v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_task.status='ended' then raise exception 'READ_ONLY'; end if;
  if v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  if v_goal.status<>'active' or exists(select 1 from public.adventure_events e left join public.adventure_goals g on (g.owner_id,g.id)=(e.owner_id,e.goal_id)
    where e.owner_id=p_owner and e.task_id=v_task.id and e.kind='task_completed' and e.invalidated_at is null and g.status<>'active') then raise exception 'READ_ONLY'; end if;
  if v_destination='' then
    if v_goal.kind='inbox' then raise exception 'SAME_DESTINATION'; end if;
  else
    select * into v_target from public.adventure_goals where owner_id=p_owner and id=v_destination::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_target.id=v_goal.id then raise exception 'SAME_DESTINATION'; end if;
    if v_target.status<>'active' then raise exception 'READ_ONLY'; end if;
  end if;
  return '{"allowed":true}'::jsonb;
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

do $$
begin
  if exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid
    where c.relnamespace='public'::regnamespace and c.relname='adventure_events' and a.attname='historical_lock' and not a.attisdropped)
    or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname like 'adventure\_%' escape '\' and pg_get_functiondef(p.oid) ~* 'historical_lock|HISTORY_LOCKED')
    then raise exception 'HISTORICAL_LOCK_REMOVAL_INCOMPLETE'; end if;
end $$;

notify pgrst,'reload schema';
commit;
