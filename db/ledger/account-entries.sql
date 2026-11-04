-- Apply after accounts.sql, before the matching Worker/UI release.
-- Preserves legacy rows and names without assigning accounts or moving balances.
-- Rollback requires a coordinated compatible release: retain account ownership,
-- balances and RPC restrictions; do not revert to legacy writers or backfill data.
begin;
alter table public.ledger_entries add column account_id uuid, add column transfer_id uuid;
alter table public.ledger_entries alter column account_name drop not null;
alter table public.ledger_entries add constraint ledger_entries_account_owner_fk
  foreign key (owner_id,account_id) references public.ledger_accounts(owner_id,id);
alter table public.ledger_entries add constraint ledger_entries_account_name_snapshot
  check (account_id is null or account_name is null);
create or replace function public.ledger_entry_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  if (new.id,new.owner_id,new.request_id,new.direction,new.amount_cents,new.occurred_at,new.account_name,new.account_id,new.transfer_id,new.category_code,new.note,new.parent_entry_id,new.created_at)
    is distinct from (old.id,old.owner_id,old.request_id,old.direction,old.amount_cents,old.occurred_at,old.account_name,old.account_id,old.transfer_id,old.category_code,old.note,old.parent_entry_id,old.created_at)
    or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at)
    then raise exception 'LEDGER_IMMUTABLE' using errcode = '23514'; end if;
  return new;
