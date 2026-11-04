-- Apply after create-ledger.sql, list-ledger.sql, refunds.sql and delete.sql.
-- Adds account management only; existing entries and their RPC contracts are unchanged.
-- Delivery: review the target schema first, then install this transaction before
-- the matching Worker/UI release. This file is not executed by the application.
-- Rollback: revert the Worker/UI release and keep these additive tables and RPCs
-- (with their restrictive ACLs) so any account/correction facts remain intact.
-- Do not drop tables, rewrite entries or backfill account ownership as rollback.
-- Later #120/#121 SQL must be coordinated separately before system publication.
begin;
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.ledger_owner_revision(owner_id),
  name text not null check (name = public.ledger_trim(name) and char_length(name) between 1 and 50),
  balance_cents bigint not null check (balance_cents between -99999999999 and 99999999999),
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  -- Settled PATCH request ID -> normalized input hash, retained with this account.
  -- Includes no-ops; bookkeeping must not change the business timestamp/version.
  update_requests jsonb not null default '{}'::jsonb check (jsonb_typeof(update_requests) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, name), unique (owner_id, request_id)
);
create index ledger_accounts_update_requests on public.ledger_accounts using gin (update_requests);
alter table public.ledger_accounts enable row level security;
revoke all on public.ledger_accounts from public, anon, authenticated, service_role;
create table public.ledger_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null, account_id uuid not null,
  before_cents bigint not null check (before_cents between -99999999999 and 99999999999),
  after_cents bigint not null check (after_cents between -99999999999 and 99999999999 and after_cents <> before_cents),
  request_id uuid not null, request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (owner_id, account_id) references public.ledger_accounts(owner_id, id),
  unique (owner_id, request_id)
);
alter table public.ledger_balance_adjustments enable row level security;
revoke all on public.ledger_balance_adjustments from public, anon, authenticated, service_role;

create function public.ledger_account_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  if (new.id,new.owner_id,new.request_id,new.request_hash,new.created_at)
    is distinct from (old.id,old.owner_id,old.request_id,old.request_hash,old.created_at)
    then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  if not (new.update_requests @> old.update_requests) then
    raise exception 'LEDGER_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger ledger_account_immutable before update or delete on public.ledger_accounts
  for each row execute function public.ledger_account_immutable();
create function public.ledger_adjustment_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'LEDGER_IMMUTABLE' using errcode = '23514';
end $$;
create trigger ledger_adjustment_immutable before update or delete on public.ledger_balance_adjustments
  for each row execute function public.ledger_adjustment_immutable();

