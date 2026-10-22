-- #54 fresh-install schema. The legacy adventure_states table was removed by the user.
create table public.adventure_accounts (
  owner_id uuid primary key,
  total_xp bigint not null default 0 check (total_xp between 0 and 9007199254740991),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  time_zone text not null default 'Asia/Shanghai' check (time_zone = 'Asia/Shanghai'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.adventure_mainlines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adventure_accounts(owner_id),
  kind text not null check (kind in ('normal','independent')),
  name varchar(200) not null check (length(btrim(name)) > 0),
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique(owner_id,id),
  check ((status = 'ended') = (ended_at is not null)),
  check (kind <> 'independent' or status = 'active')
);
create unique index adventure_one_independent on public.adventure_mainlines(owner_id) where kind = 'independent';
create index adventure_mainlines_owner_status on public.adventure_mainlines(owner_id,status,created_at,id);

create table public.adventure_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adventure_accounts(owner_id),
  mainline_id uuid not null,
  kind text not null default 'real' check (kind in ('real','inbox')),
  title varchar(200) not null check (length(btrim(title)) > 0),
  standards jsonb not null check (jsonb_typeof(standards) = 'array' and jsonb_array_length(standards) between 1 and 50),
  status text not null default 'active' check (status in ('active','achieved','ended')),
  focused boolean not null default false,
  sort_order bigint not null default 0 check (sort_order between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminated_at timestamptz,
  termination_cause text check (termination_cause in ('achieved','ended','mainline_ended')),
  achieved_at timestamptz,
  achieved_on date,
  attainment_coefficient smallint check (attainment_coefficient between 1 and 3),
  attainment_reflection text,
  attainment_action_count integer check (attainment_action_count >= 0),
  attainment_action_ids uuid[],
  attainment_snapshot jsonb check (jsonb_typeof(attainment_snapshot) = 'object'),
  unique(owner_id,id),
  foreign key (owner_id,mainline_id) references public.adventure_mainlines(owner_id,id),
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
create index adventure_goals_owner_mainline on public.adventure_goals(owner_id,mainline_id,kind,status,focused,sort_order,id);

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
  end_cause text check (end_cause in ('manual','goal_achieved','goal_ended','mainline_ended')),
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
    'mainline_created','mainline_updated','mainline_ended',
    'goal_created','goal_updated','goal_focused','goal_reordered','goal_migrated','goal_achieved','goal_ended',
    'task_created','task_updated','task_rescheduled','task_migrated','task_ended','task_deleted',
    'task_completed','task_completion_cancelled'
  )),
  entity_type text not null check (entity_type in ('account','mainline','goal','task')),
  entity_id uuid,
  task_id uuid,
  mainline_id uuid,
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
  unique(owner_id,id),
  foreign key(owner_id,mainline_id) references public.adventure_mainlines(owner_id,id),
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
create index adventure_event_group on public.adventure_events(owner_id,event_group_id,id);
create index adventure_event_task on public.adventure_events(owner_id,task_id);
create index adventure_event_kind_time on public.adventure_events(owner_id,kind,occurred_at,id);
create index adventure_event_mainline on public.adventure_events(owner_id,mainline_id);
create index adventure_event_goal on public.adventure_events(owner_id,goal_id);
create index adventure_event_invalidation on public.adventure_events(owner_id,invalidated_by_event_id);

alter table public.adventure_accounts enable row level security;
alter table public.adventure_mainlines enable row level security;
alter table public.adventure_goals enable row level security;
alter table public.adventure_tasks enable row level security;
alter table public.adventure_events enable row level security;
revoke all on public.adventure_accounts, public.adventure_mainlines, public.adventure_goals,
  public.adventure_tasks, public.adventure_events from public, anon, authenticated, service_role;
grant select, insert, update on public.adventure_accounts, public.adventure_mainlines, public.adventure_goals,
  public.adventure_tasks, public.adventure_events to service_role;

-- Growth and task facts are read while holding the same account lock as the caller.
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
    'unlocked',case when kind='actions' then v_actions else v_goals end >= threshold) order by ordinal)
  into v_badges from (values
    (1,'actions',1,'迈出第一步'),(2,'actions',10,'十次行动'),(3,'actions',50,'五十次行动'),(4,'actions',100,'百次行动'),
    (5,'goals',1,'首个成果'),(6,'goals',3,'三个成果'),(7,'goals',10,'十个成果')
  ) badges(ordinal,kind,threshold,label);
  return jsonb_build_object('level',v_level,'totalXp',v_xp,'progress',v_progress,'needed',20+5*(v_level-1),
    'remaining',20+5*(v_level-1)-v_progress,'actions',v_actions,'achievedGoals',v_goals,'achievements',v_badges);
end $$;

