-- Synthetic auth users and service-token identifiers; run only against a disposable database.
begin;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000004'), ('00000000-0000-4000-8000-000000000005');
insert into public.agent_identity_bindings (client_id, owner_id, enabled)
values ('synthetic-user-a.access', '00000000-0000-4000-8000-000000000004', true),
       ('synthetic-user-b.access', '00000000-0000-4000-8000-000000000005', true);
do $$
begin
  begin
    insert into public.agent_identity_bindings (client_id, owner_id, enabled)
    values ('synthetic-user-a.access', '00000000-0000-4000-8000-000000000005', true);
    raise exception 'DUPLICATE_CLIENT_ID_ACCEPTED';
  exception when unique_violation then null; end;
  begin
    insert into public.agent_identity_bindings (client_id, owner_id, enabled)
    values ('synthetic-unknown-user.access', '00000000-0000-4000-8000-000000000006', true);
    raise exception 'MISSING_USER_ACCEPTED';
  exception when foreign_key_violation then null; end;
end $$;
set local role service_role;
do $$
begin
  if public.agent_resolve_owner('synthetic-user-a.access') is distinct from
      '{"ownerId":"00000000-0000-4000-8000-000000000004"}'::jsonb or
    public.agent_resolve_owner('synthetic-user-b.access') is distinct from
      '{"ownerId":"00000000-0000-4000-8000-000000000005"}'::jsonb then
    raise exception 'CROSS_USER_BINDING';
  end if;
end $$;
reset role;
delete from auth.users where id = '00000000-0000-4000-8000-000000000004';
set local role service_role;
do $$
begin
  if public.agent_resolve_owner('synthetic-user-a.access') is distinct from 'null'::jsonb then
    raise exception 'DELETED_USER_BINDING_RESOLVES';
  end if;
end $$;
rollback;

begin;
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.agent_identity_bindings'::regclass) then
    raise exception 'AGENT_BINDINGS_RLS_REQUIRED';
  end if;
  if has_function_privilege('anon', 'public.agent_resolve_owner(text)', 'EXECUTE') or
    has_function_privilege('authenticated', 'public.agent_resolve_owner(text)', 'EXECUTE') or
    not has_function_privilege('service_role', 'public.agent_resolve_owner(text)', 'EXECUTE') then
    raise exception 'AGENT_BINDING_RPC_ACL';
  end if;
  if has_table_privilege('anon', 'public.agent_identity_bindings', 'SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('authenticated', 'public.agent_identity_bindings', 'SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('service_role', 'public.agent_identity_bindings', 'INSERT,UPDATE,DELETE') or
    not has_table_privilege('service_role', 'public.agent_identity_bindings', 'SELECT') then
    raise exception 'AGENT_BINDING_TABLE_ACL';
  end if;
end $$;
set local role anon;
do $$
begin
  begin
    perform public.agent_resolve_owner('synthetic-client-a.access');
    raise exception 'ANON_RESOLVER_EXPOSED';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform public.agent_resolve_owner('synthetic-client-a.access');
    raise exception 'AUTHENTICATED_RESOLVER_EXPOSED';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

begin;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000001');
insert into public.agent_identity_bindings (client_id, owner_id, enabled)
values ('synthetic-client-a.access', '00000000-0000-4000-8000-000000000001', true);
set local role service_role;
do $$
begin
  if public.agent_resolve_owner('synthetic-client-a.access') is distinct from
    '{"ownerId":"00000000-0000-4000-8000-000000000001"}'::jsonb then
    raise exception 'ACTIVE_BINDING_OWNER_MISMATCH';
  end if;
end $$;
rollback;

-- Multiple credentials can belong to the same user; disabling one does not affect the other.
begin;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000003');
insert into public.agent_identity_bindings (client_id, owner_id, enabled)
values ('synthetic-a1.access', '00000000-0000-4000-8000-000000000003', true),
       ('synthetic-a2.access', '00000000-0000-4000-8000-000000000003', true);
update public.agent_identity_bindings set enabled = false where client_id = 'synthetic-a1.access';
set local role service_role;
do $$
begin
  if public.agent_resolve_owner('synthetic-a1.access') is distinct from 'null'::jsonb or
    public.agent_resolve_owner('synthetic-a2.access') is distinct from
      '{"ownerId":"00000000-0000-4000-8000-000000000003"}'::jsonb then
    raise exception 'BINDING_DISABLE_ISOLATION_FAILED';
  end if;
end $$;
rollback;

-- Unknown, disabled, and default-disabled credentials never resolve an owner.
begin;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
insert into public.agent_identity_bindings (client_id, owner_id, enabled)
values ('synthetic-disabled.access', '00000000-0000-4000-8000-000000000002', false);
insert into public.agent_identity_bindings (client_id, owner_id)
values ('synthetic-default.access', '00000000-0000-4000-8000-000000000002');
set local role service_role;
do $$
begin
  if public.agent_resolve_owner('synthetic-disabled.access') is distinct from 'null'::jsonb
    or public.agent_resolve_owner('synthetic-default.access') is distinct from 'null'::jsonb
    or public.agent_resolve_owner('synthetic-unknown.access') is distinct from 'null'::jsonb then
    raise exception 'INACTIVE_BINDING_RESOLVED';
  end if;
end $$;
rollback;
