-- Synthetic, transaction-scoped constraint/permission probes; never load against production.
begin;
do $$
declare owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); id_a uuid; revision_before bigint; rec jsonb;
begin
  if (select count(*) from pg_tables where schemaname = 'public' and tablename like 'ledger_%') <> 2 then raise exception 'LEDGER_MUST_HAVE_TWO_TABLES'; end if;
  if exists(select from pg_tables where schemaname = 'public' and tablename like 'ledger_%' and not rowsecurity) then raise exception 'RLS_REQUIRED'; end if;
  if has_table_privilege('anon','public.ledger_entries','SELECT') or has_table_privilege('authenticated','public.ledger_entries','SELECT')
    or has_table_privilege('authenticated','public.ledger_owner_revision','SELECT') or has_table_privilege('service_role','public.ledger_entries','UPDATE')
    or has_function_privilege('anon','public.ledger_list(uuid,integer,date,date,bigint)','EXECUTE') or has_function_privilege('authenticated','public.ledger_create(uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.ledger_detail(uuid,uuid)','EXECUTE') then raise exception 'BROWSER_OR_DIRECT_WRITE_PERMISSION'; end if;
  rec := public.ledger_create(owner_a, jsonb_build_object('requestId',gen_random_uuid(),'direction','expense','amountCents',-10000,'occurredAt','2026-01-02T03:04:05.000Z','accountName','零钱','categoryCode','dining','note','原始事实'));
  id_a := (rec->>'entryId')::uuid;
  begin
    update public.ledger_entries set note = '修改原始事实' where id = id_a;
    raise exception 'IMMUTABLE_FACTS_NOT_PROTECTED';
  exception when check_violation then null; end;
  begin
    delete from public.ledger_entries where id = id_a;
    raise exception 'PHYSICAL_DELETE_NOT_PROTECTED';
  exception when check_violation then null; end;
  insert into public.ledger_owner_revision(owner_id) values (owner_b);
  begin
    insert into public.ledger_entries(owner_id, request_id, direction, amount_cents, occurred_at, account_name, category_code, parent_entry_id)
      values(owner_b,gen_random_uuid(),'income',100,'2026-01-02T03:04:05Z','零钱','dining',id_a);
    raise exception 'CROSS_OWNER_PARENT_NOT_PROTECTED';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.ledger_entries(owner_id, request_id, direction, amount_cents, occurred_at, account_name, category_code)
      values(owner_a,gen_random_uuid(),'expense',-1,'2026-01-02T03:04:05Z',repeat('😀',51),'dining');
    raise exception 'DATABASE_CODEPOINT_LIMIT_MISSING';
  exception when check_violation then null; end;
  begin
    insert into public.ledger_entries(owner_id, request_id, direction, amount_cents, occurred_at, account_name, category_code)
      values(owner_a,gen_random_uuid(),'expense',-100000000000,'2026-01-02T03:04:05Z','零钱','dining');
    raise exception 'DATABASE_AMOUNT_LIMIT_MISSING';
  exception when check_violation then null; end;
  select revision into revision_before from public.ledger_owner_revision where owner_id=owner_a;
  begin
    perform public.ledger_create(owner_a, jsonb_build_object('requestId',gen_random_uuid(),'direction','expense','amountCents',0,'occurredAt','2026-01-02T03:04:05.000Z','accountName','零钱','categoryCode','dining','note',''));
    raise exception 'ZERO_AMOUNT_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'INVALID_ENTRY' then raise; end if; end;
  if (select revision from public.ledger_owner_revision where owner_id=owner_a) <> revision_before then raise exception 'FAILED_WRITE_CHANGED_REVISION'; end if;
  -- Unique requests include deleted records, and retries never resurrect or disclose their body.
  update public.ledger_entries set deleted_at=now() where id=id_a;
  rec := public.ledger_create(owner_a,(select jsonb_build_object('requestId',request_id,'direction',direction,'amountCents',amount_cents,'occurredAt','2026-01-02T03:04:05.000Z','accountName',account_name,'categoryCode',category_code,'note',note) from public.ledger_entries where id=id_a));
  if rec <> jsonb_build_object('entryId',id_a,'version',revision_before,'deleted',true) then raise exception 'DELETED_RETRY_RESURRECTED'; end if;
  if (public.ledger_list(owner_a)->>'total')::int <> 0 then raise exception 'DELETED_ENTRY_VISIBLE'; end if;
  begin perform public.ledger_detail(owner_a,id_a); raise exception 'DELETED_DETAIL_VISIBLE';
  exception when raise_exception then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
end $$;
rollback;
