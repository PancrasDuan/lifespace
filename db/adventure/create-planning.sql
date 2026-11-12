-- Four-table goal schema; install only together with the coordinated API release.
begin;
-- #54 fresh-install schema. The legacy adventure_states table was removed by the user.
create table public.adventure_accounts (
  owner_id uuid primary key,
  total_xp bigint not null default 0 check (total_xp between 0 and 9007199254740991),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  time_zone text not null default 'Asia/Shanghai' check (time_zone = 'Asia/Shanghai'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.adventure_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adventure_accounts(owner_id),
  kind text not null default 'real' check (kind in ('real','inbox')),
  title varchar(200) not null check (length(btrim(title)) > 0),
  standards jsonb not null check (jsonb_typeof(standards) = 'array' and jsonb_array_length(standards) between 1 and 50),
  status text not null default 'active' check (status in ('active','achieved','ended')),
  focused boolean not null default false,
  sort_order bigint not null default 0 check (sort_order between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminated_at timestamptz,
  termination_cause text check (termination_cause in ('achieved','ended')),
  achieved_at timestamptz,
  achieved_on date,
  attainment_coefficient smallint check (attainment_coefficient between 1 and 3),
  attainment_reflection text,
  attainment_action_count integer check (attainment_action_count >= 0),
  attainment_action_ids uuid[],
  attainment_snapshot jsonb check (jsonb_typeof(attainment_snapshot) = 'object'),
  category_label text,
  constraint adventure_goals_category_label_check check (category_label is null or (kind='real' and length(category_label) between 1 and 200 and category_label=btrim(category_label,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))),
  unique(owner_id,id),
  check ((status <> 'active') = (terminated_at is not null)),
  check ((status <> 'active') = (termination_cause is not null)),
  check (status = 'active' or not focused),
  check (
    (status = 'achieved' and kind = 'real' and achieved_at is not null and achieved_on is not null
      and attainment_coefficient is not null and attainment_reflection is not null
      and attainment_action_count is not null and attainment_action_ids is not null
      and attainment_snapshot is not null and termination_cause = 'achieved')
    or (status <> 'achieved' and achieved_at is null and achieved_on is null
      and attainment_coefficient is null and attainment_reflection is null
      and attainment_action_count is null and attainment_action_ids is null and attainment_snapshot is null)
  ),
  check (kind <> 'inbox' or (status = 'active' and not focused))
);
create unique index adventure_one_inbox on public.adventure_goals(owner_id) where kind = 'inbox';
create index adventure_goals_owner_order on public.adventure_goals(owner_id,kind,status,sort_order,id);

create table public.adventure_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adventure_accounts(owner_id),
  goal_id uuid not null,
  kind text not null default 'once' check (kind = 'once'),
  title varchar(200) not null check (length(btrim(title)) > 0),
  description text not null default '' check (length(description) <= 4000),
  planned_on date not null,
  status text not null default 'pending' check (status in ('pending','completed','ended')),
  completed_at timestamptz,
  completed_on date,
  ended_at timestamptz,
  end_cause text check (end_cause in ('manual','goal_achieved','goal_ended','historical_ended')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,goal_id) references public.adventure_goals(owner_id,id),
  check ((status = 'completed' and completed_at is not null and completed_on is not null)
    or (status <> 'completed' and completed_at is null and completed_on is null)),
  check ((status = 'ended' and ended_at is not null and end_cause is not null)
    or (status <> 'ended' and ended_at is null and end_cause is null))
);
create index adventure_tasks_owner_goal on public.adventure_tasks(owner_id,goal_id,status);

create table public.adventure_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adventure_accounts(owner_id),
  event_group_id uuid not null,
  kind text not null check (kind in (
    'goal_created','goal_updated','goal_focused','goal_reordered','goal_migrated','goal_achieved','goal_ended',
    'task_created','task_updated','task_rescheduled','task_migrated','task_ended','task_deleted',
    'task_completed','task_completion_cancelled'
  )),
  entity_type text not null check (entity_type in ('account','goal','task')),
  entity_id uuid,
  task_id uuid,
  goal_id uuid,
  occurred_at timestamptz not null default now(),
  occurred_on date not null,
  actor_owner_id uuid not null check (actor_owner_id = owner_id),
  request_id varchar(128),
  command_hash varchar(64),
  command_type text,
  applied_revision bigint check (applied_revision between 1 and 9007199254740991),
  amount bigint check (amount between 1 and 9007199254740991),
  calculation jsonb check (jsonb_typeof(calculation) = 'object'),
  snapshot jsonb check (jsonb_typeof(snapshot) = 'object'),
  invalidated_at timestamptz,
  invalidated_by_event_id uuid,
  created_at timestamptz not null default now(),
  historical_lock boolean not null default false,
  constraint adventure_events_historical_lock_check check (not historical_lock or kind='task_completed'),
  unique(owner_id,id),
  foreign key(owner_id,goal_id) references public.adventure_goals(owner_id,id),
  foreign key(owner_id,task_id) references public.adventure_tasks(owner_id,id),
  foreign key(owner_id,invalidated_by_event_id) references public.adventure_events(owner_id,id),
  check ((request_id is null and command_hash is null and command_type is null and applied_revision is null)
    or (request_id is not null and command_hash is not null
      and request_id ~ '^[A-Za-z0-9_-]{8,128}$' and command_hash ~ '^[a-f0-9]{64}$'
      and command_type is not null and applied_revision is not null)),
  check ((kind in ('task_completed','goal_achieved') and amount is not null and calculation is not null)
    or (kind not in ('task_completed','goal_achieved') and amount is null and calculation is null)),
  check (kind <> 'task_completed' or (task_id is not null and entity_type='task' and entity_id is not distinct from task_id
    and snapshot is not null)),
  check (kind <> 'goal_achieved' or (goal_id is not null and entity_type='goal' and entity_id is not distinct from goal_id
    and snapshot is not null and invalidated_at is null)),
  check (invalidated_at is null or kind='task_completed'),
  check ((invalidated_at is null) = (invalidated_by_event_id is null))
);
create unique index adventure_event_request on public.adventure_events(owner_id,request_id) where request_id is not null;
create unique index adventure_one_valid_completion on public.adventure_events(owner_id,task_id) where kind='task_completed' and invalidated_at is null;
create unique index adventure_one_goal_achievement on public.adventure_events(owner_id,goal_id) where kind='goal_achieved';
create index adventure_reward_journal on public.adventure_events(owner_id,applied_revision desc,id desc)
  where kind in ('task_completed','goal_achieved') and invalidated_at is null;
create index adventure_event_group on public.adventure_events(owner_id,event_group_id,id);
create index adventure_event_task on public.adventure_events(owner_id,task_id);
create index adventure_event_kind_time on public.adventure_events(owner_id,kind,occurred_at,id);
create index adventure_event_goal on public.adventure_events(owner_id,goal_id);
create index adventure_event_invalidation on public.adventure_events(owner_id,invalidated_by_event_id);

alter table public.adventure_accounts enable row level security;
alter table public.adventure_goals enable row level security;
alter table public.adventure_tasks enable row level security;
alter table public.adventure_events enable row level security;
revoke all on public.adventure_accounts, public.adventure_goals,
  public.adventure_tasks, public.adventure_events from public, anon, authenticated, service_role;
