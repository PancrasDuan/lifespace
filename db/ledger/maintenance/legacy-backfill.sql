-- One-time #123/#124 maintenance template. Render to literal SQL with
-- scripts/render-ledger-backfill.mjs; send the ENTIRE result in ONE apply_migration.
-- No permanent helper, table or RPC. An error aborts all data and trigger DDL.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;
set local timezone = 'UTC';
set local standard_conforming_strings = on;
create temporary table ledger124_input (doc jsonb not null) on commit drop;
insert into ledger124_input values (__LEDGER124_INPUT_JSON__::jsonb);
-- Fixed order: wait for existing RPCs, block new owner readers/writers, then
-- acquire downstream locks. All ledger owners briefly wait during maintenance.
lock table public.ledger_owner_revision in access exclusive mode;
lock table public.ledger_accounts in access exclusive mode;
lock table public.ledger_entries in access exclusive mode;
lock table public.ledger_balance_adjustments in access exclusive mode;
create temporary view ledger124_catalog as
__LEDGER124_CATALOG_QUERY__;

do $ledger124$
declare
  input jsonb := (select doc from pg_temp.ledger124_input);
  owner uuid := (input->>'ownerId')::uuid;
  expected_revision bigint := (input->>'revision')::bigint;
  revision bigint;
  owner_before jsonb;
  catalog_before text;
  entries_before text;
  group_input record;
  updated_count bigint;
  complete boolean;
