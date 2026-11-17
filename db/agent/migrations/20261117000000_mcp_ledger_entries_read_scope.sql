-- Forward-only OAuth grant constraint update for #231.
-- Does not change ledger tables, rows, RPC bodies, RLS, or token TTLs.
-- Apply before deploying the Worker that advertises ledger:entries:read.
begin;
do $$
declare constraint_name text;
begin
  -- The original inline CHECK was auto-named; find it by definition instead of
  -- assuming a generated name, then replace it with the four-scope contract.
  for constraint_name in
    select conname from pg_constraint
      where conrelid = 'public.agent_oauth_grants'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%ledger:accounts:read%'
  loop
    execute format('alter table public.agent_oauth_grants drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.agent_oauth_grants add constraint agent_oauth_grants_scopes_check check (
  cardinality(scopes) between 1 and 4
  and scopes <@ array['ledger:accounts:read', 'ledger:entries:read', 'ledger:entries:create', 'ledger:refunds:create']::text[]
);
notify pgrst, 'reload schema';
commit;
