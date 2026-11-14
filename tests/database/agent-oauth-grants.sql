-- Disposable PostgreSQL only: real constraints, privileges, and lifecycle.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000004'), ('00000000-0000-4000-8000-000000000005');
do $$
declare p regprocedure;
begin
  if not (select relrowsecurity from pg_class where oid='public.agent_oauth_grants'::regclass) then raise exception 'OAUTH_RLS_REQUIRED'; end if;
  if has_table_privilege('anon','public.agent_oauth_grants','SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('authenticated','public.agent_oauth_grants','SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('service_role','public.agent_oauth_grants','SELECT,INSERT,UPDATE,DELETE') then raise exception 'OAUTH_TABLE_EXPOSED'; end if;
  for p in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'agent_oauth_%' and proname <> 'agent_oauth_grant_json' loop
    if has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') or not has_function_privilege('service_role',p,'EXECUTE') then raise exception 'OAUTH_RPC_ACL'; end if;
  end loop;
end $$;
set local role service_role;
do $$
declare g uuid := '00000000-0000-4000-8000-000000000194'; a uuid := '00000000-0000-4000-8000-000000000004'; b uuid := '00000000-0000-4000-8000-000000000005'; r text := 'https://example.invalid/api/agent/mcp'; v jsonb;
begin
  v := public.agent_oauth_grant_create(g,a,'shared-client','Client',r,array['ledger:accounts:read'],repeat('a',64));
  if v->>'ownerId' <> a::text then raise exception 'OAUTH_OWNER'; end if;
  if public.agent_oauth_grant_check(g,b,'shared-client',r) <> 'null'::jsonb or
    public.agent_oauth_grant_check(g,a,'other-client',r) <> 'null'::jsonb or
    public.agent_oauth_grant_check(g,a,'shared-client',r||'/other') <> 'null'::jsonb then raise exception 'OAUTH_CROSS_BINDING'; end if;
  if public.agent_oauth_grant_check(g,a,'shared-client',r,'provider-one',true) = 'null'::jsonb or
    public.agent_oauth_grant_check(g,a,'shared-client',r,'provider-one',true) <> 'null'::jsonb or
    public.agent_oauth_grant_check(g,a,'shared-client',r,'provider-two',false) <> 'null'::jsonb then raise exception 'OAUTH_CODE_REPLAY'; end if;
  if public.agent_oauth_grant_revoke(g,b) <> 'null'::jsonb then raise exception 'OAUTH_CROSS_REVOKE'; end if;
  perform public.agent_oauth_grant_revoke(g,a);
  if public.agent_oauth_grant_check(g,a,'shared-client',r) <> 'null'::jsonb or
    public.agent_oauth_grant_check(g,a,'shared-client',r,'provider-one',false) <> 'null'::jsonb then raise exception 'OAUTH_REVOKE'; end if;
  begin
    perform public.agent_oauth_grant_create('00000000-0000-4000-8000-000000000195',a,'shared-client','Client',r,array['admin'],repeat('b',64));
    raise exception 'OAUTH_INVALID_SCOPE';
  exception when check_violation then null; end;
  begin
    perform public.agent_oauth_grant_create('00000000-0000-4000-8000-000000000195',a,'shared-client','Client',r,array['ledger:accounts:read'],repeat('a',64));
    raise exception 'OAUTH_CONSENT_REPLAY';
  exception when unique_violation then null; end;
end $$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000004';
do $$ begin if exists(select from public.agent_oauth_grants where owner_id='00000000-0000-4000-8000-000000000004') then raise exception 'OAUTH_DELETED_OWNER'; end if; end $$;
rollback;
-- Additional synthetic identity for HTTP multi-user tests; owner 7 is seeded by the runner.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000008');