begin
  if jsonb_typeof(input) is distinct from 'object' or owner is null or expected_revision is null
    or expected_revision not between 0 and 9007199254740990
    or jsonb_typeof(input->'groups') is distinct from 'array'
    or jsonb_array_length(input->'groups')<>3
    or (input->>'catalogHash') is null then raise exception 'BACKFILL_INVALID_INPUT'; end if;
  select catalog_hash into catalog_before from pg_temp.ledger124_catalog;
  if catalog_before is distinct from input->>'catalogHash'
    or not exists(select from pg_trigger where tgrelid='public.ledger_entries'::regclass
      and tgname='ledger_entry_immutable' and tgenabled='O' and not tgisinternal)
    or not exists(select from pg_trigger where tgrelid='public.ledger_entries'::regclass
      and tgname='ledger_transfer_pair' and tgenabled='O' and tgdeferrable and tginitdeferred)
    then raise exception 'BACKFILL_CATALOG_DRIFT'; end if;
  select r.revision,to_jsonb(r) into revision,owner_before
    from public.ledger_owner_revision r where owner_id=owner for update;
  if not found then raise exception 'BACKFILL_OWNER_MISSING'; end if;

  create temporary table ledger124_groups (
    name text primary key, request_id uuid not null unique,
    request_hash text not null, account_id uuid
  ) on commit drop;
  create temporary table ledger124_entries (
    id uuid primary key, name text not null references ledger124_groups(name)
  ) on commit drop;
  for group_input in select value from jsonb_array_elements(input->'groups') loop
    if jsonb_typeof(group_input.value->'name') is distinct from 'string'
      or group_input.value->>'name' is distinct from public.ledger_trim(group_input.value->>'name')
      or char_length(group_input.value->>'name') not between 1 and 50
      or jsonb_typeof(group_input.value->'entryIds') is distinct from 'array'
      then raise exception 'BACKFILL_INVALID_GROUP'; end if;
    insert into ledger124_groups(name,request_id,request_hash)
      values(group_input.value->>'name',(group_input.value->>'requestId')::uuid,
        encode(sha256(convert_to(jsonb_build_object('name',group_input.value->>'name','balanceCents',0)::text,'UTF8')),'hex'));
    insert into ledger124_entries(id,name)
      select value::uuid,group_input.value->>'name' from jsonb_array_elements_text(group_input.value->'entryIds');
  end loop;
  if (select count(*) from ledger124_entries)<>14
    or (select array_agg(n order by n) from
      (select count(e.id) n from ledger124_groups g left join ledger124_entries e using(name) group by g.name) counts)
      is distinct from array[1,1,12]::bigint[] then raise exception 'BACKFILL_INVALID_SCOPE'; end if;

  -- Stable opening request/hash identifies completion, even after rename/balance
  -- changes, new entries, refunds or logical deletion. Never replay opening values.
  update ledger124_groups g set account_id=a.id from public.ledger_accounts a
    where a.owner_id=owner and a.request_id=g.request_id and a.request_hash=g.request_hash;
  select not exists(select from ledger124_groups where account_id is null)
    and not exists(select from ledger124_entries m join ledger124_groups g using(name)
      left join public.ledger_entries e on e.id=m.id
      where e.id is null or e.owner_id<>owner or e.account_id is distinct from g.account_id or e.account_name is not null)
    into complete;
  if complete then
    if revision < expected_revision+1 then raise exception 'BACKFILL_CONTRADICTORY_REVISION'; end if;
    raise notice 'BACKFILL_ALREADY_COMPLETE';
    return;
  end if;

  -- Only the inventoried original state can be migrated. Mixed states fail.
  if revision<>expected_revision then raise exception 'BACKFILL_REVISION_DRIFT'; end if;
  if exists(select from public.ledger_accounts where owner_id=owner)
    or exists(select from public.ledger_balance_adjustments where owner_id=owner)
    then raise exception 'BACKFILL_ACCOUNT_STATE'; end if;
  if (select count(*) from public.ledger_entries where owner_id=owner)<>14
    or exists(select from ledger124_entries m left join public.ledger_entries e on e.id=m.id
      where e.id is null or e.owner_id<>owner or e.account_name is distinct from m.name
        or e.account_id is not null or e.deleted_at is not null or e.parent_entry_id is not null
        or e.transfer_id is not null or e.direction<>'expense')
    then raise exception 'BACKFILL_SCOPE_DRIFT'; end if;
  select encode(sha256(convert_to(jsonb_agg(to_jsonb(e)-array['account_id','account_name'] order by id)::text,'UTF8')),'hex')
    into entries_before from public.ledger_entries e where owner_id=owner;
  insert into public.ledger_accounts(owner_id,name,balance_cents,request_id,request_hash)
    select owner,name,0,request_id,request_hash from ledger124_groups order by request_id;
  update ledger124_groups g set account_id=a.id from public.ledger_accounts a
    where a.owner_id=owner and a.request_id=g.request_id;
  alter table public.ledger_entries disable trigger ledger_entry_immutable;
  update public.ledger_entries e set account_id=g.account_id,account_name=null
    from ledger124_entries m join ledger124_groups g using(name) where e.id=m.id and e.owner_id=owner;
  get diagnostics updated_count = row_count;
  if updated_count<>14 then raise exception 'BACKFILL_UPDATE_COUNT'; end if;
  -- UPDATE queues this deferred constraint even for ordinary entries. Drain it
  -- BEFORE ALTER TABLE, otherwise PostgreSQL rejects pending trigger events.
  set constraints public.ledger_transfer_pair immediate;
  alter table public.ledger_entries enable trigger ledger_entry_immutable;
  set constraints public.ledger_transfer_pair deferred;

  if entries_before is distinct from (select encode(sha256(convert_to(
      jsonb_agg(to_jsonb(e)-array['account_id','account_name'] order by id)::text,'UTF8')),'hex')
      from public.ledger_entries e where owner_id=owner)
    or exists(select from ledger124_entries m join ledger124_groups g using(name)
      join public.ledger_entries e on e.id=m.id where e.account_id is distinct from g.account_id or e.account_name is not null)
    or (select count(*) from public.ledger_accounts where owner_id=owner)<>3
    or exists(select from public.ledger_accounts where owner_id=owner and
      (balance_cents<>0 or update_requests<>'{}'::jsonb))
    or exists(select from public.ledger_balance_adjustments where owner_id=owner)
    then raise exception 'BACKFILL_POSTCONDITION'; end if;
  update public.ledger_owner_revision r set revision=r.revision+1,updated_at=now() where owner_id=owner;
  if (select to_jsonb(r)-array['revision','updated_at'] from public.ledger_owner_revision r where owner_id=owner)
      is distinct from owner_before-array['revision','updated_at']
    or (select r.revision from public.ledger_owner_revision r where owner_id=owner)<>expected_revision+1
    or (select catalog_hash from pg_temp.ledger124_catalog) is distinct from catalog_before
    then raise exception 'BACKFILL_PROTECTION_CHANGED'; end if;
  raise notice 'BACKFILL_APPLIED';
end $ledger124$;
drop view pg_temp.ledger124_catalog;
commit;