create function public.ledger_account_json(p_account public.ledger_accounts) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', p_account.id, 'name', p_account.name, 'balanceCents', p_account.balance_cents,
    'createdAt', to_char(p_account.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(p_account.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create function public.ledger_accounts_list(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; accounts jsonb;
begin
  if p_owner is null then raise exception 'INVALID_QUERY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then return jsonb_build_object('accounts', '[]'::jsonb, 'version', 0); end if;
  select coalesce(jsonb_agg(public.ledger_account_json(a) order by a.created_at, a.id), '[]'::jsonb) into accounts
    from public.ledger_accounts a where a.owner_id = p_owner;
  return jsonb_build_object('accounts', accounts, 'version', v);
end $$;
create function public.ledger_account_create(p_owner uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; prior public.ledger_accounts; inserted_id uuid;
  input_request uuid; account_name text; amount bigint; input_hash text;
begin
  if p_owner is null or jsonb_typeof(p_input) is distinct from 'object' or
    not (p_input ?& array['requestId','name','balanceCents']) or
    (p_input - array['requestId','name','balanceCents']) <> '{}'::jsonb then raise exception 'INVALID_ACCOUNT'; end if;
  begin
    if jsonb_typeof(p_input->'requestId') is distinct from 'string' or jsonb_typeof(p_input->'name') is distinct from 'string' or
      jsonb_typeof(p_input->'balanceCents') is distinct from 'number' or (p_input->>'balanceCents') !~ '^-?[0-9]+$' then raise exception 'INVALID_ACCOUNT'; end if;
    input_request := (p_input->>'requestId')::uuid;
    account_name := public.ledger_trim(p_input->>'name'); amount := (p_input->>'balanceCents')::bigint;
    if char_length(account_name) not between 1 and 50 or amount not between -99999999999 and 99999999999 then raise exception 'INVALID_ACCOUNT'; end if;
  exception when others then raise exception 'INVALID_ACCOUNT'; end;
  input_hash := encode(sha256(convert_to(jsonb_build_object('name', account_name, 'balanceCents', amount)::text, 'UTF8')), 'hex');
  insert into public.ledger_owner_revision(owner_id) values (p_owner) on conflict do nothing;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  select * into prior from public.ledger_accounts where owner_id = p_owner and request_id = input_request;
  if found then
    if prior.request_hash <> input_hash then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('accountId', prior.id, 'version', v);
  end if;
  begin
    insert into public.ledger_accounts(owner_id, name, balance_cents, request_id, request_hash)
      values (p_owner, account_name, amount, input_request, input_hash) returning id into inserted_id;
  exception when unique_violation then raise exception 'ACCOUNT_NAME_TAKEN'; end;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('accountId', inserted_id, 'version', v);
end $$;
create function public.ledger_account_update(p_owner uuid, p_id uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; account public.ledger_accounts; prior public.ledger_accounts;
  input_request uuid; account_name text; amount bigint; expected bigint; input_hash text; normalized jsonb;
begin
  if p_owner is null or p_id is null or jsonb_typeof(p_input) is distinct from 'object' or not (p_input ? 'requestId') or
    (p_input - array['requestId','name','balanceCents','expectedBalanceCents']) <> '{}'::jsonb or
    (p_input ? 'balanceCents') <> (p_input ? 'expectedBalanceCents') then raise exception 'INVALID_ACCOUNT'; end if;
  begin
    if jsonb_typeof(p_input->'requestId') is distinct from 'string' then raise exception 'INVALID_ACCOUNT'; end if;
    input_request := (p_input->>'requestId')::uuid;
    normalized := jsonb_build_object('accountId', p_id);
    if p_input ? 'name' then
      if jsonb_typeof(p_input->'name') is distinct from 'string' then raise exception 'INVALID_ACCOUNT'; end if;
      account_name := public.ledger_trim(p_input->>'name');
      if char_length(account_name) not between 1 and 50 then raise exception 'INVALID_ACCOUNT'; end if;
      normalized := normalized || jsonb_build_object('name', account_name);
    end if;
    if p_input ? 'balanceCents' then
      if jsonb_typeof(p_input->'balanceCents') is distinct from 'number' or (p_input->>'balanceCents') !~ '^-?[0-9]+$' or
        jsonb_typeof(p_input->'expectedBalanceCents') is distinct from 'number' or (p_input->>'expectedBalanceCents') !~ '^-?[0-9]+$' then raise exception 'INVALID_ACCOUNT'; end if;
      amount := (p_input->>'balanceCents')::bigint; expected := (p_input->>'expectedBalanceCents')::bigint;
      if amount not between -99999999999 and 99999999999 or expected not between -99999999999 and 99999999999 then raise exception 'INVALID_ACCOUNT'; end if;
      normalized := normalized || jsonb_build_object('balanceCents', amount, 'expectedBalanceCents', expected);
    end if;
  exception when others then raise exception 'INVALID_ACCOUNT'; end;
  input_hash := encode(sha256(convert_to(normalized::text, 'UTF8')), 'hex');
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  -- The owner lock serializes lookup and append across ALL of this owner's accounts.
  -- Check settled requests (including rename/no-op) before current balance validation.
  -- The digest binds the original account and every submitted field.
  select * into prior from public.ledger_accounts
    where owner_id = p_owner and update_requests ? input_request::text;
  if found then
    if prior.update_requests->>input_request::text <> input_hash then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('accountId', prior.id, 'version', v);
  end if;
  select * into account from public.ledger_accounts where owner_id = p_owner and id = p_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_input ? 'balanceCents' and account.balance_cents <> expected then raise exception 'BALANCE_CHANGED'; end if;
  -- Appended in the same transaction as the business write; any failure rolls it back.
  update public.ledger_accounts set update_requests = update_requests || jsonb_build_object(input_request::text, input_hash)
    where owner_id = p_owner and id = p_id;
  account_name := coalesce(account_name, account.name); amount := coalesce(amount, account.balance_cents);
  if (account.name, account.balance_cents) is not distinct from (account_name, amount) then
    return jsonb_build_object('accountId', account.id, 'version', v);
  end if;
  begin
    update public.ledger_accounts set name = account_name, balance_cents = amount, updated_at = now() where owner_id = p_owner and id = p_id;
  exception when unique_violation then raise exception 'ACCOUNT_NAME_TAKEN'; end;
  if amount <> account.balance_cents then
    insert into public.ledger_balance_adjustments(owner_id,account_id,before_cents,after_cents,request_id,request_hash)
      values(p_owner,p_id,account.balance_cents,amount,input_request,input_hash);
  end if;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('accountId', account.id, 'version', v);
end $$;
revoke all on function public.ledger_account_immutable(), public.ledger_adjustment_immutable(), public.ledger_account_json(public.ledger_accounts), public.ledger_accounts_list(uuid), public.ledger_account_create(uuid,jsonb), public.ledger_account_update(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ledger_accounts_list(uuid), public.ledger_account_create(uuid,jsonb), public.ledger_account_update(uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