grant select, insert, update on public.adventure_accounts, public.adventure_goals,
  public.adventure_tasks, public.adventure_events to service_role;

create or replace function public.adventure_growth(p_owner uuid, p_xp_delta bigint default 0, p_action_delta integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_xp bigint;
  v_actions bigint;
  v_goals bigint;
  v_level bigint;
  v_progress bigint;
  v_badges jsonb;
begin
  select total_xp + p_xp_delta into v_xp from public.adventure_accounts where owner_id=p_owner;
  v_xp := coalesce(v_xp,0);
  select count(*) + p_action_delta into v_actions from public.adventure_events where owner_id=p_owner and kind='task_completed' and invalidated_at is null;
  select count(*) into v_goals from public.adventure_goals where owner_id=p_owner and kind='real' and status='achieved';
  if v_xp not between 0 and 9007199254740991 or v_actions < 0 then raise exception 'INCONSISTENT_REWARDS'; end if;
  v_level := floor((sqrt(1225::numeric+40::numeric*v_xp)-35)/10)::bigint+1;
  v_progress := v_xp-(v_level-1)*(5*(v_level-1)+35)/2;
  select jsonb_agg(jsonb_build_object('id',kind||'_'||threshold,'label',label,'threshold',threshold,
    'count',case when kind='actions' then v_actions else v_goals end,
    'remaining',greatest(0,threshold-case when kind='actions' then v_actions else v_goals end),
    'unlocked',case when kind='actions' then v_actions else v_goals end >= threshold) order by ordinal)
  into v_badges from (values
    (1,'actions',1,'迈出第一步'),(2,'actions',10,'十次行动'),(3,'actions',50,'五十次行动'),(4,'actions',100,'百次行动'),
    (5,'goals',1,'首个成果'),(6,'goals',3,'三个成果'),(7,'goals',10,'十个成果')
  ) badges(ordinal,kind,threshold,label);
  return jsonb_build_object('level',v_level,'totalXp',v_xp,'progress',v_progress,'needed',20+5*(v_level-1),
    'remaining',20+5*(v_level-1)-v_progress,'actions',v_actions,'achievedGoals',v_goals,'achievements',v_badges);
end $$;

create or replace function public.adventure_task_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
begin
  if p_command->>'type' is distinct from 'deleteTask' then raise exception 'INVALID_COMMAND'; end if;
  perform public.adventure_task_check(p_owner,p_command,p_today);
  select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  return jsonb_build_object('operation',p_command->>'type','entityId',v_task.id,'title',v_task.title,
    'stoppingGoals','[]'::jsonb,
    'stoppingTasks','[]'::jsonb,
    'preservedCompletedTasks',case when v_task.status='completed' then 1 else 0 end,
    'preservedAchievedGoals',0,
    'historicalArrangements',(select count(*) from public.adventure_events where owner_id=p_owner and task_id=v_task.id
      and kind='task_rescheduled'),
    'goalId',case when v_goal.kind='real' then v_goal.id end,
    'plannedOn',v_task.planned_on);
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
    when 'DATE_LOCKED' then '仅能完成今天的安排或取消今天的完成'
    when 'COMPLETION_CHANGED' then '这次完成已变化，请重新读取'
    when 'HISTORY_LOCKED' then '任务已有完成或历史安排，不能按误建删除'
    when 'RESCHEDULE_PAST' then '只能改到今天或未来'
    when 'SAME_DATE' then '无需改到相同日期'
    when 'DATE_STARTED' then '执行日已到，不能按误建删除；不再执行可选择结束'
    else '当前不可操作，请重新读取' end);
end $$;

