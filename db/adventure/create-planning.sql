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
    'task_completed','task_completion_cancelled','reward_task','reward_goal'
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
  reward_task_id uuid,
  reward_goal_id uuid,
  calculation jsonb check (jsonb_typeof(calculation) = 'object'),
  snapshot jsonb check (jsonb_typeof(snapshot) = 'object'),
  invalidated_at timestamptz,
  invalidated_by_event_id uuid,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,mainline_id) references public.adventure_mainlines(owner_id,id),
  foreign key(owner_id,goal_id) references public.adventure_goals(owner_id,id),
  foreign key(owner_id,task_id) references public.adventure_tasks(owner_id,id),
  foreign key(owner_id,reward_task_id) references public.adventure_tasks(owner_id,id),
  foreign key(owner_id,reward_goal_id) references public.adventure_goals(owner_id,id),
  foreign key(owner_id,invalidated_by_event_id) references public.adventure_events(owner_id,id),
  check ((request_id is null and command_hash is null and command_type is null and applied_revision is null)
    or (request_id is not null and command_hash is not null
      and request_id ~ '^[A-Za-z0-9_-]{8,128}$' and command_hash ~ '^[a-f0-9]{64}$'
      and command_type is not null and applied_revision is not null)),
  check ((kind in ('reward_task','reward_goal') and amount is not null and calculation is not null)
    or (kind not in ('reward_task','reward_goal') and amount is null and calculation is null)),
  check ((invalidated_at is null) = (invalidated_by_event_id is null))
);
create unique index adventure_event_request on public.adventure_events(owner_id,request_id) where request_id is not null;
create index adventure_event_group on public.adventure_events(owner_id,event_group_id,id);
create index adventure_event_task on public.adventure_events(owner_id,task_id);
create index adventure_event_kind_time on public.adventure_events(owner_id,kind,occurred_at,id);
create index adventure_event_mainline on public.adventure_events(owner_id,mainline_id);
create index adventure_event_goal on public.adventure_events(owner_id,goal_id);
create index adventure_event_reward_task on public.adventure_events(owner_id,reward_task_id);
create index adventure_event_reward_goal on public.adventure_events(owner_id,reward_goal_id);
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

