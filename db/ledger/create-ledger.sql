-- Apply only after a read-only inspection of the target schema. No existing business data is changed.
begin;
create or replace function public.ledger_trim(value text) returns text
language sql immutable strict set search_path = pg_catalog as $$
  select btrim(value, E' \t\n\r\f\v' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279));
$$;
create table public.ledger_owner_revision (
  owner_id uuid primary key,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.ledger_owner_revision(owner_id),
  request_id uuid not null,
  direction text not null check (direction in ('expense', 'income')),
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -99999999999 and 99999999999),
  occurred_at timestamptz not null check (isfinite(occurred_at) and occurred_at >= '0001-01-01T00:00:00Z' and occurred_at = date_trunc('second', occurred_at) and occurred_at <= now()),
  account_name text not null check (account_name = public.ledger_trim(account_name) and char_length(account_name) between 1 and 50),
  category_code text not null,
  note text not null default '' check (note = public.ledger_trim(note) and char_length(note) <= 500),
  parent_entry_id uuid,
  created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (owner_id, id), unique (owner_id, request_id),
  foreign key (owner_id, parent_entry_id) references public.ledger_entries(owner_id, id),
  check ((direction = 'expense' and amount_cents < 0 and parent_entry_id is null) or (direction = 'income' and amount_cents > 0)),
  check (case when direction = 'expense' or parent_entry_id is not null then
    category_code in ('transport','accommodation','dining','shopping','gift_expense','top_up','subscription','investment','other_expense')
    else category_code in ('salary','part_time','investment','gift_income','secondhand_sale','other_income') end)
);
create index ledger_entries_active_time on public.ledger_entries (owner_id, occurred_at desc, id desc) where deleted_at is null;
create index ledger_entries_active_refunds on public.ledger_entries (owner_id, parent_entry_id) where deleted_at is null and parent_entry_id is not null;
alter table public.ledger_entries enable row level security;
alter table public.ledger_owner_revision enable row level security;
revoke all on public.ledger_entries, public.ledger_owner_revision from public, anon, authenticated, service_role;

create or replace function public.ledger_entry_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  if (new.id,new.owner_id,new.request_id,new.direction,new.amount_cents,new.occurred_at,new.account_name,new.category_code,new.note,new.parent_entry_id,new.created_at)
    is distinct from (old.id,old.owner_id,old.request_id,old.direction,old.amount_cents,old.occurred_at,old.account_name,old.category_code,old.note,old.parent_entry_id,old.created_at)
    or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at)
    then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  return new;
end $$;
create trigger ledger_entry_immutable before update or delete on public.ledger_entries for each row execute function public.ledger_entry_immutable();
revoke all on function public.ledger_entry_immutable() from public, anon, authenticated, service_role;

-- Service roles have RPC access only. Definer functions keep table writes unavailable to API roles.
create or replace function public.ledger_entry_json(p_entry public.ledger_entries) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', p_entry.id, 'direction', p_entry.direction, 'amountCents', p_entry.amount_cents,
    'occurredAt', to_char(p_entry.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'accountName', p_entry.account_name, 'categoryCode', p_entry.category_code, 'note', p_entry.note,
    'parentEntryId', p_entry.parent_entry_id, 'createdAt', to_char(p_entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', 'completed');
$$;

create or replace function public.ledger_list(p_owner uuid, p_page integer default 1) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; items jsonb; total bigint;
begin
  if p_owner is null or p_page is null or p_page < 1 or p_page > 1000000 then raise exception 'INVALID_QUERY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  -- Do not run a later count on an absent version row: a concurrent first write may appear between snapshots.
  if not found then return jsonb_build_object('items','[]'::jsonb,'total',0,'page',p_page,'pageSize',30,'version',0); end if;
  select count(*) into total from public.ledger_entries where owner_id = p_owner and deleted_at is null;
  select coalesce(jsonb_agg(public.ledger_entry_json(e) order by e.occurred_at desc, e.id desc), '[]'::jsonb) into items
    from (select * from public.ledger_entries where owner_id = p_owner and deleted_at is null
      order by occurred_at desc, id desc limit 30 offset (p_page::bigint - 1) * 30) e;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',30,'version',v);
end $$;
create or replace function public.ledger_detail(p_owner uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries;
begin
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('entry', public.ledger_entry_json(entry), 'parentEntry', null, 'refunds', '[]'::jsonb, 'version', v);
end $$;
create or replace function public.ledger_create(p_owner uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; old public.ledger_entries; inserted_id uuid; input_request_id uuid; direction text;
  amount bigint; occurred timestamptz; account_name text; category text; note text;
begin
  if p_owner is null or jsonb_typeof(p_input) is distinct from 'object' or
    not (p_input ?& array['requestId','direction','amountCents','occurredAt','accountName','categoryCode','note']) or
    (p_input - array['requestId','direction','amountCents','occurredAt','accountName','categoryCode','note']) <> '{}'::jsonb
    then raise exception 'INVALID_ENTRY'; end if;
  begin
    if jsonb_typeof(p_input->'amountCents') <> 'number' or (p_input->>'amountCents') !~ '^-?[0-9]+$' or
      exists (select from jsonb_each(p_input - 'amountCents') where jsonb_typeof(value) <> 'string') then raise exception 'INVALID_ENTRY'; end if;
    input_request_id := (p_input->>'requestId')::uuid; direction := p_input->>'direction'; amount := (p_input->>'amountCents')::bigint;
    if (p_input->>'occurredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' then raise exception 'INVALID_ENTRY'; end if;
    occurred := (p_input->>'occurredAt')::timestamptz;
    account_name := public.ledger_trim(p_input->>'accountName'); category := p_input->>'categoryCode'; note := public.ledger_trim(p_input->>'note');
  exception when others then raise exception 'INVALID_ENTRY'; end;
  insert into public.ledger_owner_revision(owner_id) values (p_owner) on conflict do nothing;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  select * into old from public.ledger_entries where owner_id = p_owner and ledger_entries.request_id = input_request_id;
  if found then
    if old.parent_entry_id is not null or (old.direction,old.amount_cents,old.occurred_at,old.account_name,old.category_code,old.note)
      is distinct from (direction,amount,occurred,account_name,category,note) then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('entryId',old.id,'version',v,'deleted',old.deleted_at is not null);
  end if;
  if occurred > now() then raise exception 'FUTURE_TIME'; end if;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note)
      values (p_owner,input_request_id,direction,amount,occurred,account_name,category,note) returning id into inserted_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_ENTRY'; end;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',inserted_id,'version',v,'deleted',false);
end $$;
revoke all on function public.ledger_trim(text), public.ledger_entry_json(public.ledger_entries), public.ledger_list(uuid,integer), public.ledger_detail(uuid,uuid), public.ledger_create(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ledger_list(uuid,integer), public.ledger_detail(uuid,uuid), public.ledger_create(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