create or replace function public.adventure_growth_read(p_owner uuid,p_version bigint default null,p_cursor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_version bigint; v_xp bigint; v_total bigint; v_items jsonb; v_cursor_revision bigint; v_next uuid;
begin
  if p_owner is null or p_version<0 or (p_cursor is not null and p_version is null) then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  if not found then
    if p_version is not null and p_version<>0 then raise exception 'VERSION_CONFLICT'; end if;
    if p_cursor is not null then raise exception 'NOT_FOUND'; end if;
    -- No account row exists to lock. Return one empty snapshot even if a first write races this read.
    return jsonb_build_object('version',0,'growth',public.adventure_growth(null),'pageSize',10,'total',0,'items','[]'::jsonb,'nextCursor',null);
  end if;
  if p_version is not null and p_version<>v_version then raise exception 'VERSION_CONFLICT'; end if;
  select count(*),coalesce(sum(amount),0) into v_total,v_xp from public.adventure_events
    where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null;
  if v_xp<>coalesce((select total_xp from public.adventure_accounts where owner_id=p_owner),0) then raise exception 'INCONSISTENT_REWARDS'; end if;
  if p_cursor is not null then
    select applied_revision into v_cursor_revision from public.adventure_events where owner_id=p_owner and id=p_cursor
      and kind in ('task_completed','goal_achieved') and invalidated_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  select coalesce(jsonb_agg(public.adventure_reward_view(p_owner,id) order by applied_revision desc,id desc),'[]'::jsonb)
    into v_items from (select id,applied_revision from public.adventure_events
      where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null
      and (p_cursor is null or (applied_revision,id)<(v_cursor_revision,p_cursor))
      order by applied_revision desc,id desc limit 11) rewards;
  if jsonb_array_length(v_items)>10 then v_items:=v_items-10; v_next:=(v_items->9->>'id')::uuid; end if;
  return jsonb_build_object('version',v_version,'growth',public.adventure_growth(p_owner),
    'pageSize',10,'total',v_total,'items',v_items,'nextCursor',v_next);
end $$;
-- Transactional commands and projections for the four-table goal model.
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
      if v_done.historical_lock or exists(select 1 from public.adventure_goals where owner_id=p_owner and id=v_done.goal_id and status<>'active') then raise exception 'READ_ONLY'; end if;
    end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  return jsonb_build_object('allowed',true,'taskId',v_task.id,'completionId',v_done.id);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_COMMAND';
end $$;


create or replace function public.adventure_task_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_command->>'type' is null or p_command->>'type' not in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then raise exception 'INVALID_COMMAND'; end if;
  return public.adventure_planning_command(p_owner,p_request_id,p_revision,p_command);
end $$;


create or replace function public.adventure_planning_check(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_type text:=p_command->>'type'; v_goal public.adventure_goals; v_keys text[];
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768 or v_type is null then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    return public.adventure_task_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date);
  end if;
  if v_type='endGoal' then return public.adventure_lifecycle_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date); end if;
  case v_type
    when 'createGoal' then v_keys:=array['type','title','standards'];
    when 'editGoal' then v_keys:=array['type','id','title','standards'];
    when 'achieveGoal' then v_keys:=array['type','id'];
    when 'reorderGoals' then v_keys:=array['type','id','direction'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if not(p_command ?& v_keys) or (p_command-v_keys-CASE v_type
      when 'createGoal' then array['categoryLabel'] when 'editGoal' then array['categoryLabel']
      when 'achieveGoal' then array['coefficient','reflection'] when 'reorderGoals' then array['targetId'] end)<>'{}'::jsonb
    then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createGoal','editGoal') then
    if jsonb_typeof(p_command->'title') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'standards') is distinct from 'array' or jsonb_array_length(p_command->'standards') not between 1 and 50
      or exists(select 1 from jsonb_array_elements(p_command->'standards') item where jsonb_typeof(item) is distinct from 'string' or length(btrim(item #>> '{}')) not between 1 and 4000)
      or (p_command ? 'categoryLabel' and jsonb_typeof(p_command->'categoryLabel') not in ('string','null'))
      or length(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>200 then raise exception 'INVALID_COMMAND'; end if;
  end if;
  if v_type<>'createGoal' then
    if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  end if;
  if v_type='achieveGoal' then
    if (p_command ? 'coefficient' and (jsonb_typeof(p_command->'coefficient') is distinct from 'number' or p_command->>'coefficient' not in ('1','2','3')))
      or (p_command ? 'reflection' and (jsonb_typeof(p_command->'reflection') is distinct from 'string' or length(p_command->>'reflection')>4000)) then raise exception 'INVALID_COMMAND'; end if;
    if exists(select 1 from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null) then raise exception 'PENDING_TASKS'; end if;
  elsif v_type='reorderGoals' then
    if jsonb_typeof(p_command->'direction') is distinct from 'string' or p_command->>'direction' not in ('up','down') then raise exception 'INVALID_COMMAND'; end if;
    if p_command ? 'targetId' and (jsonb_typeof(p_command->'targetId') is distinct from 'string' or not exists(
      select 1 from public.adventure_goals where owner_id=p_owner and id=(p_command->>'targetId')::uuid and id<>v_goal.id and kind='real' and status='active')) then raise exception 'INVALID_COMMAND'; end if;
  end if;
  return '{"allowed":true}'::jsonb;
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_goal_reward(p_owner uuid,p_goal uuid,p_coefficient integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actions jsonb;
  v_sources jsonb;
  v_count bigint;
  v_reward jsonb;
begin
  if p_coefficient is null or p_coefficient not between 1 and 3 then raise exception 'INVALID_COMMAND'; end if;
  select coalesce(jsonb_agg(task_id order by task_id),'[]'),coalesce(jsonb_agg(jsonb_build_object(
    'taskId',task_id,'completionId',id,'goalId',goal_id,'occurredOn',occurred_on,
    'source',snapshot-'result') order by task_id),'[]'),count(*)
    into v_actions,v_sources,v_count from (
      select distinct on(task_id) * from public.adventure_events where owner_id=p_owner and goal_id=p_goal
        and kind='task_completed' and invalidated_at is null order by task_id,occurred_at,id
    ) actions;
  v_reward:=jsonb_build_object('reward',jsonb_build_object('amount',case when v_count=0 then 1 else v_count*p_coefficient end,
    'calculation',jsonb_build_object('type','goal_actions','actionIds',v_actions,'count',v_count,'coefficient',p_coefficient,'fallback',v_count=0)),
    'actionSources',v_sources);
  if octet_length(v_reward::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_reward;
end $$;

create or replace function public.adventure_goal_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_command->>'type' is distinct from 'achieveGoal' then raise exception 'INVALID_COMMAND'; end if;
  return public.adventure_planning_command(p_owner,p_request_id,p_revision,p_command);
end $$;

create or replace function public.adventure_planning_command(p_owner uuid,p_request_id text,p_expected_version bigint,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_account public.adventure_accounts; v_prior public.adventure_events; v_goal public.adventure_goals;
  v_hash text:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex'); v_type text:=p_command->>'type';
  v_kind text; v_before jsonb; v_after jsonb; v_now timestamptz; v_order bigint; v_result jsonb;
begin
  if p_owner is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,128}$'
    or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    or p_command is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id=p_owner for update;
  select * into v_prior from public.adventure_events where owner_id=p_owner and request_id=p_request_id;
  if found then
    if v_prior.command_hash<>v_hash then raise exception 'REQUEST_ID_REUSED'; end if;
    if jsonb_typeof(v_prior.snapshot->'result') is distinct from 'object'
      or jsonb_typeof(v_prior.snapshot->'result'->'entityId') is distinct from 'string'
      or jsonb_typeof(v_prior.snapshot->'result'->'message') is distinct from 'string'
      or lower(v_prior.snapshot->'result'->>'message') like '%'||('main'||'line')||'%'
      or v_prior.snapshot->'result'->>'message' like '%'||chr(20027)||chr(32447)||'%' then raise exception 'REPLAY_UNAVAILABLE'; end if;
    return jsonb_build_object('version',v_prior.applied_revision,'result',v_prior.snapshot->'result');
  end if;
  if v_type is null or v_type not in ('createGoal','editGoal','reorderGoals','endGoal','achieveGoal','createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then raise exception 'INVALID_COMMAND'; end if;
  if v_account.revision<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if v_account.revision>=9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
  v_now:=clock_timestamp();
  -- Execute only after the account lock, receipt and version checks above.
  if v_type='endGoal' then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now; v_today date:=(p_now at time zone 'Asia/Shanghai')::date; v_goal public.adventure_goals;
      v_before jsonb; v_after jsonb; v_impact jsonb; v_result jsonb;
    begin
      perform public.adventure_lifecycle_check(p_owner,p_command,v_today);
      v_impact:=public.adventure_lifecycle_impact(p_owner,p_command,v_today);
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=to_jsonb(v_goal)-'owner_id';
      update public.adventure_goals set status='ended',focused=false,terminated_at=p_now,termination_cause='ended',updated_at=p_now
        where owner_id=p_owner and id=v_goal.id returning * into v_goal;
      v_after:=to_jsonb(v_goal)-'owner_id';
      v_result:=jsonb_build_object('entityId',v_goal.id,'message','目标已结束');
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,goal_id,occurred_at,occurred_on,actor_owner_id,
        request_id,command_hash,command_type,applied_revision,snapshot,created_at)
        values(gen_random_uuid(),p_owner,gen_random_uuid(),'goal_ended','goal',v_goal.id,v_goal.id,p_now,v_today,p_owner,p_request_id,
          encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'endGoal',p_revision+1,jsonb_build_object('before',v_before,'after',v_after,'impact',v_impact,'result',v_result),p_now);
      if (select total_xp from public.adventure_accounts where owner_id=p_owner)<>(select coalesce(sum(amount),0) from public.adventure_events
        where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
      update public.adventure_accounts set revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  elsif v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','deleteTask') then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now;
      v_type text:=p_command->>'type';
      v_today date:=(p_now at time zone 'Asia/Shanghai')::date;
      v_task public.adventure_tasks;
      v_goal public.adventure_goals;
      v_done public.adventure_events;
      v_event uuid:=gen_random_uuid();
      v_group uuid:=gen_random_uuid();
      v_kind text;
      v_before jsonb;
      v_after jsonb;
      v_snapshot jsonb;
      v_before_growth jsonb;
      v_after_growth jsonb;
      v_delta bigint:=0;
      v_reward jsonb;
      v_result jsonb;
      v_unlocked jsonb;
      v_lost jsonb;
      v_impact jsonb;
    begin
      perform public.adventure_task_check(p_owner,p_command,v_today);
      if v_type='deleteTask' then v_impact:=public.adventure_task_impact(p_owner,p_command,v_today); end if;
      v_before_growth:=public.adventure_growth(p_owner);
      if v_type in ('createTask','editTask') then
        if coalesce(p_command->>'destination','')='' then
          select * into v_goal from public.adventure_goals where owner_id=p_owner and kind='inbox';
          if not found then
            insert into public.adventure_goals(owner_id,kind,title,standards,created_at,updated_at)
              values(p_owner,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]',p_now,p_now) returning * into v_goal;
          end if;
        else
          select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'destination')::uuid;
        end if;
        if v_type='createTask' then
        insert into public.adventure_tasks(owner_id,goal_id,title,description,planned_on,created_at,updated_at)
          values(p_owner,v_goal.id,btrim(p_command->>'title'),btrim(p_command->>'description'),(p_command->>'plannedOn')::date,p_now,p_now) returning * into v_task;
        v_kind:='task_created';
        else
          select to_jsonb(t)-'owner_id' into v_before from public.adventure_tasks t where owner_id=p_owner and id=(p_command->>'id')::uuid;
          update public.adventure_tasks set goal_id=v_goal.id,title=btrim(p_command->>'title'),description=btrim(p_command->>'description'),planned_on=(p_command->>'plannedOn')::date,updated_at=p_now
            where owner_id=p_owner and id=(p_command->>'id')::uuid returning * into v_task;
          v_kind:=case when (v_before->>'planned_on')::date<>v_task.planned_on then 'task_rescheduled' when (v_before->>'goal_id')::uuid<>v_task.goal_id then 'task_migrated' else 'task_updated' end;
        end if;
      else
        if v_type='cancelTaskCompletion' then
          select * into strict v_done from public.adventure_events where owner_id=p_owner and id=(p_command->>'completionId')::uuid;
          select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=v_done.task_id;
        else
          select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid;
        end if;
        v_before:=to_jsonb(v_task)-'owner_id';
        select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
        case v_type
          when 'completeTask' then
            update public.adventure_tasks set status='completed',completed_at=p_now,completed_on=v_today,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_completed';v_delta:=1;
          when 'deleteTask' then
            update public.adventure_tasks set deleted_at=p_now,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_deleted';
          when 'cancelTaskCompletion' then
            update public.adventure_tasks set status='pending',completed_at=null,completed_on=null,updated_at=p_now
              where owner_id=p_owner and id=v_task.id returning * into v_task;
            v_kind:='task_completion_cancelled';v_delta:=-v_done.amount;
        end case;
      end if;
      v_after:=to_jsonb(v_task)-'owner_id';
      v_snapshot:=jsonb_build_object('before',v_before,'after',v_after,'title',v_task.title,'description',v_task.description,
        'completionId',case when v_type='cancelTaskCompletion' then v_done.id end,
        'plannedOn',v_task.planned_on,
        'goalTitle',case when v_goal.kind='real' then v_goal.title end,'goalStandards',case when v_goal.kind='real' then v_goal.standards end,
        'impact',v_impact);
      if v_kind='task_rescheduled' then
        v_snapshot:=v_snapshot||jsonb_build_object('oldPlannedOn',v_before->>'planned_on','newPlannedOn',v_task.planned_on,
          'sourceEventId',(select id from public.adventure_events where owner_id=p_owner and task_id=v_task.id
            and kind in ('task_created','task_rescheduled') order by applied_revision desc,id desc limit 1));
      end if;
      if v_before is not null and (v_before->>'goal_id')::uuid<>v_task.goal_id then
        v_snapshot:=v_snapshot||jsonb_build_object('origin',(select jsonb_build_object('goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end) from public.adventure_goals g where g.owner_id=p_owner and g.id=(v_before->>'goal_id')::uuid));
      end if;
      if v_type='completeTask' then
        v_snapshot:=v_snapshot||jsonb_build_object('categoryLabel',case when v_goal.kind='real' then v_goal.category_label end);
        v_reward:=jsonb_build_object('amount',v_delta,'calculation',jsonb_build_object(
          'type','fixed_task','completionId',v_event,'count',1,'coefficient',1));
      elsif v_type='cancelTaskCompletion' then
        v_reward:=jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation);
      end if;
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,goal_id,
        occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
        values(v_event,p_owner,v_group,v_kind,'task',v_task.id,v_task.id,case when v_goal.kind='real' then v_goal.id end,
          p_now,v_today,p_owner,p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),v_type,p_revision+1,
          case when v_type='completeTask' then v_delta end,case when v_type='completeTask' then v_reward->'calculation' end,v_snapshot,p_now);
      if v_type='cancelTaskCompletion' then
        update public.adventure_events set invalidated_at=p_now,invalidated_by_event_id=v_event
          where owner_id=p_owner and id=v_done.id and invalidated_at is null;
      end if;
      update public.adventure_accounts set total_xp=total_xp+v_delta,revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      if (select total_xp from public.adventure_accounts where owner_id=p_owner) <>
        (select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
        then raise exception 'INCONSISTENT_REWARDS'; end if;
      v_after_growth:=public.adventure_growth(p_owner);
      select coalesce(jsonb_agg(a->>'label'),'[]'::jsonb) into v_unlocked from jsonb_array_elements(v_after_growth->'achievements') a
        where (a->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_before_growth->'achievements') b where b->>'id'=a->>'id' and (b->>'unlocked')::boolean);
      select coalesce(jsonb_agg(b->>'label'),'[]'::jsonb) into v_lost from jsonb_array_elements(v_before_growth->'achievements') b
        where (b->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_after_growth->'achievements') a where a->>'id'=b->>'id' and (a->>'unlocked')::boolean);
      v_result:=jsonb_build_object('entityId',v_task.id,'message',case v_type
        when 'createTask' then '已创建任务' when 'editTask' then '已保存任务'
        when 'deleteTask' then '未完成任务已删除'
        when 'cancelTaskCompletion' then '已取消完成，成长已同步更新'
        else '已完成，获得 1 点经验' || case when (v_after_growth->>'level')::bigint>(v_before_growth->>'level')::bigint then '，升至 '||(v_after_growth->>'level')||' 级' else '' end
          || case when jsonb_array_length(v_unlocked)>0 then '，点亮：'||(select string_agg(value, '、') from jsonb_array_elements_text(v_unlocked)) else '' end end,
        'completionId',case when v_type='completeTask' then v_event when v_type='cancelTaskCompletion' then v_done.id end,
        'reward',v_reward,'growthChange',jsonb_build_object('xpDelta',v_delta,'before',v_before_growth,'after',v_after_growth,'unlocked',v_unlocked,'lost',v_lost));
      update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',v_result) where owner_id=p_owner and id=v_event;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  elsif v_type='achieveGoal' then
    declare
      p_revision bigint:=v_account.revision; p_now timestamptz:=v_now;
      v_goal public.adventure_goals;
      v_plan jsonb;
      v_reward jsonb;
      v_amount bigint;
      v_event uuid:=gen_random_uuid();
      v_source jsonb;
      v_before jsonb;
      v_after jsonb;
      v_unlocked jsonb;
      v_result jsonb;
    begin
      perform public.adventure_planning_check(p_owner,p_command);
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=public.adventure_growth(p_owner);
      v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,coalesce((p_command->>'coefficient')::integer,1));
      v_reward:=v_plan->'reward';v_amount:=(v_reward->>'amount')::bigint;
      if (v_before->>'totalXp')::bigint>9007199254740991-v_amount then raise exception 'CAPACITY_REACHED'; end if;
      v_source:=jsonb_build_object('goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
        'categoryLabel',v_goal.category_label,'actionSources',v_plan->'actionSources',
        'stoppedTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
          from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null));
      if octet_length(v_source::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
      update public.adventure_goals set status='achieved',focused=false,terminated_at=p_now,termination_cause='achieved',
        achieved_at=p_now,achieved_on=(p_now at time zone 'Asia/Shanghai')::date,
        attainment_coefficient=coalesce((p_command->>'coefficient')::integer,1),attainment_reflection=btrim(coalesce(p_command->>'reflection','')),
        attainment_action_count=(v_reward->'calculation'->>'count')::integer,
        attainment_action_ids=array(select value::uuid from jsonb_array_elements_text(v_reward->'calculation'->'actionIds')),
        attainment_snapshot=v_source,updated_at=p_now where owner_id=p_owner and id=v_goal.id;
      insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,goal_id,
        occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
        values(v_event,p_owner,gen_random_uuid(),'goal_achieved','goal',v_goal.id,v_goal.id,p_now,(p_now at time zone 'Asia/Shanghai')::date,
          p_owner,p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'achieveGoal',p_revision+1,v_amount,v_reward->'calculation',
          v_source||jsonb_build_object('before',to_jsonb(v_goal)-'owner_id','reflection',btrim(coalesce(p_command->>'reflection',''))),p_now);
      update public.adventure_accounts set total_xp=total_xp+v_amount,revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
      if (select total_xp from public.adventure_accounts where owner_id=p_owner) <>
        (select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
        then raise exception 'INCONSISTENT_REWARDS'; end if;
      v_after:=public.adventure_growth(p_owner);
      select coalesce(jsonb_agg(a->>'label'),'[]') into v_unlocked from jsonb_array_elements(v_after->'achievements') a
        where (a->>'unlocked')::boolean and not exists(select 1 from jsonb_array_elements(v_before->'achievements') b where b->>'id'=a->>'id' and (b->>'unlocked')::boolean);
      v_result:=jsonb_build_object('entityId',v_goal.id,'achievementId',v_event,'reward',v_reward,
        'message','目标已达成，获得 '||v_amount||' 点经验' || case when (v_after->>'level')::bigint>(v_before->>'level')::bigint then '，升至 '||(v_after->>'level')||' 级' else '' end
          || case when jsonb_array_length(v_unlocked)>0 then '，点亮：'||(select string_agg(value,'、') from jsonb_array_elements_text(v_unlocked)) else '' end,
        'growthChange',jsonb_build_object('xpDelta',v_amount,'before',v_before,'after',v_after,'unlocked',v_unlocked,'lost','[]'::jsonb));
      if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
      update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',v_result) where owner_id=p_owner and id=v_event;
      return jsonb_build_object('version',p_revision+1,'result',v_result);
    end;
  end if;
  perform public.adventure_planning_check(p_owner,p_command);
  case v_type
    when 'createGoal' then
      select coalesce(max(sort_order),-1)+1 into v_order from public.adventure_goals where owner_id=p_owner and kind='real' and status='active';
      if v_order>9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
      insert into public.adventure_goals(owner_id,title,standards,category_label,sort_order,created_at,updated_at)
        values(p_owner,btrim(p_command->>'title'),p_command->'standards',nullif(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),''),v_order,v_now,v_now) returning * into v_goal;
      v_kind:='goal_created'; v_after:=to_jsonb(v_goal)-'owner_id';
    when 'editGoal' then
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=to_jsonb(v_goal)-'owner_id';
      update public.adventure_goals set title=btrim(p_command->>'title'),standards=p_command->'standards',
        category_label=case when p_command ? 'categoryLabel' then nullif(btrim(p_command->>'categoryLabel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') else category_label end,updated_at=v_now
        where owner_id=p_owner and id=v_goal.id returning * into v_goal;
      v_kind:='goal_updated';v_after:=to_jsonb(v_goal)-'owner_id';
    when 'reorderGoals' then
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'));
      with ordered as (
        select id,row_number() over(order by sort_order,id) as ord from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'
      ), source as (select ord from ordered where id=v_goal.id), target as (
        select s.ord old_ord,case when p_command ? 'targetId' then (select ord from ordered where id=(p_command->>'targetId')::uuid)
          when p_command->>'direction'='up' then greatest(s.ord-1,1) else least(s.ord+1,(select max(ord) from ordered)) end new_ord from source s
      ), moved as (
        select o.id,case when o.id=v_goal.id then t.new_ord when t.new_ord<t.old_ord and o.ord>=t.new_ord and o.ord<t.old_ord then o.ord+1
          when t.new_ord>t.old_ord and o.ord<=t.new_ord and o.ord>t.old_ord then o.ord-1 else o.ord end ord from ordered o cross join target t
      ) update public.adventure_goals g set sort_order=m.ord-1,updated_at=v_now from moved m where g.owner_id=p_owner and g.id=m.id;
      v_kind:='goal_reordered';v_after:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and kind='real' and status='active'));
  end case;
  v_result:=jsonb_build_object('entityId',v_goal.id,'message',case when v_type='createGoal' then '已创建' else '已保存' end);
  insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,goal_id,occurred_at,occurred_on,actor_owner_id,
    request_id,command_hash,command_type,applied_revision,snapshot,created_at)
    values(p_owner,gen_random_uuid(),v_kind,'goal',v_goal.id,v_goal.id,v_now,(v_now at time zone 'Asia/Shanghai')::date,p_owner,
      p_request_id,v_hash,v_type,v_account.revision+1,jsonb_build_object('before',v_before,'after',v_after,'result',v_result),v_now);
  if v_account.total_xp<>(select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
  update public.adventure_accounts set revision=revision+1,updated_at=v_now where owner_id=p_owner;
  return jsonb_build_object('version',v_account.revision+1,'result',v_result);
end $$;

create or replace function public.adventure_lifecycle_check(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768
    or p_command->>'type' is distinct from 'endGoal' or p_command-array['type','id']<>'{}'::jsonb or not(p_command ?& array['type','id'])
    or jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
  select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  if exists(select 1 from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null) then raise exception 'PENDING_TASKS'; end if;
  return jsonb_build_object('allowed',true,'entityId',v_goal.id,'title',v_goal.title);
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_lifecycle_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_goal public.adventure_goals;
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,p_today);
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
  return jsonb_build_object('operation','endGoal','entityId',v_goal.id,'title',v_goal.title,'stoppingGoals','[]'::jsonb,'stoppingTasks','[]'::jsonb,
    'preservedCompletedTasks',(select count(*) from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='completed' and deleted_at is null),
    'preservedAchievedGoals',0);
end $$;

create or replace function public.adventure_lifecycle_capability(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,p_today); return '{"allowed":true}'::jsonb;
exception when others then return jsonb_build_object('allowed',false,'reason',case sqlerrm
  when 'READ_ONLY' then '目标已进入终态，只能查看' when 'NOT_FOUND' then '目标不存在或不属于当前账户'
  when 'PENDING_TASKS' then '请先删除未完成任务，或在编辑任务中移到其他在用目标／独立任务' else '当前不可结束，请重新读取' end);
end $$;

create or replace function public.adventure_lifecycle_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_command->>'type' is distinct from 'endGoal' then raise exception 'INVALID_COMMAND'; end if;
  return public.adventure_planning_command(p_owner,p_request_id,p_revision,p_command);
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
    where e.owner_id=p_owner and e.task_id=v_task.id and e.kind='task_completed' and e.invalidated_at is null and (g.status<>'active' or e.historical_lock)) then raise exception 'READ_ONLY'; end if;
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

create or replace function public.adventure_migration_options(p_owner uuid,p_kind text,p_id uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_revision bigint; v_options jsonb; v_total bigint; v_result jsonb;
begin
  if p_owner is null or p_id is null or p_kind is distinct from 'task' or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id=p_owner for share;
  if not exists(select 1 from public.adventure_tasks where owner_id=p_owner and id=p_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  with candidates as materialized (
    select ''::text id,'独立任务'::text name,0 rank
    union all select g.id::text,g.title::text,1 from public.adventure_goals g where g.owner_id=p_owner and g.kind='real'
  ) select (select count(*) from candidates),
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'capability',public.adventure_migration_capability(p_owner,
      jsonb_build_object('type','taskDestination','id',p_id,'destination',id))) order by rank,name,id),'[]')
      from (select * from candidates order by rank,name,id limit 20 offset (p_page::bigint-1)*20) page) into v_total,v_options;
  v_result:=jsonb_build_object('version',coalesce(v_revision,0),'kind',p_kind,'entityId',p_id,'page',p_page,'pageSize',20,'total',v_total,'options',v_options);
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_task_history(p_owner uuid,p_task uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_version bigint; v_title text; v_items jsonb; v_total bigint; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  select title into v_title from public.adventure_tasks where owner_id=p_owner and id=p_task and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select count(*) into v_total from public.adventure_events where owner_id=p_owner and task_id=p_task and kind in ('task_created','task_rescheduled');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'kind',h.kind,
        'sourceEventId',h.snapshot->>'sourceEventId','oldPlannedOn',h.snapshot->>'oldPlannedOn',
        'newPlannedOn',coalesce(h.snapshot->>'newPlannedOn',h.snapshot->>'plannedOn'),
        'occurredAt',h.occurred_at,'title',h.snapshot->>'title','description',h.snapshot->>'description',
        'goalId',h.goal_id,'goalTitle',h.snapshot->>'goalTitle')
        order by h.applied_revision,h.id),'[]'::jsonb) into v_items from (
    select * from public.adventure_events where owner_id=p_owner and task_id=p_task and kind in ('task_created','task_rescheduled')
      order by applied_revision,id limit 5 offset (p_page::bigint-1)*5
  ) h;
  v_result:=jsonb_build_object('version',v_version,'taskId',p_task,'title',v_title,'page',p_page,'pageSize',5,'total',v_total,'items',v_items);
  if octet_length(v_result::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create or replace function public.adventure_task_view(p_owner uuid,p_task uuid,p_today date)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'plannedOn',t.planned_on,
      'rescheduleMin',p_today,
      'arrangements',(select coalesce(jsonb_agg(jsonb_build_object('id',a->'id','kind',a->'kind','sourceEventId',a->'sourceEventId','oldPlannedOn',a->'oldPlannedOn','newPlannedOn',a->'newPlannedOn','occurredAt',a->'occurredAt')),'[]'::jsonb) from jsonb_array_elements(history.value->'items') a),'totalArrangements',history.value->'total',
      'status',t.status,'completedOn',t.completed_on,'completionId',e.id,
      'reward',case when e.id is not null then jsonb_build_object('amount',e.amount,'calculation',e.calculation) end,
      'completionOrigin',case when e.id is not null then jsonb_build_object('goalId',e.goal_id,'goalTitle',e.snapshot->>'goalTitle','categoryLabel',e.snapshot->'categoryLabel','title',e.snapshot->>'title','description',e.snapshot->>'description','plannedOn',e.snapshot->>'plannedOn','occurredOn',e.occurred_on) end,
      'goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,
      'independent',g.kind='inbox','overdue',t.status='pending' and t.planned_on<p_today,
      'progress',(select jsonb_build_object('completed',count(*) filter(where x.status='completed'),'total',count(*),
        'ratio',case when count(*)=0 then null else (count(*) filter(where x.status='completed'))::numeric/count(*) end)
        from public.adventure_tasks x where x.owner_id=t.owner_id and x.goal_id=t.goal_id and x.deleted_at is null and x.status in ('pending','completed')),
      'capabilities',jsonb_build_object(
        'edit',public.adventure_task_capability(p_owner,jsonb_build_object('type','editTask','id',t.id,'title',t.title,'description',t.description,'plannedOn',t.planned_on,'destination',case when g.kind='inbox' then '' else g.id::text end),p_today),
        'complete',public.adventure_task_capability(p_owner,jsonb_build_object('type','completeTask','id',t.id),p_today),
        'cancel',case when e.id is null then '{"allowed":false,"reason":"任务尚未完成"}'::jsonb else public.adventure_task_capability(p_owner,jsonb_build_object('type','cancelTaskCompletion','completionId',e.id),p_today) end,
        'reschedule',jsonb_build_object('allowed',false,'reason','请在编辑任务中修改日期'),'migrate',jsonb_build_object('allowed',false,'reason','请在编辑任务中修改归属'),
        'end',jsonb_build_object('allowed',false,'reason','请在编辑任务中删除未完成任务'),
        'delete',public.adventure_task_capability(p_owner,jsonb_build_object('type','deleteTask','id',t.id),p_today)))
  from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    left join public.adventure_events e on e.owner_id=t.owner_id and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null
  cross join lateral (select public.adventure_task_history(p_owner,t.id,1) value) history
  where t.owner_id=p_owner and t.id=p_task and t.deleted_at is null;
