-- #204: the deployed Worker permanently rejects legacy MCP before authentication.
-- Remove only its empty binding store and resolver; preserve all OAuth/business data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $$
begin
  if to_regclass('public.agent_identity_bindings') is not null then
    lock table public.agent_identity_bindings in access exclusive mode;
    if exists (select from public.agent_identity_bindings) then
      raise exception 'LEGACY_BINDINGS_NOT_EMPTY';
    end if;
  end if;
  -- SQL/PLpgSQL string bodies need an explicit check: PostgreSQL may not track
  -- their relation references as dependencies for DROP ... RESTRICT.
  if exists (
    select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and p.oid <> coalesce(to_regprocedure('public.agent_resolve_owner(text)')::oid, 0::oid)
       and p.prosrc ~ '\m(agent_identity_bindings|agent_resolve_owner)\M'
  ) then
    raise exception 'LEGACY_BINDINGS_STILL_REFERENCED';
  end if;
end $$;

drop function if exists public.agent_resolve_owner(text) restrict;
drop table if exists public.agent_identity_bindings restrict;
notify pgrst, 'reload schema';
commit;
