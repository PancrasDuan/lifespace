-- Replace only goal completion standards and planning RPCs; preserve all current facts.
alter table public.adventure_goals add column standards jsonb;
update public.adventure_goals set standards = jsonb_build_array(standard) where standards is null;
alter table public.adventure_goals alter column standards set not null;
alter table public.adventure_goals add constraint adventure_goals_standards_shape check (jsonb_typeof(standards) = 'array' and jsonb_array_length(standards) between 1 and 50);
alter table public.adventure_goals drop column standard;
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

create or replace function public.adventure_planning_read(p_owner uuid, p_page integer default 1, p_page_size integer default 20)
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

create or replace function public.adventure_planning_preview(p_owner uuid, p_expected_version bigint, p_command jsonb)
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
          insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
            values(p_owner,v_main.id,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]'::jsonb,v_now,v_now);
        end if;
      else
        select * into strict v_main from public.adventure_mainlines where owner_id = p_owner
          and id = case when coalesce(p_command->>'destination','') = '' then
            (select id from public.adventure_mainlines where owner_id = p_owner and kind = 'independent')
            else (p_command->>'destination')::uuid end;
      end if;
      if v_main.kind = 'independent' and not exists(
        select 1 from public.adventure_goals where owner_id = p_owner and mainline_id = v_main.id and kind = 'inbox'
      ) then
        insert into public.adventure_goals(owner_id,mainline_id,kind,title,standards,created_at,updated_at)
          values(p_owner,v_main.id,'inbox','独立任务','["系统收纳目标，仅承接独立任务。"]'::jsonb,v_now,v_now);
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