$$;

create or replace function public.adventure_reward_view(p_owner uuid,p_event uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('id',id,'kind',kind,'entityId',entity_id,'title',snapshot->>'title',
    'occurredAt',occurred_at,'occurredOn',occurred_on,'amount',amount,
    'calculation',calculation-'actionIds','categoryLabel',snapshot->'categoryLabel','goalId',goal_id,
    'goalTitle',case when kind='goal_achieved' then snapshot->>'title' else snapshot->>'goalTitle' end)
  from public.adventure_events where owner_id=p_owner and id=p_event
    and kind in ('task_completed','goal_achieved') and invalidated_at is null;
$$;


create or replace function public.adventure_reward_source(p_owner uuid,p_event uuid,p_page integer default 1,p_version bigint default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_version bigint; e public.adventure_events; v_items jsonb; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 or p_version<0 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_version from public.adventure_accounts where owner_id=p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_version is not null and p_version<>coalesce(v_version,0) then raise exception 'VERSION_CONFLICT'; end if;
  select * into e from public.adventure_events where owner_id=p_owner and id=p_event
    and kind in ('task_completed','goal_achieved') and invalidated_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('taskId',s->>'taskId','completionId',s->>'completionId',
    'goalId',s->>'goalId','occurredOn',s->>'occurredOn',
    'title',s->'source'->>'title','description',s->'source'->>'description','plannedOn',s->'source'->>'plannedOn',
    'categoryLabel',s->'source'->'categoryLabel','goalTitle',s->'source'->>'goalTitle') order by n),'[]'::jsonb)
    into v_items from (select s,n from jsonb_array_elements(coalesce(e.snapshot->'actionSources','[]'::jsonb)) with ordinality a(s,n)
      order by n limit 5 offset (p_page::bigint-1)*5) sources;
  v_result:=jsonb_build_object('version',coalesce(v_version,0),'event',public.adventure_reward_view(p_owner,e.id),
    'description',e.snapshot->>'description','plannedOn',e.snapshot->>'plannedOn',
    'standards',coalesce(e.snapshot->'standards',nullif(e.snapshot->'goalStandards','null'::jsonb),'[]'::jsonb),
    'reflection',e.snapshot->>'reflection','page',p_page,'pageSize',5,
    'totalSources',jsonb_array_length(coalesce(e.snapshot->'actionSources','[]'::jsonb)),'actionSources',v_items);
  if octet_length(v_result::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
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
    'allowed',true,'requiresConfirmation',false,'message',case when p_command->>'type'='completeTask' then '可直接完成今天的行动，实时获得 1 点经验' else '保存后更新规划，不改变目标状态或经验' end);