-- Shared migration rules for candidates, previews and final locked writes.
create or replace function public.adventure_migration_check(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_goal public.adventure_goals;
  v_task public.adventure_tasks;
  v_target public.adventure_goals;
  v_main public.adventure_mainlines;
  v_destination text:=p_command->>'destination';
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object' or pg_column_size(p_command)>32768
    or p_command->>'type' is null or p_command->>'type' not in ('migrateGoal','migrateTask')
    or p_command-array['type','id','destination']<>'{}'::jsonb or not(p_command ?& array['type','id','destination'])
    or jsonb_typeof(p_command->'id') is distinct from 'string' or jsonb_typeof(p_command->'destination') is distinct from 'string'
    then raise exception 'INVALID_COMMAND'; end if;
  if p_command->>'type'='migrateTask' then
    select * into v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_task.status='ended' then raise exception 'READ_ONLY'; end if;
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
    if exists(select 1 from public.adventure_events e
      left join public.adventure_goals g on (g.owner_id,g.id)=(e.owner_id,e.goal_id)
      left join public.adventure_mainlines m on (m.owner_id,m.id)=(e.owner_id,e.mainline_id)
      where e.owner_id=p_owner and e.task_id=v_task.id and e.kind='task_completed' and e.invalidated_at is null
        and (g.status<>'active' or m.status<>'active')) then raise exception 'READ_ONLY'; end if;
  else
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  if v_goal.status<>'active' or not exists(select 1 from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id and status='active')
    then raise exception 'READ_ONLY'; end if;
  if p_command->>'type'='migrateTask' then
    if v_destination='' then
      if v_goal.kind='inbox' then raise exception 'SAME_DESTINATION'; end if;
    else
      select * into v_target from public.adventure_goals where owner_id=p_owner and id=v_destination::uuid and kind='real';
      if not found then raise exception 'NOT_FOUND'; end if;
      if v_target.id=v_goal.id then raise exception 'SAME_DESTINATION'; end if;
      if v_target.status<>'active' or not exists(select 1 from public.adventure_mainlines where owner_id=p_owner and id=v_target.mainline_id and status='active')
        then raise exception 'READ_ONLY'; end if;
    end if;
  else
    if v_destination in ('','independent') then
      select * into v_main from public.adventure_mainlines where owner_id=p_owner and kind='independent';
    else
      select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=v_destination::uuid and kind='normal';
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    if v_main.id=v_goal.mainline_id then raise exception 'SAME_DESTINATION'; end if;
    if v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
    if v_goal.focused and (select count(*) from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active' and focused)>=3
      then raise exception 'FOCUS_LIMIT'; end if;
  end if;
  return '{"allowed":true}'::jsonb;
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_migration_capability(p_owner uuid,p_command jsonb,p_allow_current boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  return public.adventure_migration_check(p_owner,p_command);
exception when others then
  if sqlerrm='SAME_DESTINATION' and p_allow_current then return '{"allowed":true}'::jsonb; end if;
  return jsonb_build_object('allowed',false,'reason',case sqlerrm
    when 'SAME_DESTINATION' then '当前归属，无需迁移'
    when 'FOCUS_LIMIT' then '目的归属已聚焦 3 个目标，请先调整聚焦'
    when 'READ_ONLY' then '事项、当前归属或历史完成归属已进入终态，只能查看'
    when 'NOT_FOUND' then '目的不存在或不属于当前账户'
    else '当前不可迁移，请重新读取' end);
end $$;

create or replace function public.adventure_migration_options(p_owner uuid,p_kind text,p_id uuid,p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_revision bigint; v_options jsonb; v_total bigint; v_result jsonb;
begin
  if p_owner is null or p_id is null or p_kind is null or p_kind not in ('goal','task') or p_page is null or p_page not between 1 and 1000000 then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id=p_owner for share;
  if p_kind='goal' and not exists(select 1 from public.adventure_goals where owner_id=p_owner and id=p_id and kind='real')
    or p_kind='task' and not exists(select 1 from public.adventure_tasks where owner_id=p_owner and id=p_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  with candidates as materialized (
    select ''::text id,case when p_kind='goal' then '独立目标' else '独立任务' end name,0 rank
    union all
    select m.id::text,m.name,1 from public.adventure_mainlines m where p_kind='goal' and m.owner_id=p_owner and m.kind='normal'
    union all
    select g.id::text,m.name||' / '||g.title,1 from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id)
      where p_kind='task' and g.owner_id=p_owner and g.kind='real'
  )
  select (select count(*) from candidates),
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'capability',public.adventure_migration_capability(p_owner,
      jsonb_build_object('type',case when p_kind='goal' then 'migrateGoal' else 'migrateTask' end,'id',p_id,'destination',id))) order by rank,name,id),'[]')
      from (select * from candidates order by rank,name,id limit 20 offset (p_page::bigint-1)*20) page)
    into v_total,v_options;
  v_result:=jsonb_build_object('version',coalesce(v_revision,0),'kind',p_kind,'entityId',p_id,'page',p_page,'pageSize',20,'total',v_total,'options',v_options);
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;
revoke execute on function public.adventure_migration_check(uuid,jsonb),public.adventure_migration_capability(uuid,jsonb,boolean),public.adventure_migration_options(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.adventure_migration_check(uuid,jsonb),public.adventure_migration_capability(uuid,jsonb,boolean),public.adventure_migration_options(uuid,text,uuid,integer) to service_role;

create or replace function public.adventure_task_check(p_owner uuid, p_command jsonb, p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text := p_command->>'type';
  v_keys text[];
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
  v_done public.adventure_events;
  v_day date;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command)>32768 then raise exception 'INVALID_COMMAND'; end if;
  if v_type='migrateTask' then return public.adventure_migration_check(p_owner,p_command); end if;
  case v_type
    when 'createTask' then v_keys:=array['type','title','description','plannedOn','destination'];
    when 'editTask' then v_keys:=array['type','id','title','description'];
    when 'completeTask' then v_keys:=array['type','id'];
    when 'endTask' then v_keys:=array['type','id'];
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
    if v_type in ('editTask','completeTask','endTask') and v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
    if v_type='deleteTask' then
      if v_task.status<>'pending' then raise exception 'TASK_NOT_PENDING'; end if;
      if v_task.planned_on<=p_today then raise exception 'DATE_STARTED'; end if;
      if exists(select 1 from public.adventure_events where owner_id=p_owner and task_id=v_task.id
        and kind in ('task_completed','task_rescheduled')) then raise exception 'HISTORY_LOCKED'; end if;
    end if;
    if v_type='completeTask' and v_task.planned_on<>p_today then raise exception 'DATE_LOCKED'; end if;
    if v_type='cancelTaskCompletion' then
      if v_task.status<>'completed' or v_task.completed_on<>p_today or v_task.completed_at<>v_done.occurred_at then raise exception 'COMPLETION_CHANGED'; end if;
      if exists(select 1 from public.adventure_goals where owner_id=p_owner and id=v_done.goal_id and status<>'active')
        or exists(select 1 from public.adventure_mainlines where owner_id=p_owner and id=v_done.mainline_id and status<>'active') then raise exception 'READ_ONLY'; end if;
    end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  end if;
  if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
  select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
  if not found or v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
  return jsonb_build_object('allowed',true,'taskId',v_task.id,'completionId',v_done.id);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_task_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
begin
  if p_command->>'type' not in ('endTask','deleteTask') then raise exception 'INVALID_COMMAND'; end if;
  perform public.adventure_task_check(p_owner,p_command,p_today);
  select * into strict v_task from public.adventure_tasks where owner_id=p_owner and id=(p_command->>'id')::uuid and deleted_at is null;
  select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_task.goal_id;
  return jsonb_build_object('operation',p_command->>'type','entityId',v_task.id,'title',v_task.title,
    'stoppingGoals','[]'::jsonb,
    'stoppingTasks',case when p_command->>'type'='endTask' then
      jsonb_build_array(jsonb_build_object('id',v_task.id,'title',v_task.title,'plannedOn',v_task.planned_on)) else '[]'::jsonb end,
    'preservedCompletedTasks',case when v_task.status='completed' then 1 else 0 end,
    'preservedAchievedGoals',0,
    'historicalArrangements',(select count(*) from public.adventure_events where owner_id=p_owner and task_id=v_task.id
      and kind='task_rescheduled'),
    'goalId',case when v_goal.kind='real' then v_goal.id end,
    'plannedOn',v_task.planned_on);
end $$;
revoke execute on function public.adventure_task_impact(uuid,jsonb,date) from public,anon,authenticated;
grant execute on function public.adventure_task_impact(uuid,jsonb,date) to service_role;

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
    when 'DATE_STARTED' then '执行日已到，不能按误建删除；不再执行可选择结束'
    else '当前不可操作，请重新读取' end);
end $$;

create or replace function public.adventure_lifecycle_check(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_type text:=p_command->>'type';
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
begin
  if p_owner is null or p_today is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command)>32768 or v_type is null or v_type not in ('endGoal','endMainline') then raise exception 'INVALID_COMMAND'; end if;
  if p_command-array['type','id']<>'{}'::jsonb or not(p_command ?& array['type','id'])
    or jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
  if v_type='endGoal' then
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
    select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
    if not found or v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
    return jsonb_build_object('allowed',true,'entityId',v_goal.id,'title',v_goal.title);
  end if;
  select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='normal';
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
  return jsonb_build_object('allowed',true,'entityId',v_main.id,'title',v_main.name);
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_lifecycle_impact(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,p_today);
  if p_command->>'type'='endGoal' then
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
    return jsonb_build_object('operation','endGoal','entityId',v_goal.id,'title',v_goal.title,
      'stoppingGoals','[]'::jsonb,
      'stoppingTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
        from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null),
      'preservedCompletedTasks',(select count(*) from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='completed' and deleted_at is null),
      'preservedAchievedGoals',0);
  end if;
  select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=(p_command->>'id')::uuid;
  return jsonb_build_object('operation','endMainline','entityId',v_main.id,'title',v_main.name,
    'stoppingGoals',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title) order by sort_order,id),'[]')
      from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active'),
    'stoppingTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'plannedOn',t.planned_on) order by t.planned_on,t.created_at,t.id),'[]')
      from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
      where t.owner_id=p_owner and g.mainline_id=v_main.id and g.kind='real' and g.status='active' and t.status='pending' and t.deleted_at is null),
    'preservedCompletedTasks',(select count(*) from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
      where t.owner_id=p_owner and g.mainline_id=v_main.id and g.kind='real' and t.status='completed' and t.deleted_at is null),
    'preservedAchievedGoals',(select count(*) from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='achieved'));
