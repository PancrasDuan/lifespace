-- Install after create-ledger.sql, in the same inspected target database.
begin;
create or replace function public.ledger_entry_json(p_entry public.ledger_entries) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', p_entry.id, 'direction', p_entry.direction, 'amountCents', p_entry.amount_cents,
    'occurredAt', to_char(p_entry.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'accountName', p_entry.account_name, 'categoryCode', p_entry.category_code, 'note', p_entry.note,
    'parentEntryId', p_entry.parent_entry_id, 'createdAt', to_char(p_entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', case when p_entry.direction = 'expense' then
      (select case when coalesce(sum(r.amount_cents),0) = 0 then 'completed'
        when sum(r.amount_cents) = -p_entry.amount_cents then 'full-refund' else 'partial-refund' end
       from public.ledger_entries r where r.owner_id = p_entry.owner_id and r.parent_entry_id = p_entry.id and r.deleted_at is null)
      else 'completed' end);
$$;
drop function public.ledger_detail(uuid,uuid);
-- Sorted compact association pages; never aggregate unbounded transaction notes.
drop index public.ledger_entries_active_refunds;
create index ledger_entries_active_refunds on public.ledger_entries (owner_id, parent_entry_id, occurred_at desc, id desc) where deleted_at is null and parent_entry_id is not null;
create function public.ledger_detail(p_owner uuid, p_id uuid, p_refund_page bigint default 1, p_version bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; parent jsonb; refunds jsonb; refund_count bigint; refunded bigint;
begin
  if p_refund_page is null or p_refund_page < 1 or p_refund_page > 9007199254740991 or
    p_version < 0 or p_version > 9007199254740991 then raise exception 'INVALID_QUERY'; end if;
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_version is not null and p_version <> v then raise exception 'LIST_CHANGED'; end if;
  select public.ledger_entry_json(e) into parent from public.ledger_entries e
    where e.owner_id = p_owner and e.id = entry.parent_entry_id and e.deleted_at is null;
  select count(*), coalesce(sum(amount_cents),0) into refund_count, refunded from public.ledger_entries
    where owner_id = p_owner and parent_entry_id = entry.id and deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'amountCents', e.amount_cents,
    'occurredAt', to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by e.occurred_at desc, e.id desc), '[]'::jsonb) into refunds
    from (select id, amount_cents, occurred_at from public.ledger_entries
      where owner_id = p_owner and parent_entry_id = entry.id and deleted_at is null
      order by occurred_at desc, id desc limit 30 offset (p_refund_page - 1) * 30) e;
  return jsonb_build_object('entry',public.ledger_entry_json(entry),'parentEntry',parent,'refunds',refunds,
    'refundCount',refund_count,'refundedCents',refunded,'refundPage',p_refund_page,'refundPageSize',30,'version',v);
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
    if (old.direction,old.parent_entry_id,old.amount_cents,old.occurred_at,old.note)
      is distinct from ('income'::text,p_parent,amount,occurred,note) then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('entryId',old.id,'version',v,'deleted',old.deleted_at is not null);
  end if;
  select * into parent from public.ledger_entries where owner_id = p_owner and id = p_parent and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if parent.direction <> 'expense' or parent.parent_entry_id is not null then raise exception 'REFUND_PARENT_INVALID'; end if;
  if occurred > now() then raise exception 'FUTURE_TIME'; end if;
  if occurred < parent.occurred_at then raise exception 'REFUND_TIME'; end if;
  select coalesce(sum(amount_cents),0) into refunded from public.ledger_entries where owner_id = p_owner and parent_entry_id = p_parent and deleted_at is null;
  if amount > -parent.amount_cents - refunded then raise exception 'REFUND_LIMIT'; end if;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note,parent_entry_id)
      values(p_owner,input_request_id,'income',amount,occurred,parent.account_name,parent.category_code,note,p_parent) returning id into inserted_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_ENTRY'; end;
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',inserted_id,'version',v,'deleted',false);
end $$;
revoke all on function public.ledger_refund(uuid,uuid,jsonb), public.ledger_entry_json(public.ledger_entries), public.ledger_detail(uuid,uuid,bigint,bigint) from public, anon, authenticated, service_role;
grant execute on function public.ledger_refund(uuid,uuid,jsonb), public.ledger_detail(uuid,uuid,bigint,bigint) to service_role;
notify pgrst, 'reload schema';
commit;