end $$;


create or replace function public.adventure_goal_view(p_owner uuid,p_goal uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('id',g.id,'title',g.title,'standards',g.standards,'categoryLabel',g.category_label,
    'focused',g.focused,'sortOrder',g.sort_order,'createdAt',g.created_at,'status',g.status,'terminatedAt',g.terminated_at,
    'achievement',(select jsonb_build_object('id',e.id,'occurredOn',e.occurred_on,'reflection',e.snapshot->>'reflection',
      'reward',jsonb_build_object('amount',e.amount,'calculation',e.calculation)) from public.adventure_events e
      where e.owner_id=g.owner_id and e.goal_id=g.id and e.kind='goal_achieved'),
    'progress',(select jsonb_build_object('completed',count(*) filter(where t.status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where t.status='completed'))::numeric/count(*) end)
      from public.adventure_tasks t where t.owner_id=g.owner_id and t.goal_id=g.id and t.deleted_at is null and t.status in ('pending','completed')),
    'capabilities',jsonb_build_object('edit',cap.edit,'reorder',cap.edit,
      'moveUp',jsonb_build_object('allowed',g.status='active' and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.kind='real' and n.status='active' and (n.sort_order,n.id)<(g.sort_order,g.id))),
      'moveDown',jsonb_build_object('allowed',g.status='active' and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.kind='real' and n.status='active' and (n.sort_order,n.id)>(g.sort_order,g.id))),
      'achieve',case when g.status='active' and exists(select 1 from public.adventure_tasks t where t.owner_id=g.owner_id and t.goal_id=g.id and t.status='pending' and t.deleted_at is null)
        then '{"allowed":false,"reason":"请先处理未完成任务"}'::jsonb else cap.edit end,
      'end',public.adventure_lifecycle_capability(p_owner,jsonb_build_object('type','endGoal','id',g.id),(clock_timestamp() at time zone 'Asia/Shanghai')::date),'createTask',cap.edit))
  from public.adventure_goals g cross join lateral (select case when g.status='active' then '{"allowed":true}'::jsonb else '{"allowed":false,"reason":"目标已进入终态，只能查看"}'::jsonb end edit) cap
  where g.owner_id=p_owner and g.id=p_goal and g.kind='real';
