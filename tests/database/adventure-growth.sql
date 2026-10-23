-- Only the runner's temporary database; all probe data rolls back.
begin;
set local role service_role;
do $$
declare o uuid:=gen_random_uuid(); page jsonb; r jsonb; id uuid; v bigint; e bigint;
begin
  page:=public.adventure_growth_read(o);
  if page->>'version'<>'0' or page->>'total'<>'0' or jsonb_array_length(page->'growth'->'achievements')<>7
    or exists(select 1 from public.adventure_accounts where owner_id=o) then raise exception 'Growth read mutated empty account'; end if;
  r:=public.adventure_planning_command(o,'growth-probe-create',0,jsonb_build_object('type','createTask','title','SQL frozen reward','description','frozen','plannedOn',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'destination',''));
  id:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'growth-probe-complete',1,jsonb_build_object('type','completeTask','id',id));
  id:=(r->'result'->>'completionId')::uuid;
  select revision into v from public.adventure_accounts where owner_id=o;
  select count(*) into e from public.adventure_events where owner_id=o;
  page:=public.adventure_growth_read(o);
  if page->>'version'<>'2' or page->>'total'<>'1' or page->'items'->0->>'id'<>id::text
    or page->'growth'->>'totalXp'<>'1' then raise exception 'Growth not projected from event'; end if;
  if public.adventure_reward_source(o,id)->>'description'<>'frozen'
    or (select revision from public.adventure_accounts where owner_id=o)<>v
    or (select count(*) from public.adventure_events where owner_id=o)<>e then raise exception 'Source read mutated facts'; end if;
  update public.adventure_accounts set total_xp=2 where owner_id=o;
  begin
    perform public.adventure_growth_read(o);
    raise exception 'Growth accepted inconsistent XP';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
end $$;
reset role;
do $$
declare role_name text; function_name text;
begin
  foreach function_name in array array['adventure_reward_view(uuid,uuid)','adventure_growth_read(uuid,bigint,uuid)','adventure_reward_source(uuid,uuid,integer,bigint)'] loop
    foreach role_name in array array['anon','authenticated'] loop
      if has_function_privilege(role_name,'public.'||function_name,'EXECUTE') then raise exception 'Growth RPC exposed: %',function_name; end if;
    end loop;
    if not has_function_privilege('service_role','public.'||function_name,'EXECUTE') then raise exception 'Worker growth RPC missing'; end if;
    if (select prosecdef from pg_proc where oid=('public.'||function_name)::regprocedure)
      or not exists(select 1 from pg_proc,unnest(proconfig) c where oid=('public.'||function_name)::regprocedure and c='search_path=""') then raise exception 'Unsafe growth function context'; end if;
  end loop;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='adventure_reward_journal'
    and indexdef like '%owner_id, applied_revision DESC, id DESC%' and indexdef like '%invalidated_at IS NULL%') then raise exception 'Missing bounded reward index'; end if;
end $$;
rollback;
