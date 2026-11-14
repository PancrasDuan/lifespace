-- Additive; does not change ledger rows or legacy Service Token bindings.
begin;
create table public.agent_oauth_grants (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 2048),
  client_name text not null check (char_length(client_name) <= 200),
  resource text not null check (char_length(resource) between 1 and 2048),
  scopes text[] not null check (cardinality(scopes) between 1 and 3 and scopes <@ array['ledger:accounts:read', 'ledger:entries:create', 'ledger:refunds:create']::text[]),
  consent_hash text not null unique check (consent_hash ~ '^[a-f0-9]{64}$'),
  code_used_at timestamptz,
  provider_grant_id text check (char_length(provider_grant_id) between 1 and 128),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz
);
create index agent_oauth_grants_owner_created on public.agent_oauth_grants(owner_id, created_at desc, id);
alter table public.agent_oauth_grants enable row level security;
revoke all on public.agent_oauth_grants from public, anon, authenticated, service_role;

create function public.agent_oauth_grant_json(g public.agent_oauth_grants) returns jsonb
language sql immutable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('id', g.id, 'ownerId', g.owner_id, 'clientId', g.client_id, 'clientName', g.client_name,
    'resource', g.resource, 'scopes', g.scopes, 'createdAt', g.created_at, 'expiresAt', g.expires_at,
    'revokedAt', g.revoked_at, 'providerGrantId', g.provider_grant_id);
$$;
revoke all on function public.agent_oauth_grant_json(public.agent_oauth_grants) from public, anon, authenticated, service_role;

create function public.agent_oauth_grant_create(p_id uuid, p_owner uuid, p_client text, p_name text, p_resource text, p_scopes text[], p_consent_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare g public.agent_oauth_grants;
begin
  -- No update/upsert: an old authorization can never be re-enabled or reassigned.
  insert into public.agent_oauth_grants(id, owner_id, client_id, client_name, resource, scopes, consent_hash)
    values(p_id, p_owner, p_client, p_name, p_resource, p_scopes, p_consent_hash) returning * into g;
  return public.agent_oauth_grant_json(g);
end;
$$;

create function public.agent_oauth_grant_check(p_id uuid, p_owner uuid, p_client text, p_resource text, p_provider_grant text default null, p_exchange_code boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare g public.agent_oauth_grants;
begin
  if p_provider_grant is not null then
    -- The token exchange's trusted grant ID is bound only once. A revoke that
    -- committed before this statement prevents both code exchange and refresh.
    update public.agent_oauth_grants set provider_grant_id = p_provider_grant,
        code_used_at = case when p_exchange_code then statement_timestamp() else code_used_at end
      where id = p_id and owner_id = p_owner and client_id = p_client and resource = p_resource
        and revoked_at is null and expires_at > statement_timestamp()
        and (provider_grant_id is null or provider_grant_id = p_provider_grant)
        and (not p_exchange_code or code_used_at is null)
      returning * into g;
  else
    select * into g from public.agent_oauth_grants
      where id = p_id and owner_id = p_owner and client_id = p_client and resource = p_resource
        and revoked_at is null and expires_at > statement_timestamp();
  end if;
  if not found then return 'null'::jsonb; end if;
  return public.agent_oauth_grant_json(g);
end;
$$;

create function public.agent_oauth_grants_list(p_owner uuid, p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(public.agent_oauth_grant_json(g) order by g.created_at desc, g.id), '[]'::jsonb)
    from (select * from public.agent_oauth_grants where owner_id = p_owner
      and (p_before is null or created_at < p_before or (created_at = p_before and id > p_before_id))
      order by created_at desc, id limit 21) g;
$$;

create function public.agent_oauth_grant_revoke(p_id uuid, p_owner uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare g public.agent_oauth_grants;
begin
  update public.agent_oauth_grants set revoked_at = coalesce(revoked_at, statement_timestamp())
    where id = p_id and owner_id = p_owner returning * into g;
  if not found then return 'null'::jsonb; end if;
  return public.agent_oauth_grant_json(g);
end;
$$;

revoke all on function public.agent_oauth_grant_create(uuid, uuid, text, text, text, text[], text),
  public.agent_oauth_grant_check(uuid, uuid, text, text, text, boolean), public.agent_oauth_grants_list(uuid, timestamptz, uuid),
  public.agent_oauth_grant_revoke(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_oauth_grant_create(uuid, uuid, text, text, text, text[], text),
  public.agent_oauth_grant_check(uuid, uuid, text, text, text, boolean), public.agent_oauth_grants_list(uuid, timestamptz, uuid),
  public.agent_oauth_grant_revoke(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