$$;

drop function if exists public.adventure_planning_read(uuid,integer,integer,boolean,uuid,text);
create or replace function public.adventure_planning_read(p_owner uuid,p_page integer default 1,p_page_size integer default 20,p_include_terminal boolean default false)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_account public.adventure_accounts; v_result jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 50
    or p_include_terminal is null then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id=p_owner for share;
  if v_account.total_xp<>(select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null) then raise exception 'INCONSISTENT_REWARDS'; end if;
  select jsonb_build_object('version',v_account.revision,'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
    'page',p_page,'pageSize',p_page_size,
    'totalGoals',(select count(*) from public.adventure_goals g where g.owner_id=p_owner and g.kind='real' and (g.status='active' or p_include_terminal)),
    'goals',coalesce((select jsonb_agg(item order by terminal_rank,sort_rank,terminated_at desc,id) from (
      select g.id,case when g.status='active' then 0 else 1 end terminal_rank,case when g.status='active' then g.sort_order end sort_rank,
        case when g.status<>'active' then g.terminated_at end terminated_at,public.adventure_goal_view(p_owner,g.id) item
      from public.adventure_goals g where g.owner_id=p_owner and g.kind='real' and (g.status='active' or p_include_terminal)
      order by terminal_rank,sort_rank,terminated_at desc,g.id limit p_page_size offset (p_page::bigint-1)*p_page_size) goals),'[]'::jsonb),
    'growth',public.adventure_growth(p_owner),
    'capabilities',jsonb_build_object('createGoal','{"allowed":true}'::jsonb,'createTask','{"allowed":true}'::jsonb,'growth','{"allowed":true}'::jsonb,'progress','{"allowed":true}'::jsonb),
    'limits',jsonb_build_object('name',200,'standard',4000,'standards',50)) into v_result;
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;
revoke execute on function public.adventure_planning_read(uuid,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.adventure_planning_read(uuid,integer,integer,boolean) to service_role;

drop function if exists public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean,uuid,text);
create or replace function public.adventure_workspace_read(p_owner uuid,p_page integer default 1,p_page_size integer default 20,p_task_range text default 'today',p_task_page integer default 1,p_task_scope text default 'all',p_search text default '',p_goal_id uuid default null,p_goal_task_page integer default 1,p_include_terminal boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout='3s' as $$
declare
  v_result jsonb;
  v_today date;
  v_tasks jsonb;
  v_progress jsonb;
  v_detail jsonb;
  v_total bigint;
  v_later jsonb:='{"allowed":false,"reason":"此操作尚未交付"}';
begin
  if p_task_range is null or p_task_range not in ('today','future','past') or p_task_page is null or p_task_page not between 1 and 1000000
    or p_goal_task_page is null or p_goal_task_page not between 1 and 1000000
    or p_task_scope is null or p_task_scope not in ('all','focus') or p_search is null or length(btrim(p_search))>100 then raise exception 'INVALID_COMMAND'; end if;
  v_result:=public.adventure_planning_read(p_owner,p_page,p_page_size,p_include_terminal);
  v_today:=(v_result->>'today')::date;
  with filtered as materialized (
    select t.* from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.owner_id=p_owner and t.deleted_at is null and
      case p_task_range when 'today' then (t.planned_on=v_today or t.status='completed' and t.completed_on=v_today) when 'past' then t.planned_on<v_today else t.planned_on>v_today end
      and (p_task_scope='all' or g.focused or g.kind='inbox')
      and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(t.title))>0 or position(lower(btrim(p_search)) in lower(t.description))>0)
  )

  select (select count(*) from filtered),
    (select jsonb_build_object('completed',count(*) filter(where status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where status='completed'))::numeric/count(*) end)
      from filtered where status in ('pending','completed')),
    (select coalesce(jsonb_agg(item order by status_rank,planned_on,created_at,id),'[]'::jsonb) from (
    select case t.status when 'pending' then 0 when 'completed' then 1 else 2 end status_rank,t.planned_on,t.created_at,t.id,public.adventure_task_view(p_owner,t.id,v_today) item
    from filtered t
    order by status_rank,t.planned_on,t.created_at,t.id limit p_page_size offset (p_task_page::bigint-1)*p_page_size
  ) tasks) into v_total,v_progress,v_tasks;
  v_result:=v_result||jsonb_build_object('today',v_today,'tasks',v_tasks,'totalTasks',v_total,'taskPage',p_task_page,'taskRange',p_task_range,
    'includeTerminal',p_include_terminal,
    'taskScope',p_task_scope,'search',btrim(p_search),'taskProgress',v_progress,
    'todayTaskProgress',(select jsonb_build_object('completed',count(*) filter(where status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where status='completed'))::numeric/count(*) end)
      from public.adventure_tasks where owner_id=p_owner and deleted_at is null and status in ('pending','completed') and (planned_on=v_today or status='completed' and completed_on=v_today)));
  if p_goal_id is not null then
    v_detail:=public.adventure_goal_view(p_owner,p_goal_id);
    if v_detail is null then raise exception 'NOT_FOUND'; end if;
    v_result:=v_result||jsonb_build_object('goalDetail',jsonb_build_object('goal',v_detail,
      'taskPage',p_goal_task_page,'totalTasks',(select count(*) from public.adventure_tasks t where t.owner_id=p_owner and t.deleted_at is null and (t.goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id))),
      'totalRelatedTasks',(select count(*) from public.adventure_tasks where owner_id=p_owner and deleted_at is null and goal_id=p_goal_id and status in ('pending','completed')),
      'relatedTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plannedOn',planned_on,'completedAt',completed_at) order by planned_on,created_at,id),'[]'::jsonb) from (
        select id,title,planned_on,completed_at,created_at from public.adventure_tasks where owner_id=p_owner and goal_id=p_goal_id and deleted_at is null and status in ('pending','completed')
        order by planned_on,created_at,id limit p_page_size offset (p_goal_task_page::bigint-1)*p_page_size) related),
      'tasks',(select coalesce(jsonb_agg(item order by planned_on,created_at,id),'[]') from (
        select planned_on,created_at,id,public.adventure_task_view(p_owner,id,v_today) item from public.adventure_tasks
        where owner_id=p_owner and deleted_at is null and (goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=adventure_tasks.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id)) order by planned_on,created_at,id
        limit p_page_size offset (p_goal_task_page::bigint-1)*p_page_size) history)));
  end if;
  v_result:=jsonb_set(v_result,'{capabilities,createTask}','{"allowed":true}');
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

