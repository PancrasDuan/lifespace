-- Additive cutover migration; apply after all existing domain migrations.
-- No password is embedded. Provision a random password out of band before use.
-- Old service_role RPC permissions remain available for coordinated rollback.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ begin
  if not exists(select from pg_roles where rolname='lifespace_worker') then
    create role lifespace_worker login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists(select from pg_roles where rolname='lifespace_worker'
    and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolreplication or not rolcanlogin))
    or exists(select from pg_auth_members where member='lifespace_worker'::regrole)
    then raise exception 'WORKER_ROLE_UNSAFE'; end if;
end $$;
grant connect on database postgres to lifespace_worker;
grant usage on schema public to lifespace_worker;

do $$ declare t text; begin
  foreach t in array array['adventure_accounts','adventure_mainlines','adventure_goals','adventure_tasks','adventure_events',
    'ledger_owner_revision','ledger_accounts','ledger_entries','ledger_balance_adjustments'] loop
    if not (select relrowsecurity from pg_class where oid=format('public.%I',t)::regclass) then
      raise exception 'WORKER_RLS_REQUIRED';
    end if;
    execute format('revoke all on public.%I from lifespace_worker',t);
    if t='ledger_balance_adjustments' then
      execute format('grant insert on public.%I to lifespace_worker',t);
    else
      execute format('grant select,insert on public.%I to lifespace_worker',t);
    end if;
    execute format('drop policy if exists worker_owner on public.%I',t);
    execute format('create policy worker_owner on public.%I to lifespace_worker
      using (owner_id = nullif(current_setting(''lifespace.owner_id'',true),'''')::uuid)
      with check (owner_id = nullif(current_setting(''lifespace.owner_id'',true),'''')::uuid)',t);
  end loop;
end $$;
grant update(revision,total_xp,updated_at) on public.adventure_accounts to lifespace_worker;
grant update(name,status,ended_at,updated_at) on public.adventure_mainlines to lifespace_worker;
grant update(mainline_id,title,standards,status,focused,sort_order,terminated_at,termination_cause,
  achieved_at,achieved_on,attainment_coefficient,attainment_reflection,attainment_action_count,
  attainment_action_ids,attainment_snapshot,updated_at) on public.adventure_goals to lifespace_worker;
grant update(goal_id,title,description,planned_on,status,completed_at,completed_on,ended_at,end_cause,deleted_at,updated_at)
  on public.adventure_tasks to lifespace_worker;
grant update(snapshot,invalidated_at,invalidated_by_event_id) on public.adventure_events to lifespace_worker;
grant update(revision,updated_at) on public.ledger_owner_revision to lifespace_worker;
grant update(name,balance_cents,update_requests,updated_at) on public.ledger_accounts to lifespace_worker;
grant update(deleted_at) on public.ledger_entries to lifespace_worker;

-- Binding resolution is a separate read-only capability, before owner is known.
grant select(client_id,owner_id,enabled) on public.agent_identity_bindings to lifespace_worker;
drop policy if exists worker_enabled_binding on public.agent_identity_bindings;
create policy worker_enabled_binding on public.agent_identity_bindings for select to lifespace_worker using(enabled);
-- The legacy shared homepage source is optional on existing installations.
-- Do not create or replace it, nor broaden existing end-user access.
do $$ begin
  if to_regclass('public.tasks') is not null then
    grant select(id,title,area,planned_at,due_at,status,is_deleted) on public.tasks to lifespace_worker;
    if (select relrowsecurity from pg_class where oid='public.tasks'::regclass) then
      execute 'drop policy if exists worker_home_tasks on public.tasks';
      execute 'create policy worker_home_tasks on public.tasks for select to lifespace_worker using (status=''todo'' and not is_deleted)';
    end if;
  end if;
end $$;

-- No access to Auth tables, service_role membership or legacy write entry points.
-- Remove inherited PUBLIC execution; preserve the existing service_role grants.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'adventure_%' or p.proname like 'ledger_%' or p.proname='agent_resolve_owner') loop
    execute format('revoke execute on function %s from public,anon,authenticated,lifespace_worker',f.signature);
  end loop;
end $$;
grant execute on function public.ledger_trim(text),public.ledger_entry_json(public.ledger_entries),public.ledger_account_json(public.ledger_accounts) to lifespace_worker;
-- Read projections and their invoker-only capability helpers. No write function
-- (including nested *_apply) or SECURITY DEFINER function is granted.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not p.prosecdef and p.proname like 'adventure_%'
      and p.proname not like '%_apply' and p.proname <> 'adventure_planning_command'
      and p.proname not like 'adventure_test_%' loop
    execute format('grant execute on function %s to lifespace_worker',f.signature);
  end loop;
end $$;
commit;
