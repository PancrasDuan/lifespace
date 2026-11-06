-- Apply only after reviewing the target schema; no existing business rows are changed.
-- Service Token secrets remain in Cloudflare/clients and must never be stored here.
begin;

create table public.agent_identity_bindings (
  client_id text primary key check (client_id = btrim(client_id) and char_length(client_id) between 1 and 255),
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  label text not null default '' check (char_length(label) <= 100),
  created_at timestamptz not null default now()
);
alter table public.agent_identity_bindings enable row level security;
revoke all on public.agent_identity_bindings from public, anon, authenticated, service_role;
grant select on public.agent_identity_bindings to service_role;

create function public.agent_resolve_owner(p_client_id text) returns jsonb
language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select jsonb_build_object('ownerId', binding.owner_id)
      from public.agent_identity_bindings as binding
     where binding.client_id = p_client_id and binding.enabled
  ), 'null'::jsonb);
$$;
revoke all on function public.agent_resolve_owner(text) from public, anon, authenticated, service_role;
grant execute on function public.agent_resolve_owner(text) to service_role;
notify pgrst, 'reload schema';
commit;