revoke execute on function public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean) to service_role;

create or replace function public.adventure_planning_capability(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  return public.adventure_planning_check(p_owner,p_command);
end $$;

create or replace function public.adventure_migration_capability(p_owner uuid,p_command jsonb,p_allow_current boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  return public.adventure_migration_check(p_owner,p_command);
exception when others then
  if sqlerrm='SAME_DESTINATION' and p_allow_current then return '{"allowed":true}'::jsonb; end if;
  return jsonb_build_object('allowed',false,'reason',case sqlerrm
    when 'SAME_DESTINATION' then '当前归属，无需迁移'
    when 'TASK_NOT_PENDING' then '仅待完成任务可以更改归属'
    when 'READ_ONLY' then '事项、当前归属或历史完成归属已进入终态，只能查看'
    when 'NOT_FOUND' then '目的不存在或不属于当前账户'
    else '当前不可迁移，请重新读取' end);
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'adventure\_%' escape '\' loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
-- Reject unsafe inherited or default grants before exposing the new schema.
do $$
begin
  if exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'adventure\_%' escape '\'
    and c.relkind='r' and (not c.relrowsecurity or c.relforcerowsecurity or has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger')
      or has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger') or has_table_privilege('service_role',c.oid,'delete,truncate,references,trigger')
      or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)
      or exists(select 1 from pg_roles role where
        ((pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
          and (has_table_privilege(role.oid,c.oid,'select,insert,update,delete,truncate,references,trigger')
            or case when current_setting('server_version_num')::integer>=170000 then has_table_privilege(role.oid,c.oid,'maintain') else false end))
        or (pg_has_role('service_role',role.oid,'MEMBER')
          and (has_table_privilege(role.oid,c.oid,'delete,truncate,references,trigger')
            or has_table_privilege(role.oid,c.oid,'select with grant option,insert with grant option,update with grant option')
            or case when current_setting('server_version_num')::integer>=170000 then has_table_privilege(role.oid,c.oid,'maintain') else false end)))
      or exists(select 1 from unnest(array['select','insert','update']) v where not has_table_privilege('service_role',c.oid,v))))
    or exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relnamespace='public'::regnamespace
      and c.relname like 'adventure\_%' escape '\' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and (has_column_privilege('anon',c.oid,a.attname,'select,insert,update,references') or has_column_privilege('authenticated',c.oid,a.attname,'select,insert,update,references')
        or has_column_privilege('service_role',c.oid,a.attname,'references')
        or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee=0)
        or exists(select 1 from pg_roles role where
          ((pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
            and has_column_privilege(role.oid,c.oid,a.attname,'select,insert,update,references'))
          or (pg_has_role('service_role',role.oid,'MEMBER') and
            (has_column_privilege(role.oid,c.oid,a.attname,'references') or has_column_privilege(role.oid,c.oid,a.attname,'select with grant option,insert with grant option,update with grant option'))))))
    or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'adventure\_%' escape '\'
      and (p.prosecdef or not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c where c in ('search_path=""','search_path='))
        or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute')
        or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
          and has_function_privilege(role.oid,p.oid,'execute'))
        or exists(select 1 from pg_roles role where pg_has_role('service_role',role.oid,'MEMBER') and has_function_privilege(role.oid,p.oid,'execute with grant option'))))
    or has_schema_privilege('anon','public','create') or has_schema_privilege('authenticated','public','create')
    or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER')
      or pg_has_role('service_role',role.oid,'MEMBER')) and has_schema_privilege(role.oid,'public','create'))
    or not coalesce((select rolbypassrls from pg_roles where rolname='service_role'),false)
    or exists(select 1 from pg_roles role where (pg_has_role('anon',role.oid,'MEMBER') or pg_has_role('authenticated',role.oid,'MEMBER'))
      and (role.rolsuper or role.rolbypassrls or role.rolcreaterole or role.rolcreatedb or role.rolreplication))
    or exists(select 1 from pg_roles role where pg_has_role('service_role',role.oid,'MEMBER')
      and (role.rolsuper or role.rolcreaterole or role.rolcreatedb or role.rolreplication))
    then raise exception 'GOAL_MIGRATION_UNSAFE_SECURITY'; end if;
end $$;
notify pgrst,'reload schema';
commit;