end $$;

create or replace function public.adventure_lifecycle_capability(p_owner uuid,p_command jsonb,p_today date)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,p_today);
  return jsonb_build_object('allowed',true);
exception when others then
  return jsonb_build_object('allowed',false,'reason',case sqlerrm
    when 'READ_ONLY' then '目标或所属主线已进入终态，只能查看'
    when 'NOT_FOUND' then '目标不存在或不属于当前账户'
    else '当前不可结束，请重新读取' end);
end $$;

create or replace function public.adventure_lifecycle_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_today date:=(p_now at time zone 'Asia/Shanghai')::date;
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
  v_before jsonb;
  v_after jsonb;
  v_impact jsonb;
  v_event uuid:=gen_random_uuid();
  v_result jsonb;
begin
  perform public.adventure_lifecycle_check(p_owner,p_command,v_today);
  v_impact:=public.adventure_lifecycle_impact(p_owner,p_command,v_today);
  if octet_length(v_impact::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  if p_command->>'type'='endGoal' then
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
    select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
    v_before:=to_jsonb(v_goal)-'owner_id';
    update public.adventure_goals set status='ended',focused=false,terminated_at=p_now,termination_cause='ended',updated_at=p_now
      where owner_id=p_owner and id=v_goal.id returning * into v_goal;
    update public.adventure_tasks set status='ended',ended_at=p_now,end_cause='goal_ended',updated_at=p_now
      where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null;
    v_after:=to_jsonb(v_goal)-'owner_id';
    v_result:=jsonb_build_object('entityId',v_goal.id,'message','目标已结束，未完成任务已停止');
    insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,goal_id,
      occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,snapshot,created_at)
      values(v_event,p_owner,gen_random_uuid(),'goal_ended','goal',v_goal.id,v_main.id,v_goal.id,p_now,v_today,p_owner,
        p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'endGoal',p_revision+1,
        jsonb_build_object('before',v_before,'after',v_after,'impact',v_impact,'result',v_result),p_now);
  else
    select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=(p_command->>'id')::uuid;
    v_before:=to_jsonb(v_main)-'owner_id';
    update public.adventure_mainlines set status='ended',ended_at=p_now,updated_at=p_now
      where owner_id=p_owner and id=v_main.id returning * into v_main;
    update public.adventure_goals set status='ended',focused=false,terminated_at=p_now,termination_cause='mainline_ended',updated_at=p_now
      where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active';
    update public.adventure_tasks t set status='ended',ended_at=p_now,end_cause='mainline_ended',updated_at=p_now
      from public.adventure_goals g
      where t.owner_id=p_owner and (g.owner_id,g.id)=(t.owner_id,t.goal_id)
        and g.mainline_id=v_main.id and g.kind='real' and t.status='pending' and t.deleted_at is null;
    v_after:=to_jsonb(v_main)-'owner_id';
    v_result:=jsonb_build_object('entityId',v_main.id,'message','主线已结束，进行中目标和待完成任务已停止');
    insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,
      occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,snapshot,created_at)
      values(v_event,p_owner,gen_random_uuid(),'mainline_ended','mainline',v_main.id,v_main.id,p_now,v_today,p_owner,
        p_request_id,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),'endMainline',p_revision+1,
        jsonb_build_object('before',v_before,'after',v_after,'impact',v_impact,'result',v_result),p_now);
  end if;
  if (select total_xp from public.adventure_accounts where owner_id=p_owner) <>
    (select coalesce(sum(amount),0) from public.adventure_events where owner_id=p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
    then raise exception 'INCONSISTENT_REWARDS'; end if;
  update public.adventure_accounts set revision=p_revision+1,updated_at=p_now where owner_id=p_owner;
  return jsonb_build_object('version',p_revision+1,'result',v_result);
end $$;
revoke execute on function public.adventure_lifecycle_check(uuid,jsonb,date),public.adventure_lifecycle_impact(uuid,jsonb,date),public.adventure_lifecycle_capability(uuid,jsonb,date),
  public.adventure_lifecycle_apply(uuid,text,bigint,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.adventure_lifecycle_check(uuid,jsonb,date),public.adventure_lifecycle_impact(uuid,jsonb,date),public.adventure_lifecycle_capability(uuid,jsonb,date),
  public.adventure_lifecycle_apply(uuid,text,bigint,jsonb,timestamptz) to service_role;

create or replace function public.adventure_task_apply(p_owner uuid,p_request_id text,p_revision bigint,p_command jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text:=p_command->>'type';
  v_today date:=(p_now at time zone 'Asia/Shanghai')::date;
  v_task public.adventure_tasks;
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
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
  if v_type in ('endTask','deleteTask') then v_impact:=public.adventure_task_impact(p_owner,p_command,v_today); end if;
  v_before_growth:=public.adventure_growth(p_owner);
  if v_type in ('createTask','migrateTask') then
    if coalesce(p_command->>'destination','')='' then
      select * into v_main from public.adventure_mainlines where owner_id=p_owner and kind='independent';
      if not found then
        insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at) values(p_owner,'independent','独立区',p_now,p_now) returning * into v_main;
      end if;
      select * into v_goal from public.adventure_goals where owner_id=p_owner and kind='inbox';
      if not found then
        insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
          values(p_owner,v_main.id,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]',p_now,p_now) returning * into v_goal;
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
      update public.adventure_tasks set goal_id=v_goal.id,updated_at=p_now where owner_id=p_owner and id=(p_command->>'id')::uuid returning * into v_task;
      v_kind:='task_migrated';
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
      when 'editTask' then
        update public.adventure_tasks set title=btrim(p_command->>'title'),description=btrim(p_command->>'description'),updated_at=p_now
          where owner_id=p_owner and id=v_task.id returning * into v_task;
        v_kind:='task_updated';
      when 'completeTask' then
        update public.adventure_tasks set status='completed',completed_at=p_now,completed_on=v_today,updated_at=p_now
          where owner_id=p_owner and id=v_task.id returning * into v_task;
        v_kind:='task_completed';v_delta:=1;
      when 'endTask' then
        update public.adventure_tasks set status='ended',ended_at=p_now,end_cause='manual',updated_at=p_now
          where owner_id=p_owner and id=v_task.id returning * into v_task;
        v_kind:='task_ended';
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
  select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
  v_after:=to_jsonb(v_task)-'owner_id';
  v_snapshot:=jsonb_build_object('before',v_before,'after',v_after,'title',v_task.title,'description',v_task.description,
    'completionId',case when v_type='cancelTaskCompletion' then v_done.id end,
    'plannedOn',v_task.planned_on,'mainlineName',v_main.name,'mainlineKind',v_main.kind,
    'goalTitle',case when v_goal.kind='real' then v_goal.title end,'goalStandards',case when v_goal.kind='real' then v_goal.standards end,
    'impact',v_impact);
  if v_type='migrateTask' then
    v_snapshot:=v_snapshot||jsonb_build_object('origin',(select jsonb_build_object('goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,'mainlineId',m.id,'mainlineName',m.name) from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id) where g.owner_id=p_owner and g.id=(v_before->>'goal_id')::uuid));
  end if;
  if v_type='completeTask' then
    v_reward:=jsonb_build_object('amount',v_delta,'calculation',jsonb_build_object(
      'type','fixed_task','completionId',v_event,'count',1,'coefficient',1));
  elsif v_type='cancelTaskCompletion' then
    v_reward:=jsonb_build_object('amount',v_done.amount,'calculation',v_done.calculation);
  end if;
  insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,task_id,mainline_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
    values(v_event,p_owner,v_group,v_kind,'task',v_task.id,v_task.id,v_main.id,case when v_goal.kind='real' then v_goal.id end,
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
    when 'createTask' then '已创建任务' when 'editTask' then '已保存任务' when 'endTask' then '任务已结束，不再执行且不可恢复'
    when 'deleteTask' then '误建任务已删除'
    when 'cancelTaskCompletion' then '已取消完成，成长已同步更新'
    else '已完成，获得 1 点经验' || case when (v_after_growth->>'level')::bigint>(v_before_growth->>'level')::bigint then '，升至 '||(v_after_growth->>'level')||' 级' else '' end
      || case when jsonb_array_length(v_unlocked)>0 then '，点亮：'||(select string_agg(value, '、') from jsonb_array_elements_text(v_unlocked)) else '' end end,
    'completionId',case when v_type='completeTask' then v_event when v_type='cancelTaskCompletion' then v_done.id end,
    'reward',v_reward,'growthChange',jsonb_build_object('xpDelta',v_delta,'before',v_before_growth,'after',v_after_growth,'unlocked',v_unlocked,'lost',v_lost));
  update public.adventure_events set snapshot=snapshot||jsonb_build_object('result',v_result) where owner_id=p_owner and id=v_event;
  return jsonb_build_object('version',p_revision+1,'result',v_result);
end $$;

-- Reward planning is shared by preview and the locked achievement command.
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
    'taskId',task_id,'completionId',id,'mainlineId',mainline_id,'goalId',goal_id,'occurredOn',occurred_on,
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
declare
  v_goal public.adventure_goals;
  v_main public.adventure_mainlines;
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
  select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
  v_before:=public.adventure_growth(p_owner);
  v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,coalesce((p_command->>'coefficient')::integer,1));
  v_reward:=v_plan->'reward';v_amount:=(v_reward->>'amount')::bigint;
  if (v_before->>'totalXp')::bigint>9007199254740991-v_amount then raise exception 'CAPACITY_REACHED'; end if;
  v_source:=jsonb_build_object('goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
    'mainlineId',v_main.id,'mainlineName',v_main.name,'mainlineKind',v_main.kind,'actionSources',v_plan->'actionSources',
    'stoppedTasks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'plannedOn',planned_on) order by planned_on,created_at,id),'[]')
      from public.adventure_tasks where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null));
  if octet_length(v_source::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
  update public.adventure_goals set status='achieved',focused=false,terminated_at=p_now,termination_cause='achieved',
    achieved_at=p_now,achieved_on=(p_now at time zone 'Asia/Shanghai')::date,
    attainment_coefficient=coalesce((p_command->>'coefficient')::integer,1),attainment_reflection=btrim(coalesce(p_command->>'reflection','')),
    attainment_action_count=(v_reward->'calculation'->>'count')::integer,
    attainment_action_ids=array(select value::uuid from jsonb_array_elements_text(v_reward->'calculation'->'actionIds')),
    attainment_snapshot=v_source,updated_at=p_now where owner_id=p_owner and id=v_goal.id;
  update public.adventure_tasks set status='ended',ended_at=p_now,end_cause='goal_achieved',updated_at=p_now
    where owner_id=p_owner and goal_id=v_goal.id and status='pending' and deleted_at is null;
  insert into public.adventure_events(id,owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,amount,calculation,snapshot,created_at)
    values(v_event,p_owner,gen_random_uuid(),'goal_achieved','goal',v_goal.id,v_main.id,v_goal.id,p_now,(p_now at time zone 'Asia/Shanghai')::date,
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
end $$;
revoke execute on function public.adventure_goal_reward(uuid,uuid,integer),public.adventure_goal_apply(uuid,text,bigint,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.adventure_goal_reward(uuid,uuid,integer),public.adventure_goal_apply(uuid,text,bigint,jsonb,timestamptz) to service_role;

create or replace function public.adventure_task_view(p_owner uuid,p_task uuid,p_today date)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'plannedOn',t.planned_on,
      'status',t.status,'completedOn',t.completed_on,'completionId',e.id,
      'reward',case when e.id is not null then jsonb_build_object('amount',e.amount,'calculation',e.calculation) end,
      'completionOrigin',case when e.id is not null then jsonb_build_object('goalId',e.goal_id,'mainlineId',e.mainline_id,'goalTitle',e.snapshot->>'goalTitle','mainlineName',e.snapshot->>'mainlineName','title',e.snapshot->>'title','description',e.snapshot->>'description','plannedOn',e.snapshot->>'plannedOn','occurredOn',e.occurred_on) end,
      'goalId',case when g.kind='real' then g.id end,'goalTitle',case when g.kind='real' then g.title end,
      'mainlineName',m.name,'independent',g.kind='inbox','overdue',t.status='pending' and t.planned_on<p_today,
      'progress',(select jsonb_build_object('completed',count(*) filter(where x.status='completed'),'total',count(*),
        'ratio',case when count(*)=0 then null else (count(*) filter(where x.status='completed'))::numeric/count(*) end)
        from public.adventure_tasks x where x.owner_id=t.owner_id and x.goal_id=t.goal_id and x.deleted_at is null and x.status in ('pending','completed')),
      'capabilities',jsonb_build_object(
        'edit',public.adventure_task_capability(p_owner,jsonb_build_object('type','editTask','id',t.id,'title',t.title,'description',t.description),p_today),
        'complete',public.adventure_task_capability(p_owner,jsonb_build_object('type','completeTask','id',t.id),p_today),
        'cancel',case when e.id is null then '{"allowed":false,"reason":"任务尚未完成"}'::jsonb else public.adventure_task_capability(p_owner,jsonb_build_object('type','cancelTaskCompletion','completionId',e.id),p_today) end,
        'reschedule',v_later,'migrate',public.adventure_migration_capability(p_owner,jsonb_build_object('type','migrateTask','id',t.id,'destination',case when g.kind='inbox' then '' else g.id::text end),true),
        'end',public.adventure_task_capability(p_owner,jsonb_build_object('type','endTask','id',t.id),p_today),
        'delete',public.adventure_task_capability(p_owner,jsonb_build_object('type','deleteTask','id',t.id),p_today)))
  from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id)
    left join public.adventure_events e on e.owner_id=t.owner_id and e.task_id=t.id and e.kind='task_completed' and e.invalidated_at is null
    cross join (select '{"allowed":false,"reason":"此操作尚未交付"}'::jsonb v_later) capabilities
  where t.owner_id=p_owner and t.id=p_task and t.deleted_at is null;
$$;
revoke execute on function public.adventure_task_view(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.adventure_task_view(uuid,uuid,date) to service_role;

create or replace function public.adventure_workspace_read(p_owner uuid,p_page integer default 1,p_page_size integer default 20,p_task_range text default 'today',p_task_page integer default 1,p_task_scope text default 'all',p_search text default '',p_goal_id uuid default null,p_goal_task_page integer default 1,p_include_terminal boolean default false,p_mainline_id uuid default null)
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
  v_result:=public.adventure_planning_read(p_owner,p_page,p_page_size,p_include_terminal,p_mainline_id);
  v_today:=(v_result->>'today')::date;
  with filtered as materialized (
    select t.* from public.adventure_tasks t join public.adventure_goals g on (g.owner_id,g.id)=(t.owner_id,t.goal_id)
    where t.owner_id=p_owner and t.deleted_at is null and
      case p_task_range when 'today' then t.planned_on=v_today when 'past' then t.planned_on<v_today else t.planned_on>v_today end
      and (p_task_scope='all' or g.focused or g.kind='inbox')
      and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(t.title))>0 or position(lower(btrim(p_search)) in lower(t.description))>0)
  )

  select (select count(*) from filtered),
    (select jsonb_build_object('completed',count(*) filter(where status='completed'),'total',count(*),
      'ratio',case when count(*)=0 then null else (count(*) filter(where status='completed'))::numeric/count(*) end)
      from filtered where status in ('pending','completed')),
    (select coalesce(jsonb_agg(item order by planned_on,created_at,id),'[]'::jsonb) from (
    select t.planned_on,t.created_at,t.id,public.adventure_task_view(p_owner,t.id,v_today) item
    from filtered t
    order by t.planned_on,t.created_at,t.id limit p_page_size offset (p_task_page::bigint-1)*p_page_size
  ) tasks) into v_total,v_progress,v_tasks;
  v_result:=v_result||jsonb_build_object('today',v_today,'tasks',v_tasks,'totalTasks',v_total,'taskPage',p_task_page,'taskRange',p_task_range,
    'includeTerminal',p_include_terminal,
    'taskScope',p_task_scope,'search',btrim(p_search),'taskProgress',v_progress);
  if p_goal_id is not null then
    v_detail:=public.adventure_goal_view(p_owner,p_goal_id);
    if v_detail is null then raise exception 'NOT_FOUND'; end if;
    v_result:=v_result||jsonb_build_object('goalDetail',jsonb_build_object('goal',v_detail,
      'taskPage',p_goal_task_page,'totalTasks',(select count(*) from public.adventure_tasks where owner_id=p_owner and deleted_at is null and (goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=adventure_tasks.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id))),
      'tasks',(select coalesce(jsonb_agg(item order by planned_on,created_at,id),'[]') from (
        select planned_on,created_at,id,public.adventure_task_view(p_owner,id,v_today) item from public.adventure_tasks
        where owner_id=p_owner and deleted_at is null and (goal_id=p_goal_id or exists(select 1 from public.adventure_events e where e.owner_id=p_owner and e.task_id=adventure_tasks.id and e.kind='task_completed' and e.invalidated_at is null and e.goal_id=p_goal_id)) order by planned_on,created_at,id
        limit p_page_size offset (p_goal_task_page::bigint-1)*p_page_size) history)));
  end if;
  v_result:=jsonb_set(v_result,'{capabilities,createTask}','{"allowed":true}');
  if octet_length(v_result::text)>1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

revoke execute on function public.adventure_growth(uuid,bigint,integer),public.adventure_task_check(uuid,jsonb,date),
  public.adventure_task_capability(uuid,jsonb,date),public.adventure_task_apply(uuid,text,bigint,jsonb,timestamptz),
  public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.adventure_growth(uuid,bigint,integer),public.adventure_task_check(uuid,jsonb,date),
  public.adventure_task_capability(uuid,jsonb,date),public.adventure_task_apply(uuid,text,bigint,jsonb,timestamptz),
  public.adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean,uuid) to service_role;

-- Shared final validation, called only while the account lock is held.
create or replace function public.adventure_planning_check(p_owner uuid, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text := p_command->>'type';
  v_keys text[];
  v_main public.adventure_mainlines;
  v_goal public.adventure_goals;
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command) > 32768 then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','migrateTask','endTask','deleteTask') then
    return public.adventure_task_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date);
  end if;
  if v_type in ('endGoal','endMainline') then
    return public.adventure_lifecycle_check(p_owner,p_command,(clock_timestamp() at time zone 'Asia/Shanghai')::date);
  end if;
  if v_type='migrateGoal' then return public.adventure_migration_check(p_owner,p_command); end if;
  case v_type
    when 'createMainline' then v_keys := array['type','name'];
    when 'renameMainline' then v_keys := array['type','id','name'];
    when 'createGoal' then v_keys := array['type','destination','title','standards'];
    when 'editGoal' then v_keys := array['type','id','destination','title','standards'];
    when 'achieveGoal' then v_keys := array['type','id'];
    when 'focusGoal' then v_keys := array['type','id','focused'];
    when 'reorderGoals' then v_keys := array['type','mainlineId','direction','id'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if (case when v_type='reorderGoals' then p_command-'targetId' when v_type='achieveGoal' then p_command-array['coefficient','reflection'] else p_command end) - v_keys <> '{}'::jsonb or not (p_command ?& v_keys)
    then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createMainline','renameMainline') then
    if jsonb_typeof(p_command->'name') is distinct from 'string'
      or length(btrim(p_command->>'name')) not between 1 and 200 then raise exception 'INVALID_COMMAND'; end if;
  elsif v_type in ('createGoal','editGoal') then
    if jsonb_typeof(p_command->'title') is distinct from 'string'
      or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'standards') is distinct from 'array'
      or jsonb_array_length(p_command->'standards') not between 1 and 50
      or exists(select 1 from jsonb_array_elements(p_command->'standards') item
        where jsonb_typeof(item) is distinct from 'string'
          or length(btrim(item #>> '{}')) not between 1 and 4000)
      then raise exception 'INVALID_COMMAND'; end if;
  elsif v_type='achieveGoal' then
    if jsonb_typeof(p_command->'id') is distinct from 'string'
      or (p_command ? 'coefficient' and (jsonb_typeof(p_command->'coefficient') is distinct from 'number' or p_command->>'coefficient' not in ('1','2','3')))
      or (p_command ? 'reflection' and (jsonb_typeof(p_command->'reflection') is distinct from 'string' or length(p_command->>'reflection')>4000)) then raise exception 'INVALID_COMMAND'; end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
    select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
    if not found or v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
    return jsonb_build_object('allowed',true);
  elsif v_type='focusGoal' then
    if jsonb_typeof(p_command->'id') is distinct from 'string' or jsonb_typeof(p_command->'focused') is distinct from 'boolean' then raise exception 'INVALID_COMMAND'; end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
    select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=v_goal.mainline_id;
    if not found or v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
    if (p_command->>'focused')::boolean and not v_goal.focused and
      (select count(*) from public.adventure_goals where owner_id=p_owner and mainline_id=v_goal.mainline_id and kind='real' and status='active' and focused and id<>v_goal.id)>=3
      then raise exception 'FOCUS_LIMIT'; end if;
    return jsonb_build_object('allowed',true);
  elsif v_type='reorderGoals' then
    if jsonb_typeof(p_command->'mainlineId') is distinct from 'string' or jsonb_typeof(p_command->'id') is distinct from 'string'
      or jsonb_typeof(p_command->'direction') is distinct from 'string' or p_command->>'direction' not in ('up','down') then raise exception 'INVALID_COMMAND'; end if;
    select * into v_main from public.adventure_mainlines where owner_id=p_owner and id=(p_command->>'mainlineId')::uuid and kind in ('normal','independent');
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_main.status<>'active' then raise exception 'READ_ONLY'; end if;
    select * into v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid and mainline_id=v_main.id and kind='real';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_goal.status<>'active' then raise exception 'READ_ONLY'; end if;
    if p_command ? 'targetId' then
      if jsonb_typeof(p_command->'targetId') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
      if not exists(select 1 from public.adventure_goals where owner_id=p_owner and id=(p_command->>'targetId')::uuid
        and id<>v_goal.id and mainline_id=v_main.id and kind='real' and status='active' and focused=v_goal.focused)
        then raise exception 'INVALID_COMMAND'; end if;
    end if;
    return jsonb_build_object('allowed',true);
  end if;
  if v_type = 'createMainline' and
    (select count(*) from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active') >= 5
    then raise exception 'MAINLINE_LIMIT'; end if;
  if v_type in ('renameMainline','editGoal') then
    if jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    if v_type = 'editGoal' then
      select * into v_goal from public.adventure_goals where owner_id = p_owner and id = (p_command->>'id')::uuid and kind = 'real';
      if not found then raise exception 'NOT_FOUND'; end if;
      if v_goal.status <> 'active' then raise exception 'READ_ONLY'; end if;
      select * into v_main from public.adventure_mainlines where owner_id = p_owner and id = v_goal.mainline_id;
    else
      select * into v_main from public.adventure_mainlines where owner_id = p_owner and id = (p_command->>'id')::uuid and kind = 'normal';
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    if v_main.status <> 'active' then raise exception 'READ_ONLY'; end if;
  end if;
  if v_type = 'createGoal' then
    if jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    if coalesce(p_command->>'destination','') <> '' and p_command->>'destination' <> 'independent' then
      select * into v_main from public.adventure_mainlines where owner_id = p_owner and id = (p_command->>'destination')::uuid and kind = 'normal';
      if not found then raise exception 'NOT_FOUND'; end if;
      if v_main.status <> 'active' then raise exception 'READ_ONLY'; end if;
    end if;
  end if;
  if v_type='editGoal' then
    if jsonb_typeof(p_command->'destination') is distinct from 'string' then raise exception 'INVALID_COMMAND'; end if;
    if (p_command->>'destination' in ('','independent') and v_main.kind<>'independent')
      or (p_command->>'destination' not in ('','independent') and p_command->>'destination'<>v_goal.mainline_id::text) then
      perform public.adventure_migration_check(p_owner,jsonb_build_object('type','migrateGoal','id',v_goal.id,'destination',p_command->>'destination'));
    end if;
  end if;
  return jsonb_build_object('allowed',true);
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create or replace function public.adventure_planning_capability(p_owner uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.adventure_planning_check(p_owner,p_command);
exception when others then
  if sqlerrm='FOCUS_LIMIT' then return '{"allowed":false,"reason":"每组最多聚焦 3 个目标"}'::jsonb; end if;
  raise;
end $$;
revoke execute on function public.adventure_planning_capability(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.adventure_planning_capability(uuid,jsonb) to service_role;

create or replace function public.adventure_goal_view(p_owner uuid,p_goal uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',g.id,'title',g.title,'standards',g.standards,
        'mainlineId',m.id,'mainlineName',m.name,'independent',m.kind = 'independent','focused',g.focused,'sortOrder',g.sort_order,'createdAt',g.created_at,'status',g.status,'terminatedAt',g.terminated_at,
        'achievement',(select jsonb_build_object('id',e.id,'occurredOn',e.occurred_on,'reflection',e.snapshot->>'reflection','reward',jsonb_build_object('amount',e.amount,'calculation',e.calculation)) from public.adventure_events e where e.owner_id=g.owner_id and e.goal_id=g.id and e.kind='goal_achieved'),
        'progress',(select jsonb_build_object('completed',count(*) filter(where t.status='completed'),'total',count(*),
          'ratio',case when count(*)=0 then null else (count(*) filter(where t.status='completed'))::numeric/count(*) end)
          from public.adventure_tasks t where t.owner_id=g.owner_id and t.goal_id=g.id and t.deleted_at is null and t.status in ('pending','completed')),
        'capabilities',jsonb_build_object('edit',v_edit,'focus',case when (v_edit->>'allowed')::boolean then public.adventure_planning_capability(p_owner,jsonb_build_object('type','focusGoal','id',g.id,'focused',not g.focused)) else v_edit end,
          'reorder',v_edit,
          'moveUp',jsonb_build_object('allowed',(v_edit->>'allowed')::boolean and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.mainline_id=g.mainline_id and n.kind='real' and n.status='active' and n.focused=g.focused and (n.sort_order,n.id)<(g.sort_order,g.id))),
          'moveDown',jsonb_build_object('allowed',(v_edit->>'allowed')::boolean and exists(select 1 from public.adventure_goals n where n.owner_id=g.owner_id and n.mainline_id=g.mainline_id and n.kind='real' and n.status='active' and n.focused=g.focused and (n.sort_order,n.id)>(g.sort_order,g.id))),
          'migrate',v_edit,
          'achieve',v_edit,'end',public.adventure_lifecycle_capability(p_owner,jsonb_build_object('type','endGoal','id',g.id),(clock_timestamp() at time zone 'Asia/Shanghai')::date),'createTask',v_edit))
  from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id)=(g.owner_id,g.mainline_id)
    cross join lateral (select case when g.status='active' and m.status='active' then '{"allowed":true}'::jsonb
      else '{"allowed":false,"reason":"目标或主线已进入终态，只能查看"}'::jsonb end v_edit,
      '{"allowed":false,"reason":"此操作尚未交付"}'::jsonb v_later) capabilities
  where g.owner_id=p_owner and g.id=p_goal and g.kind='real';
$$;
revoke execute on function public.adventure_goal_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.adventure_goal_view(uuid,uuid) to service_role;

create or replace function public.adventure_planning_read(p_owner uuid, p_page integer default 1, p_page_size integer default 20, p_include_terminal boolean default false,p_mainline_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_account public.adventure_accounts;
  v_result jsonb;
  v_later jsonb := '{"allowed":false,"reason":"此操作尚未交付"}';
  v_edit jsonb := '{"allowed":true}';
  v_mainline jsonb;
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not between 1 and 50 then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id = p_owner for share;
  if p_include_terminal is null then raise exception 'INVALID_COMMAND'; end if;
  if p_mainline_id is not null then
    select jsonb_build_object('id',id,'name',name,'status',status,'endedAt',ended_at,
      'capabilities',jsonb_build_object('rename',case when status='active' then v_edit else '{"allowed":false,"reason":"主线已结束，只能查看"}'::jsonb end,
        'end',public.adventure_lifecycle_capability(p_owner,jsonb_build_object('type','endMainline','id',id),(clock_timestamp() at time zone 'Asia/Shanghai')::date)))
    into v_mainline from public.adventure_mainlines where owner_id=p_owner and id=p_mainline_id and kind='normal';
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  if v_account.total_xp <> (select coalesce(sum(amount),0) from public.adventure_events
    where owner_id = p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
    then raise exception 'INCONSISTENT_REWARDS'; end if;
  select jsonb_build_object(
    'version',v_account.revision, 'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
    'page',p_page, 'pageSize',p_page_size,'mainlineDetail',v_mainline,
    'totalGoals',(select count(*) from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id) = (g.owner_id,g.mainline_id)
      where g.owner_id = p_owner and g.kind = 'real'
        and (p_mainline_id is null or m.id=p_mainline_id)
        and (p_mainline_id is not null or (g.status = 'active' and m.status = 'active') or p_include_terminal)),
    'mainlines',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'endedAt',ended_at,
      'capabilities',jsonb_build_object('rename',case when status='active' then v_edit else '{"allowed":false,"reason":"主线已结束，只能查看"}'::jsonb end,
        'end',public.adventure_lifecycle_capability(p_owner,jsonb_build_object('type','endMainline','id',id),(clock_timestamp() at time zone 'Asia/Shanghai')::date)))
      order by case when status='active' then 0 else 1 end,
        case when status='active' then created_at end,case when status='ended' then ended_at end desc,id)
      from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and (status='active' or p_include_terminal)),'[]'),
    'goals',coalesce((select jsonb_agg(item order by main_created,main_id,terminal_rank,focused_rank desc,sort_rank,terminated_at desc,id) from (
      select g.id,g.focused,g.sort_order,m.created_at main_created,m.id main_id,g.terminated_at,
        case when g.status='active' then 0 else 1 end terminal_rank,
        case when g.status='active' then g.focused else false end focused_rank,
        case when g.status='active' then g.sort_order else null end sort_rank,
        public.adventure_goal_view(p_owner,g.id) item
      from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id) = (g.owner_id,g.mainline_id)
      where g.owner_id = p_owner and g.kind = 'real'
        and (p_mainline_id is null or m.id=p_mainline_id)
        and (p_mainline_id is not null or (g.status = 'active' and m.status = 'active') or p_include_terminal)
      order by m.created_at,m.id,case when g.status='active' then 0 else 1 end,
        case when g.status='active' then g.focused else false end desc,
        case when g.status='active' then g.sort_order else 0 end,
        case when g.status<>'active' then g.terminated_at else null end desc,g.id
      limit p_page_size offset (p_page::bigint-1)*p_page_size
    ) goals),'[]'),
    'destinations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by created_at,id)
        from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active'),'[]'),
    'growth',public.adventure_growth(p_owner),
    'capabilities',jsonb_build_object(
      'createMainline',case when (select count(*) from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active') < 5
        then v_edit else '{"allowed":false,"reason":"最多保留 5 条在用主线"}'::jsonb end,
      'createGoal',v_edit,'createTask',v_later,'growth',v_later,'focus',v_edit,'progress',v_edit),
    'limits',jsonb_build_object('name',200,'standard',4000,'standards',50)
  ) into v_result;
  if octet_length(v_result::text) > 1000000 then raise exception 'CAPACITY_REACHED'; end if;
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
  if p_command->>'type' in ('endGoal','endMainline','endTask','deleteTask') then
    if p_command->>'type' in ('endTask','deleteTask') then
      v_preview:=public.adventure_task_impact(p_owner,p_command,v_today)
        || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
          'message',case when p_command->>'type'='endTask' then '结束后不可恢复，不会获得奖励；已有完成记录和经验保持不变。' else '删除后任务将从规划中移除，数据库保留逻辑删除记录；误建资格不会恢复。' end);
    else
      v_preview:=public.adventure_lifecycle_impact(p_owner,p_command,v_today)
      || jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,
        'message',case when p_command->>'type'='endGoal' then '结束目标后不可恢复，全部待完成任务将停止；已有完成记录和经验保持不变。'
          else '结束主线后不可恢复，进行中目标及待完成任务将停止；已有达成结果、完成记录和经验保持不变。' end);
    end if;
    if octet_length(v_preview::text)>900000 then raise exception 'CAPACITY_REACHED'; end if;
    return v_preview;
  end if;
  if p_command->>'type' in ('createTask','editTask','completeTask','cancelTaskCompletion','migrateTask','endTask','deleteTask') then
    perform public.adventure_task_check(p_owner,p_command,v_today);
  else perform public.adventure_planning_check(p_owner,p_command); end if;
  if p_command->>'type'='achieveGoal' then
    select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
    v_plan:=public.adventure_goal_reward(p_owner,v_goal.id,1);
    v_count:=(v_plan->'reward'->'calculation'->>'count')::bigint;
    v_preview:=jsonb_build_object('version',v_revision,'today',v_today,'allowed',true,'requiresConfirmation',true,'operation','achieveGoal',
      'goalId',v_goal.id,'title',v_goal.title,'standards',v_goal.standards,
      'message','达成后不可撤销，下属任务将停止并只读。需要继续的任务请先迁出。',
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

create or replace function public.adventure_planning_command(p_owner uuid, p_request_id text, p_expected_version bigint, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_account public.adventure_accounts;
  v_prior public.adventure_events;
  v_main public.adventure_mainlines;
  v_goal public.adventure_goals;
  v_hash text := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  v_type text := p_command->>'type';
  v_kind text;
  v_entity uuid;
  v_main_id uuid;
  v_goal_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz;
  v_order bigint;
  v_result jsonb;
begin
  if p_owner is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,128}$'
    or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    or p_command is null or jsonb_typeof(p_command) is distinct from 'object'
    then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id = p_owner for update;
  select * into v_prior from public.adventure_events where owner_id = p_owner and request_id = p_request_id;
  if found then
    if v_prior.command_hash <> v_hash then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('version',v_prior.applied_revision,'result',v_prior.snapshot->'result');
  end if;
  if v_account.revision <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if v_account.revision >= 9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
  v_now := clock_timestamp();
  if v_type in ('endGoal','endMainline') then
    return public.adventure_lifecycle_apply(p_owner,p_request_id,v_account.revision,p_command,v_now);
  end if;
  if v_type in ('createTask','editTask','completeTask','cancelTaskCompletion','migrateTask','endTask','deleteTask') then
    return public.adventure_task_apply(p_owner,p_request_id,v_account.revision,p_command,v_now);
  end if;
  if v_type='achieveGoal' then
    return public.adventure_goal_apply(p_owner,p_request_id,v_account.revision,p_command,v_now);
  end if;
  perform public.adventure_planning_check(p_owner,p_command);
  case v_type
    when 'createMainline' then
      insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at)
        values(p_owner,'normal',btrim(p_command->>'name'),v_now,v_now) returning * into v_main;
      v_entity := v_main.id; v_main_id := v_main.id; v_kind := 'mainline_created';
      v_after := to_jsonb(v_main) - 'owner_id';
    when 'renameMainline' then
      select * into strict v_main from public.adventure_mainlines where owner_id = p_owner and id = (p_command->>'id')::uuid;
      v_before := to_jsonb(v_main) - 'owner_id';
      update public.adventure_mainlines set name = btrim(p_command->>'name'), updated_at = v_now
        where owner_id = p_owner and id = v_main.id returning * into v_main;
      v_entity := v_main.id; v_main_id := v_main.id; v_kind := 'mainline_updated';
      v_after := to_jsonb(v_main) - 'owner_id';
    when 'createGoal' then
      if p_command->>'destination' in ('','independent') then
        select * into v_main from public.adventure_mainlines where owner_id = p_owner and kind = 'independent';
        if not found then
          insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at)
            values(p_owner,'independent','独立区',v_now,v_now) returning * into v_main;
        end if;
        if not exists(select 1 from public.adventure_goals where owner_id = p_owner and mainline_id = v_main.id and kind = 'inbox') then
          insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
            values(p_owner,v_main.id,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]'::jsonb,v_now,v_now);
        end if;
      else
        select * into strict v_main from public.adventure_mainlines where owner_id = p_owner and id = (p_command->>'destination')::uuid;
      end if;
      select coalesce(max(sort_order),-1)+1 into v_order from public.adventure_goals
        where owner_id = p_owner and mainline_id = v_main.id and kind = 'real';
      if v_order > 9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
      insert into public.adventure_goals(owner_id,mainline_id,title,standards,sort_order,created_at,updated_at)
        values(p_owner,v_main.id,btrim(p_command->>'title'),p_command->'standards',v_order,v_now,v_now) returning * into v_goal;
      v_entity := v_goal.id; v_main_id := v_main.id; v_goal_id := v_goal.id; v_kind := 'goal_created';
      v_after := to_jsonb(v_goal) - 'owner_id';
    when 'focusGoal' then
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=to_jsonb(v_goal)-'owner_id';
      update public.adventure_goals set focused=(p_command->>'focused')::boolean,updated_at=v_now where owner_id=p_owner and id=v_goal.id returning * into v_goal;
      v_entity:=v_goal.id;v_main_id:=v_goal.mainline_id;v_goal_id:=v_goal.id;v_kind:='goal_focused';v_after:=to_jsonb(v_goal)-'owner_id';
    when 'reorderGoals' then
      select * into strict v_main from public.adventure_mainlines where owner_id=p_owner and id=(p_command->>'mainlineId')::uuid;
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=(p_command->>'id')::uuid;
      v_before:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active'));
      with ordered as (
        select id,row_number() over(order by sort_order,id) as ord
        from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active' and focused=v_goal.focused
      ), source as (
        select ord from ordered where id=v_goal.id
      ), target as (
        select s.ord old_ord,case when p_command ? 'targetId' then
          (select ord from ordered where id=(p_command->>'targetId')::uuid)
          when p_command->>'direction'='up' then greatest(s.ord-1,1)
          else least(s.ord+1,(select max(ord) from ordered)) end new_ord from source s
      ), moved as (
        select o.id,case when o.id=v_goal.id then t.new_ord
          when t.new_ord<t.old_ord and o.ord>=t.new_ord and o.ord<t.old_ord then o.ord+1
          when t.new_ord>t.old_ord and o.ord<=t.new_ord and o.ord>t.old_ord then o.ord-1
          else o.ord end ord from ordered o cross join target t
      )
      update public.adventure_goals g set sort_order=m.ord,updated_at=v_now
        from moved m where g.owner_id=p_owner and g.id=m.id;
      select * into strict v_goal from public.adventure_goals where owner_id=p_owner and id=v_goal.id;
      v_entity:=v_goal.id;v_main_id:=v_main.id;v_goal_id:=v_goal.id;v_kind:='goal_reordered';v_after:=jsonb_build_object('goalIds',(select jsonb_agg(id order by sort_order,id) from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real' and status='active'));
    when 'editGoal', 'migrateGoal' then
      select * into strict v_goal from public.adventure_goals where owner_id = p_owner and id = (p_command->>'id')::uuid;
      v_before := to_jsonb(v_goal) - 'owner_id';
      if p_command->>'destination' in ('','independent') then
        select * into v_main from public.adventure_mainlines where owner_id = p_owner and kind = 'independent';
        if not found then
          insert into public.adventure_mainlines(owner_id,kind,name,created_at,updated_at)
            values(p_owner,'independent','独立区',v_now,v_now) returning * into v_main;
        end if;
        if not exists(select 1 from public.adventure_goals where owner_id = p_owner and mainline_id = v_main.id and kind = 'inbox') then
          insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
            values(p_owner,v_main.id,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]'::jsonb,v_now,v_now);
        end if;
      else
        select * into strict v_main from public.adventure_mainlines where owner_id = p_owner and id = (p_command->>'destination')::uuid;
      end if;
      v_order:=v_goal.sort_order;
      if v_main.id<>v_goal.mainline_id then
        select coalesce(max(sort_order),-1)+1 into v_order from public.adventure_goals where owner_id=p_owner and mainline_id=v_main.id and kind='real';
        if v_order>9007199254740991 then raise exception 'CAPACITY_REACHED'; end if;
      end if;
      update public.adventure_goals set sort_order=v_order,title = coalesce(btrim(p_command->>'title'),v_goal.title), standards = coalesce(p_command->'standards',v_goal.standards),
        mainline_id = v_main.id, updated_at = v_now
        where owner_id = p_owner and id = v_goal.id returning * into v_goal;
      v_entity := v_goal.id; v_main_id := v_main.id; v_goal_id := v_goal.id; v_kind := case when (v_before->>'mainline_id')::uuid<>v_main.id then 'goal_migrated' else 'goal_updated' end;
      v_after := to_jsonb(v_goal) - 'owner_id';
  end case;
  v_result := jsonb_build_object('entityId',v_entity,'message',case when v_type in ('createMainline','createGoal') then '已创建' else '已保存' end);
  insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,snapshot,created_at)
    values(p_owner,gen_random_uuid(),v_kind,case when v_goal_id is null then 'mainline' else 'goal' end,
      v_entity,v_main_id,v_goal_id,v_now,(v_now at time zone 'Asia/Shanghai')::date,p_owner,
      p_request_id,v_hash,v_type,v_account.revision+1,jsonb_build_object('before',v_before,'after',v_after,'origin',case when v_kind='goal_migrated' then (select jsonb_build_object('mainlineId',id,'mainlineName',name) from public.adventure_mainlines where owner_id=p_owner and id=(v_before->>'mainline_id')::uuid) end,'result',v_result),v_now);
  if v_account.total_xp <> (select coalesce(sum(amount),0) from public.adventure_events
    where owner_id = p_owner and kind in ('task_completed','goal_achieved') and invalidated_at is null)
    then raise exception 'INCONSISTENT_REWARDS'; end if;
  update public.adventure_accounts set revision = revision+1, updated_at = v_now where owner_id = p_owner;
  return jsonb_build_object('version',v_account.revision+1,'result',v_result);
end $$;

revoke execute on function public.adventure_planning_check(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.adventure_planning_read(uuid,integer,integer,boolean,uuid) from public,anon,authenticated;
revoke execute on function public.adventure_planning_preview(uuid,bigint,jsonb) from public,anon,authenticated;
revoke execute on function public.adventure_planning_command(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.adventure_planning_check(uuid,jsonb),
  public.adventure_planning_read(uuid,integer,integer,boolean,uuid),
  public.adventure_planning_preview(uuid,bigint,jsonb),
  public.adventure_planning_command(uuid,text,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