-- Shared final validation, called only while the account lock is held.
create function public.adventure_planning_check(p_owner uuid, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_type text := p_command->>'type';
  v_keys text[];
  v_main public.adventure_mainlines;
  v_goal public.adventure_goals;
begin
  if p_owner is null or jsonb_typeof(p_command) is distinct from 'object'
    or pg_column_size(p_command) > 32768 then raise exception 'INVALID_COMMAND'; end if;
  case v_type
    when 'createMainline' then v_keys := array['type','name'];
    when 'renameMainline' then v_keys := array['type','id','name'];
    when 'createGoal' then v_keys := array['type','destination','title','standards'];
    when 'editGoal' then v_keys := array['type','id','destination','title','standards'];
    else raise exception 'INVALID_COMMAND';
  end case;
  if p_command - v_keys <> '{}'::jsonb or not (p_command ?& v_keys)
    then raise exception 'INVALID_COMMAND'; end if;
  if v_type in ('createMainline','renameMainline') then
    if jsonb_typeof(p_command->'name') is distinct from 'string'
      or length(btrim(p_command->>'name')) not between 1 and 200 then raise exception 'INVALID_COMMAND'; end if;
  else
    if jsonb_typeof(p_command->'title') is distinct from 'string'
      or length(btrim(p_command->>'title')) not between 1 and 200
      or jsonb_typeof(p_command->'standards') is distinct from 'array'
      or jsonb_array_length(p_command->'standards') not between 1 and 50
      or exists(select 1 from jsonb_array_elements(p_command->'standards') item
        where jsonb_typeof(item) is distinct from 'string'
          or length(btrim(item #>> '{}')) not between 1 and 4000)
      then raise exception 'INVALID_COMMAND'; end if;
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
  if v_type = 'editGoal' and coalesce(p_command->>'destination','') <> ''
    and p_command->>'destination' <> 'independent' then
    select * into v_main from public.adventure_mainlines where owner_id = p_owner
      and id = (p_command->>'destination')::uuid and kind = 'normal';
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_main.status <> 'active' then raise exception 'READ_ONLY'; end if;
  end if;
  return jsonb_build_object('allowed',true);
exception when invalid_text_representation then raise exception 'INVALID_COMMAND';
end $$;

create function public.adventure_planning_read(p_owner uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_account public.adventure_accounts;
  v_result jsonb;
  v_level bigint;
  v_progress bigint;
  v_later jsonb := '{"allowed":false,"reason":"此操作尚未交付"}';
  v_edit jsonb := '{"allowed":true}';
begin
  if p_owner is null or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not between 1 and 50 then raise exception 'INVALID_COMMAND'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into strict v_account from public.adventure_accounts where owner_id = p_owner for share;
  if v_account.total_xp <> (select coalesce(sum(amount),0) from public.adventure_events
    where owner_id = p_owner and kind in ('reward_task','reward_goal') and invalidated_at is null)
    then raise exception 'INCONSISTENT_REWARDS'; end if;
  v_level := floor((sqrt(1225::numeric + 40::numeric * v_account.total_xp) - 35) / 10)::bigint + 1;
  v_progress := v_account.total_xp - (v_level-1) * (5*(v_level-1)+35) / 2;
  select jsonb_build_object(
    'version',v_account.revision, 'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
    'page',p_page, 'pageSize',p_page_size,
    'totalGoals',(select count(*) from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id) = (g.owner_id,g.mainline_id)
      where g.owner_id = p_owner and g.kind = 'real' and g.status = 'active' and m.status = 'active'),
    'mainlines',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,
      'capabilities',jsonb_build_object('rename',v_edit,'end',v_later)) order by created_at,id)
      from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active'),'[]'),
    'goals',coalesce((select jsonb_agg(item order by sort_order,id) from (
      select g.id,g.sort_order,jsonb_build_object('id',g.id,'title',g.title,'standards',g.standards,
        'mainlineId',m.id,'mainlineName',m.name,'independent',m.kind = 'independent','createdAt',g.created_at,
        'capabilities',jsonb_build_object('edit',v_edit,'focus',v_later,'reorder',v_later,'migrate',v_later,
          'achieve',v_later,'end',v_later,'createTask',v_later)) item
      from public.adventure_goals g join public.adventure_mainlines m on (m.owner_id,m.id) = (g.owner_id,g.mainline_id)
      where g.owner_id = p_owner and g.kind = 'real' and g.status = 'active' and m.status = 'active'
      order by g.sort_order,g.id limit p_page_size offset (p_page::bigint-1)*p_page_size
    ) goals),'[]'),
    'destinations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by created_at,id)
        from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active'),'[]'),
    'growth',jsonb_build_object('level',v_level,'totalXp',v_account.total_xp,'progress',v_progress,
      'needed',20+5*(v_level-1),'remaining',20+5*(v_level-1)-v_progress,
      'actions',(select count(*) from public.adventure_events where owner_id = p_owner and kind = 'task_completed' and invalidated_at is null),
      'achievedGoals',(select count(*) from public.adventure_goals where owner_id = p_owner and kind = 'real' and status = 'achieved')),
    'capabilities',jsonb_build_object(
      'createMainline',case when (select count(*) from public.adventure_mainlines where owner_id = p_owner and kind = 'normal' and status = 'active') < 5
        then v_edit else '{"allowed":false,"reason":"最多保留 5 条在用主线"}'::jsonb end,
      'createGoal',v_edit,'createTask',v_later,'growth',v_later,'focus',v_later,'progress',v_later),
    'limits',jsonb_build_object('name',200,'standard',4000,'standards',50)
  ) into v_result;
  if octet_length(v_result::text) > 1000000 then raise exception 'CAPACITY_REACHED'; end if;
  return v_result;
end $$;

create function public.adventure_planning_preview(p_owner uuid, p_expected_version bigint, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  v_revision bigint;
begin
  if p_owner is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    then raise exception 'INVALID_COMMAND'; end if;
  select revision into v_revision from public.adventure_accounts where owner_id = p_owner for share;
  v_revision := coalesce(v_revision,0);
  if v_revision <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  perform public.adventure_planning_check(p_owner,p_command);
  return jsonb_build_object('version',v_revision,'today',(clock_timestamp() at time zone 'Asia/Shanghai')::date,
    'allowed',true,'requiresConfirmation',false,'message','保存后更新规划，不改变目标状态或经验');
end $$;

create function public.adventure_planning_command(p_owner uuid, p_request_id text, p_expected_version bigint, p_command jsonb)
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
    when 'editGoal' then
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
      update public.adventure_goals set title = btrim(p_command->>'title'), standards = p_command->'standards',
        mainline_id = v_main.id, updated_at = v_now
        where owner_id = p_owner and id = v_goal.id returning * into v_goal;
      v_entity := v_goal.id; v_main_id := v_main.id; v_goal_id := v_goal.id; v_kind := 'goal_updated';
      v_after := to_jsonb(v_goal) - 'owner_id';
  end case;
  v_result := jsonb_build_object('entityId',v_entity,'message',case when v_type in ('createMainline','createGoal') then '已创建' else '已保存' end);
  insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,mainline_id,goal_id,
    occurred_at,occurred_on,actor_owner_id,request_id,command_hash,command_type,applied_revision,snapshot,created_at)
    values(p_owner,gen_random_uuid(),v_kind,case when v_goal_id is null then 'mainline' else 'goal' end,
      v_entity,v_main_id,v_goal_id,v_now,(v_now at time zone 'Asia/Shanghai')::date,p_owner,
      p_request_id,v_hash,v_type,v_account.revision+1,jsonb_build_object('before',v_before,'after',v_after,'result',v_result),v_now);
  if v_account.total_xp <> (select coalesce(sum(amount),0) from public.adventure_events
    where owner_id = p_owner and kind in ('reward_task','reward_goal') and invalidated_at is null)
    then raise exception 'INCONSISTENT_REWARDS'; end if;
  update public.adventure_accounts set revision = revision+1, updated_at = v_now where owner_id = p_owner;
  return jsonb_build_object('version',v_account.revision+1,'result',v_result);
end $$;

revoke execute on function public.adventure_planning_check(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.adventure_planning_read(uuid,integer,integer) from public,anon,authenticated;
revoke execute on function public.adventure_planning_preview(uuid,bigint,jsonb) from public,anon,authenticated;
revoke execute on function public.adventure_planning_command(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.adventure_planning_check(uuid,jsonb),
  public.adventure_planning_read(uuid,integer,integer),
  public.adventure_planning_preview(uuid,bigint,jsonb),
  public.adventure_planning_command(uuid,text,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
