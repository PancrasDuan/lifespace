-- Apply after account-entries.sql with the matching Worker/UI release.
-- No legacy assignment or backfill. For rollback retain the paired-write RPCs,
-- constraints and balances; coordinate a compatible release before reverting code.
begin;
-- Replace only the original category check; keep amount, direction and refund checks.
do $$ declare category_check text;
begin
  select conname into strict category_check from pg_constraint
    where conrelid='public.ledger_entries'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%category_code%';
  execute format('alter table public.ledger_entries drop constraint %I', category_check);
end $$;
alter table public.ledger_entries add constraint ledger_entries_category check (
  case when transfer_id is not null then
    account_id is not null and parent_entry_id is null and
      ((direction='expense' and category_code='transfer_out') or (direction='income' and category_code='transfer_in'))
  when direction='expense' or parent_entry_id is not null then
    category_code in ('transport','accommodation','dining','shopping','gift_expense','top_up','subscription','investment','other_expense')
  else category_code in ('salary','part_time','investment','gift_income','secondhand_sale','other_income') end);
create unique index ledger_entries_transfer_direction on public.ledger_entries(owner_id,transfer_id,direction) where transfer_id is not null;

-- Deferred to commit so neither a single insert nor a single logical deletion can
-- leave half a transfer, including when a privileged maintenance writer is used.
create function public.ledger_transfer_pair() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare pair_count bigint; accounts bigint; amount numeric; times bigint; notes bigint; deletion_states bigint;
begin
  if new.transfer_id is null then return null; end if;
  select count(*), count(distinct account_id), sum(amount_cents), count(distinct occurred_at), count(distinct note), count(distinct (deleted_at is null))
    into pair_count,accounts,amount,times,notes,deletion_states
    from public.ledger_entries where owner_id=new.owner_id and transfer_id=new.transfer_id;
  if pair_count<>2 or accounts<>2 or amount<>0 or times<>1 or notes<>1 or deletion_states<>1 then
    raise exception 'TRANSFER_PAIR_INVALID' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_transfer_pair after insert or update on public.ledger_entries
  deferrable initially deferred for each row execute function public.ledger_transfer_pair();
revoke all on function public.ledger_transfer_pair() from public, anon, authenticated, service_role;

create function public.ledger_transfer(p_owner uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; old public.ledger_entries; peer public.ledger_entries; input_request uuid;
  from_account uuid; to_account uuid; amount bigint; occurred timestamptz; note text;
  transfer uuid := gen_random_uuid(); out_id uuid; in_id uuid;
begin
  if p_owner is null or jsonb_typeof(p_input) is distinct from 'object' or
    not (p_input ?& array['requestId','fromAccountId','toAccountId','amountCents','occurredAt']) or
    (p_input - array['requestId','fromAccountId','toAccountId','amountCents','occurredAt','note']) <> '{}'::jsonb then raise exception 'INVALID_ENTRY'; end if;
  begin
    if jsonb_typeof(p_input->'amountCents') <> 'number' or (p_input->>'amountCents') !~ '^[0-9]+$' or
      exists(select from jsonb_each(p_input - 'amountCents') where jsonb_typeof(value) <> 'string') then raise exception 'INVALID_ENTRY'; end if;
    input_request := (p_input->>'requestId')::uuid; from_account := (p_input->>'fromAccountId')::uuid; to_account := (p_input->>'toAccountId')::uuid;
    amount := (p_input->>'amountCents')::bigint;
    if (p_input->>'occurredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' then raise exception 'INVALID_ENTRY'; end if;
    occurred := (p_input->>'occurredAt')::timestamptz; note := public.ledger_trim(coalesce(p_input->>'note',''));
    if from_account=to_account or amount<1 or amount>99999999999 or char_length(note)>500 then raise exception 'INVALID_ENTRY'; end if;
  exception when others then raise exception 'INVALID_ENTRY'; end;
  insert into public.ledger_owner_revision(owner_id) values(p_owner) on conflict do nothing;
  select revision into v from public.ledger_owner_revision where owner_id=p_owner for update;
  select * into old from public.ledger_entries where owner_id=p_owner and request_id=input_request;
  if found then
    if old.account_id is null then raise exception 'NOT_FOUND'; end if;
    if old.transfer_id is null or old.category_code<>'transfer_out' then raise exception 'REQUEST_ID_REUSED'; end if;
    select * into strict peer from public.ledger_entries where owner_id=p_owner and transfer_id=old.transfer_id and id<>old.id;
    if (old.account_id,peer.account_id,-old.amount_cents,old.occurred_at,old.note) is distinct from (from_account,to_account,amount,occurred,note)
      then raise exception 'REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('transferId',old.transfer_id,'outEntryId',old.id,'inEntryId',peer.id,'version',v,'deleted',old.deleted_at is not null);
  end if;
  if (select count(*) from public.ledger_accounts where owner_id=p_owner and id in (from_account,to_account))<>2 then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if occurred>now() then raise exception 'FUTURE_TIME'; end if;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,transfer_id)
      values(p_owner,input_request,'expense',-amount,occurred,from_account,'transfer_out',note,transfer) returning id into out_id;
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,transfer_id)
      values(p_owner,gen_random_uuid(),'income',amount,occurred,to_account,'transfer_in',note,transfer) returning id into in_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_ENTRY'; end;
  perform public.ledger_apply_balance(p_owner,from_account,-amount);
  perform public.ledger_apply_balance(p_owner,to_account,amount);
  update public.ledger_owner_revision set revision=revision+1, updated_at=now() where owner_id=p_owner returning revision into v;
  return jsonb_build_object('transferId',transfer,'outEntryId',out_id,'inEntryId',in_id,'version',v,'deleted',false);
