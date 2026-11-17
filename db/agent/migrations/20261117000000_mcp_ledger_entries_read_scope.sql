-- Forward-only OAuth grant constraint update for #231.
-- Does not change ledger tables, rows, RPC bodies, RLS, or token TTLs.
-- Apply before deploying the Worker that advertises ledger:entries:read.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
do $$
declare
  constraint_name text;
  removed integer := 0;
  scopes_attnum smallint;
begin
  if to_regclass('public.agent_oauth_grants') is null then
    raise exception 'AGENT_OAUTH_GRANTS_MISSING';
  end if;
  select attnum into scopes_attnum
    from pg_attribute
    where attrelid = 'public.agent_oauth_grants'::regclass
      and attname = 'scopes'
      and not attisdropped;
  if scopes_attnum is null then
    raise exception 'AGENT_OAUTH_SCOPES_COLUMN_MISSING';
  end if;

  -- The original inline CHECK was auto-named. Match the allowlist CHECK on the
  -- scopes column only; do not drop unrelated CHECKs that mention a scope name.
  for constraint_name in
    select conname from pg_constraint
      where conrelid = 'public.agent_oauth_grants'::regclass
        and contype = 'c'
        and conkey = array[scopes_attnum]
        and pg_get_constraintdef(oid) like '%cardinality(scopes)%'
        and pg_get_constraintdef(oid) like '%scopes <@%'
        and pg_get_constraintdef(oid) like '%ledger:accounts:read%'
        and pg_get_constraintdef(oid) like '%ledger:entries:create%'
        and pg_get_constraintdef(oid) like '%ledger:refunds:create%'
        and pg_get_constraintdef(oid) not like '%ledger:entries:read%'
  loop
    execute format('alter table public.agent_oauth_grants drop constraint %I', constraint_name);
    removed := removed + 1;
  end loop;
  if removed > 1 then
    raise exception 'AGENT_OAUTH_SCOPE_CHECK_DUPLICATED';
  end if;

  if removed = 0 and not exists (
    select 1 from pg_constraint
      where conrelid = 'public.agent_oauth_grants'::regclass
        and contype = 'c'
        and conname = 'agent_oauth_grants_scopes_check'
        and conkey = array[scopes_attnum]
        and pg_get_constraintdef(oid) like '%ledger:entries:read%'
  ) then
    raise exception 'AGENT_OAUTH_SCOPE_CHECK_MISSING';
  end if;

  if not exists (
    select 1 from pg_constraint
      where conrelid = 'public.agent_oauth_grants'::regclass
        and contype = 'c'
        and conname = 'agent_oauth_grants_scopes_check'
        and conkey = array[scopes_attnum]
        and pg_get_constraintdef(oid) like '%ledger:entries:read%'
  ) then
    execute $sql$
      alter table public.agent_oauth_grants add constraint agent_oauth_grants_scopes_check check (
        cardinality(scopes) between 1 and 4
        and scopes <@ array['ledger:accounts:read', 'ledger:entries:read', 'ledger:entries:create', 'ledger:refunds:create']::text[]
      )
    $sql$;
  end if;

  if exists (
    select 1 from pg_constraint
      where conrelid = 'public.agent_oauth_grants'::regclass
        and contype = 'c'
        and conkey = array[scopes_attnum]
        and pg_get_constraintdef(oid) like '%cardinality(scopes)%'
        and pg_get_constraintdef(oid) like '%scopes <@%'
        and pg_get_constraintdef(oid) like '%ledger:accounts:read%'
        and pg_get_constraintdef(oid) like '%ledger:entries:create%'
        and pg_get_constraintdef(oid) like '%ledger:refunds:create%'
        and pg_get_constraintdef(oid) not like '%ledger:entries:read%'
  ) then
    raise exception 'AGENT_OAUTH_OLD_SCOPE_CHECK_REMAINS';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