end $$;
create or replace function public.ledger_entry_json(p_entry public.ledger_entries) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', p_entry.id, 'direction', p_entry.direction, 'amountCents', p_entry.amount_cents,
    'occurredAt', to_char(p_entry.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'accountId', p_entry.account_id, 'transferId', p_entry.transfer_id,
    'accountName', (select a.name from public.ledger_accounts a where a.owner_id=p_entry.owner_id and a.id=p_entry.account_id), 'categoryCode', p_entry.category_code, 'note', p_entry.note,
    'parentEntryId', p_entry.parent_entry_id, 'createdAt', to_char(p_entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', case when p_entry.direction = 'expense' then
      (select case when coalesce(sum(r.amount_cents),0) = 0 then 'completed'
        when sum(r.amount_cents) = -p_entry.amount_cents then 'full-refund' else 'partial-refund' end
       from public.ledger_entries r where r.owner_id = p_entry.owner_id and r.parent_entry_id = p_entry.id and r.deleted_at is null and r.account_id is not null)
      else 'completed' end);
$$;
-- Internal helper: callers hold the owner's write lock and validate ownership.
create function public.ledger_apply_balance(p_owner uuid, p_account uuid, p_delta bigint) returns void
language plpgsql set search_path = pg_catalog, public as $$
begin
  update public.ledger_accounts set balance_cents = balance_cents + p_delta, updated_at = now()
    where owner_id=p_owner and id=p_account and balance_cents + p_delta between -99999999999 and 99999999999;
  if not found then raise exception 'BALANCE_LIMIT'; end if;
end $$;
revoke all on function public.ledger_apply_balance(uuid,uuid,bigint) from public, anon, authenticated, service_role;
create or replace function public.ledger_create(p_owner uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; old public.ledger_entries; inserted_id uuid; input_request_id uuid; direction text;
  amount bigint; occurred timestamptz; input_account uuid; category text; note text;
begin
  if p_owner is null or jsonb_typeof(p_input) is distinct from 'object' or
    not (p_input ?& array['requestId','direction','amountCents','occurredAt','accountId','categoryCode','note']) or
    (p_input - array['requestId','direction','amountCents','occurredAt','accountId','categoryCode','note']) <> '{}'::jsonb
    then raise exception 'INVALID_ENTRY'; end if;
  begin
    if jsonb_typeof(p_input->'amountCents') <> 'number' or (p_input->>'amountCents') !~ '^-?[0-9]+$' or
      exists (select from jsonb_each(p_input - 'amountCents') where jsonb_typeof(value) <> 'string') then raise exception 'INVALID_ENTRY'; end if;
    input_request_id := (p_input->>'requestId')::uuid; direction := p_input->>'direction'; amount := (p_input->>'amountCents')::bigint;
    if (p_input->>'occurredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' then raise exception 'INVALID_ENTRY'; end if;
    occurred := (p_input->>'occurredAt')::timestamptz;
    input_account := (p_input->>'accountId')::uuid; category := p_input->>'categoryCode'; note := public.ledger_trim(p_input->>'note');
  exception when others then raise exception 'INVALID_ENTRY'; end;
  insert into public.ledger_owner_revision(owner_id) values (p_owner) on conflict do nothing;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  select * into old from public.ledger_entries where owner_id = p_owner and ledger_entries.request_id = input_request_id;
  if found then
    if old.account_id is null then raise exception 'NOT_FOUND'; end if;
    if old.parent_entry_id is not null or old.transfer_id is not null or (old.direction,old.amount_cents,old.occurred_at,old.account_id,old.category_code,old.note)
      is distinct from (direction,amount,occurred,input_account,category,note) then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('entryId',old.id,'version',v,'deleted',old.deleted_at is not null);
  end if;
  if not exists(select from public.ledger_accounts where owner_id=p_owner and id=input_account) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if occurred > now() then raise exception 'FUTURE_TIME'; end if;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note)
      values (p_owner,input_request_id,direction,amount,occurred,input_account,category,note) returning id into inserted_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_ENTRY'; end;
  perform public.ledger_apply_balance(p_owner,input_account,amount);
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',inserted_id,'version',v,'deleted',false);
end $$;
create or replace function public.ledger_refund(p_owner uuid, p_parent uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; old public.ledger_entries; parent public.ledger_entries; inserted_id uuid;
  input_request_id uuid; amount bigint; occurred timestamptz; note text; refunded bigint;
begin
  if p_owner is null or p_parent is null or jsonb_typeof(p_input) is distinct from 'object' or
    not (p_input ?& array['requestId','amountCents','occurredAt','note']) or
    (p_input - array['requestId','amountCents','occurredAt','note']) <> '{}'::jsonb then raise exception 'INVALID_ENTRY'; end if;
  begin
    if jsonb_typeof(p_input->'amountCents') <> 'number' or (p_input->>'amountCents') !~ '^[0-9]+$' or
      exists(select from jsonb_each(p_input - 'amountCents') where jsonb_typeof(value) <> 'string') then raise exception 'INVALID_ENTRY'; end if;
    input_request_id := (p_input->>'requestId')::uuid; amount := (p_input->>'amountCents')::bigint;
    if (p_input->>'occurredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' then raise exception 'INVALID_ENTRY'; end if;
    occurred := (p_input->>'occurredAt')::timestamptz; note := public.ledger_trim(p_input->>'note');
    if amount < 1 or amount > 99999999999 or char_length(note) > 500 then raise exception 'INVALID_ENTRY'; end if;
  exception when others then raise exception 'INVALID_ENTRY'; end;
  insert into public.ledger_owner_revision(owner_id) values (p_owner) on conflict do nothing;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  -- Deduplicate all entries before checking current parent validity or remaining credit.
  select * into old from public.ledger_entries where owner_id = p_owner and request_id = input_request_id;
  if found then
    if old.account_id is null then raise exception 'NOT_FOUND'; end if;
    if (old.direction,old.parent_entry_id,old.amount_cents,old.occurred_at,old.note)
      is distinct from ('income'::text,p_parent,amount,occurred,note) then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('entryId',old.id,'version',v,'deleted',old.deleted_at is not null);
  end if;
  select * into parent from public.ledger_entries where owner_id = p_owner and id = p_parent and deleted_at is null and account_id is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if parent.direction <> 'expense' or parent.parent_entry_id is not null or parent.transfer_id is not null then raise exception 'REFUND_PARENT_INVALID'; end if;
  if occurred > now() then raise exception 'FUTURE_TIME'; end if;
  if occurred < parent.occurred_at then raise exception 'REFUND_TIME'; end if;
  select coalesce(sum(amount_cents),0) into refunded from public.ledger_entries where owner_id = p_owner and parent_entry_id = p_parent and deleted_at is null and account_id is not null;
  if amount > -parent.amount_cents - refunded then raise exception 'REFUND_LIMIT'; end if;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,parent_entry_id)
      values(p_owner,input_request_id,'income',amount,occurred,parent.account_id,parent.category_code,note,p_parent) returning id into inserted_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_ENTRY'; end;
  perform public.ledger_apply_balance(p_owner,parent.account_id,amount);
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',inserted_id,'version',v,'deleted',false);
end $$;
create or replace function public.ledger_delete(p_owner uuid, p_id uuid, p_scope text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; impact record; affected record;
begin
  if p_owner is null or p_id is null or p_scope is null or p_scope !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_ENTRY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and account_id is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if entry.deleted_at is not null then return jsonb_build_object('entryId',p_id,'version',v,'deleted',true); end if;
  select * into impact from public.ledger_delete_scope(p_owner, p_id);
  if impact.scope <> p_scope then raise exception 'DELETE_SCOPE_CHANGED'; end if;
  -- Aggregate the entire confirmed set before changing the current amount.
  -- Net reversal allows a parent and its refunds to cancel at the amount bound.
  for affected in select account_id, sum(amount_cents)::bigint as amount from public.ledger_entries
    where owner_id=p_owner and deleted_at is null and account_id is not null and (id=p_id or parent_entry_id=p_id)
    group by account_id loop
    perform public.ledger_apply_balance(p_owner,affected.account_id,-affected.amount);
  end loop;
  update public.ledger_entries set deleted_at = now() where owner_id = p_owner and id = p_id and account_id is not null;
  update public.ledger_entries set deleted_at = now() where owner_id = p_owner and parent_entry_id = p_id and deleted_at is null and account_id is not null;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',p_id,'version',v,'deleted',true);
end $$;
create or replace function public.ledger_list(p_owner uuid, p_page integer default 1, p_start_date date default null, p_end_date date default null, p_version bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; items jsonb; total bigint; starts timestamptz; ends timestamptz;
begin
  if p_owner is null or p_page is null or p_page < 1 or p_page > 1000000
    or (p_start_date is null) <> (p_end_date is null)
    or p_start_date > p_end_date or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date < date '0001-01-01' or p_end_date > date '9999-12-31'
    or p_version < 0 or p_version > 9007199254740991 then raise exception 'INVALID_QUERY'; end if;
  starts := p_start_date::timestamp at time zone 'Asia/Shanghai';
  ends := (p_end_date + 1)::timestamp at time zone 'Asia/Shanghai';
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then
    if p_version is not null and p_version <> 0 then raise exception 'LIST_CHANGED'; end if;
    return jsonb_build_object('items','[]'::jsonb,'total',0,'page',p_page,'pageSize',30,'version',0);
  end if;
  if p_version is not null and p_version <> v then raise exception 'LIST_CHANGED'; end if;
  select count(*) into total from public.ledger_entries where owner_id = p_owner and deleted_at is null and account_id is not null
    and (starts is null or occurred_at >= starts) and (ends is null or occurred_at < ends);
  select coalesce(jsonb_agg(public.ledger_entry_json(e) order by e.occurred_at desc, e.id desc), '[]'::jsonb) into items
    from (select * from public.ledger_entries where owner_id = p_owner and deleted_at is null and account_id is not null
      and (starts is null or occurred_at >= starts) and (ends is null or occurred_at < ends)
      order by occurred_at desc, id desc limit 30 offset (p_page::bigint - 1) * 30) e;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',30,'version',v);
end $$;
create or replace function public.ledger_detail(p_owner uuid, p_id uuid, p_refund_page bigint default 1, p_version bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; parent jsonb; refunds jsonb; refund_count bigint; refunded bigint;
begin
  if p_refund_page is null or p_refund_page < 1 or p_refund_page > 9007199254740991 or
    p_version < 0 or p_version > 9007199254740991 then raise exception 'INVALID_QUERY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null and account_id is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_version is not null and p_version <> v then raise exception 'LIST_CHANGED'; end if;
  select public.ledger_entry_json(e) into parent from public.ledger_entries e
    where e.owner_id = p_owner and e.id = entry.parent_entry_id and e.deleted_at is null and e.account_id is not null;
  select count(*), coalesce(sum(amount_cents),0) into refund_count, refunded from public.ledger_entries
    where owner_id = p_owner and parent_entry_id = entry.id and deleted_at is null and account_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'amountCents', e.amount_cents,
    'occurredAt', to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by e.occurred_at desc, e.id desc), '[]'::jsonb) into refunds
    from (select id, amount_cents, occurred_at from public.ledger_entries
      where owner_id = p_owner and parent_entry_id = entry.id and deleted_at is null and account_id is not null
      order by occurred_at desc, id desc limit 30 offset (p_refund_page - 1) * 30) e;
  return jsonb_build_object('entry',public.ledger_entry_json(entry),'parentEntry',parent,'refunds',refunds,
    'refundCount',refund_count,'refundedCents',refunded,'refundPage',p_refund_page,'refundPageSize',30,'version',v);
end $$;
create or replace function public.ledger_delete_scope(p_owner uuid, p_id uuid) returns table(scope text, refund_count bigint)
language sql stable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to(p_owner::text || ':' || string_agg(id::text, ',' order by id), 'UTF8')), 'hex'), count(*) - 1
    from (select p_id as id union all select id from public.ledger_entries
      where owner_id = p_owner and parent_entry_id = p_id and deleted_at is null and account_id is not null) affected;
$$;
create or replace function public.ledger_delete_preview(p_owner uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; impact record;
begin
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null and account_id is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into impact from public.ledger_delete_scope(p_owner, p_id);
  return jsonb_build_object('entry',public.ledger_entry_json(entry),'refundCount',impact.refund_count,'scope',impact.scope,'version',v);
end $$;
-- Replacements retain ACLs; state the final service-only surface explicitly.
revoke all on function public.ledger_entry_immutable(), public.ledger_entry_json(public.ledger_entries), public.ledger_create(uuid,jsonb), public.ledger_refund(uuid,uuid,jsonb), public.ledger_delete(uuid,uuid,text), public.ledger_list(uuid,integer,date,date,bigint), public.ledger_detail(uuid,uuid,bigint,bigint), public.ledger_delete_scope(uuid,uuid), public.ledger_delete_preview(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.ledger_create(uuid,jsonb), public.ledger_refund(uuid,uuid,jsonb), public.ledger_delete(uuid,uuid,text), public.ledger_list(uuid,integer,date,date,bigint), public.ledger_detail(uuid,uuid,bigint,bigint), public.ledger_delete_preview(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
