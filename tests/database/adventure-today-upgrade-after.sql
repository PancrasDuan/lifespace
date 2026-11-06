do $$
declare actual jsonb; legacy record; role_name text;
begin
  select jsonb_build_object(
    'accounts',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.adventure_accounts t),
    'mainlines',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_mainlines t),
    'goals',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_goals t),
    'tasks',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_tasks t),
    'events',(select jsonb_agg(to_jsonb(t) order by owner_id,id) from public.adventure_events t)) into actual;
  if actual is distinct from (select value from adventure_upgrade_snapshot) then raise exception 'Function upgrade changed business rows or historical rewards/receipts'; end if;
  select * into strict legacy from adventure_legacy_request;
  if public.adventure_planning_command(legacy.owner_id,'upgrade-legacy-ended',0,legacy.command)<>legacy.receipt then raise exception 'Retired endTask successful receipt no longer replays'; end if;
  if exists(select 1 from pg_class where relname like 'adventure_%' and relkind='r' and relnamespace='public'::regnamespace and not relrowsecurity) then raise exception 'Upgrade weakened RLS'; end if;
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name,'public.adventure_planning_command(uuid,text,bigint,jsonb)','EXECUTE') then raise exception 'Upgrade exposed business RPC'; end if;
  end loop;
end $$;