end $$;
revoke all on function public.ledger_transfer(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ledger_transfer(uuid,jsonb) to service_role;
create function public.ledger_delete_targets(p_owner uuid, p_id uuid) returns setof public.ledger_entries
language sql stable set search_path = pg_catalog, public as $$
  select e.* from public.ledger_entries target join public.ledger_entries e on e.owner_id=target.owner_id
    and (e.id=target.id or (target.transfer_id is not null and e.transfer_id=target.transfer_id)
      or (target.transfer_id is null and e.parent_entry_id=target.id))
    where target.owner_id=p_owner and target.id=p_id and target.deleted_at is null and target.account_id is not null
      and e.deleted_at is null and e.account_id is not null;
$$;
create or replace function public.ledger_delete_scope(p_owner uuid, p_id uuid) returns table(scope text, refund_count bigint)
language sql stable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to(p_owner::text || ':' || string_agg(id::text, ',' order by id), 'UTF8')), 'hex'),
    count(*) filter(where parent_entry_id=p_id) from public.ledger_delete_targets(p_owner,p_id);
$$;
revoke all on function public.ledger_delete_targets(uuid,uuid) from public, anon, authenticated, service_role;
create or replace function public.ledger_detail(p_owner uuid, p_id uuid, p_refund_page bigint default 1, p_version bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; parent jsonb; peer jsonb; refunds jsonb; refund_count bigint; refunded bigint;
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
  select public.ledger_entry_json(e) into peer from public.ledger_entries e
    where e.owner_id=p_owner and e.transfer_id=entry.transfer_id and e.id<>entry.id and e.deleted_at is null and e.account_id is not null;
  return jsonb_build_object('transferEntry',peer,'entry',public.ledger_entry_json(entry),'parentEntry',parent,'refunds',refunds,
    'refundCount',refund_count,'refundedCents',refunded,'refundPage',p_refund_page,'refundPageSize',30,'version',v);
end $$;
create or replace function public.ledger_delete_preview(p_owner uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v bigint; entry public.ledger_entries; impact record; peer jsonb;
begin
  select revision into v from public.ledger_owner_revision where owner_id = p_owner for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into entry from public.ledger_entries where owner_id = p_owner and id = p_id and deleted_at is null and account_id is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into impact from public.ledger_delete_scope(p_owner, p_id);
  select public.ledger_entry_json(e) into peer from public.ledger_entries e
    where e.owner_id=p_owner and e.transfer_id=entry.transfer_id and e.id<>entry.id and e.deleted_at is null and e.account_id is not null;
  return jsonb_build_object('transferEntry',peer,'entry',public.ledger_entry_json(entry),'refundCount',impact.refund_count,'scope',impact.scope,'version',v);
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
  for affected in select account_id, sum(amount_cents)::bigint as amount
    from public.ledger_delete_targets(p_owner,p_id) group by account_id loop
    perform public.ledger_apply_balance(p_owner,affected.account_id,-affected.amount);
  end loop;
  update public.ledger_entries set deleted_at=now()
    where owner_id=p_owner and id in (select id from public.ledger_delete_targets(p_owner,p_id));
  update public.ledger_owner_revision set revision = revision + 1, updated_at = now() where owner_id = p_owner returning revision into v;
  return jsonb_build_object('entryId',p_id,'version',v,'deleted',true);
end $$;
notify pgrst, 'reload schema';
commit;
