-- Synthetic schema/permission probes only; business assertions use Worker HTTP.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); from_id uuid; to_id uuid; receipt jsonb;
  role_name text; fn text;
begin
  if (select count(*) from pg_tables where schemaname='public' and tablename like 'ledger_%')<>4 then raise exception 'FOUR_TABLES_REQUIRED'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,'public.ledger_transfer(uuid,jsonb)','EXECUTE')<>(role_name='service_role') then raise exception 'TRANSFER_RPC_ACL'; end if;
    foreach fn in array array['ledger_transfer_pair()','ledger_delete_targets(uuid,uuid)'] loop
      if has_function_privilege(role_name,'public.'||fn,'EXECUTE') then raise exception 'TRANSFER_HELPER_ACL'; end if;
    end loop;
    if has_table_privilege(role_name,'public.ledger_entries','SELECT,INSERT,UPDATE,DELETE') then raise exception 'DIRECT_ENTRY_ACCESS'; end if;
  end loop;
  from_id:=(public.ledger_account_create(owner_id,jsonb_build_object('requestId',gen_random_uuid(),'name','转出','balanceCents',0))->>'accountId')::uuid;
  to_id:=(public.ledger_account_create(owner_id,jsonb_build_object('requestId',gen_random_uuid(),'name','转入','balanceCents',0))->>'accountId')::uuid;
  -- A maintenance writer cannot persist only one side, or mark one side deleted.
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,transfer_id)
      values(owner_id,gen_random_uuid(),'expense',-100,'2025-01-01T00:00:00Z',from_id,'transfer_out',gen_random_uuid());
    set constraints ledger_transfer_pair immediate;
    raise exception 'SINGLE_SIDE_ALLOWED';
  exception when check_violation then null; end;
  receipt:=public.ledger_transfer(owner_id,jsonb_build_object('requestId',gen_random_uuid(),'fromAccountId',from_id,'toAccountId',to_id,'amountCents',100,'occurredAt','2025-01-01T00:00:00Z'));
  set constraints ledger_transfer_pair immediate;
  begin
    update public.ledger_entries set deleted_at=now() where id=(receipt->>'outEntryId')::uuid;
    raise exception 'SINGLE_DELETE_ALLOWED';
  exception when check_violation then null; end;
  begin
    update public.ledger_entries set transfer_id=gen_random_uuid() where id=(receipt->>'outEntryId')::uuid;
    raise exception 'TRANSFER_ID_MUTABLE';
  exception when check_violation then null; end;
  begin
    update public.ledger_entries set account_id=to_id where id=(receipt->>'outEntryId')::uuid;
    raise exception 'TRANSFER_ACCOUNT_MUTABLE';
  exception when check_violation then null; end;
end $$;
rollback;
