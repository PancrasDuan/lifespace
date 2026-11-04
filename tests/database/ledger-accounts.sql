-- Synthetic database invariants and ACL probes. Internal corrections have no public read API.
-- Never load against production; all probe records are rolled back.
begin;
do $$
declare owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); v_account_id uuid;
  receipt jsonb; correction jsonb; role_name text; table_name text; fn text; bad jsonb;
begin
  if (select count(*) from pg_tables where schemaname='public' and tablename like 'ledger_%') <> 4 then raise exception 'LEDGER_MUST_HAVE_FOUR_TABLES'; end if;
  if exists(select from pg_tables where schemaname='public' and tablename like 'ledger_%' and not rowsecurity) then raise exception 'RLS_REQUIRED'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['ledger_accounts','ledger_balance_adjustments'] loop
      if has_table_privilege(role_name,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'DIRECT_ACCOUNT_ACCESS'; end if;
    end loop;
    foreach fn in array array['ledger_account_immutable()','ledger_adjustment_immutable()','ledger_account_json(public.ledger_accounts)'] loop
      if has_function_privilege(role_name,'public.'||fn,'EXECUTE') then raise exception 'HELPER_EXECUTION_EXPOSED'; end if;
    end loop;
    foreach fn in array array['ledger_accounts_list(uuid)','ledger_account_create(uuid,jsonb)','ledger_account_update(uuid,uuid,jsonb)'] loop
      if has_function_privilege(role_name,'public.'||fn,'EXECUTE') <> (role_name='service_role') then raise exception 'ACCOUNT_RPC_ACL'; end if;
    end loop;
  end loop;
  if exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ledger_accounts_list','ledger_account_create','ledger_account_update')
    and (not p.prosecdef or not ('search_path=pg_catalog, public'=any(p.proconfig)))) then raise exception 'ACCOUNT_RPC_CONTEXT'; end if;
  receipt := public.ledger_account_create(owner_a,jsonb_build_object('requestId',gen_random_uuid(),'name','账户','balanceCents',100000));
  v_account_id := (receipt->>'accountId')::uuid;
  correction := jsonb_build_object('requestId',gen_random_uuid(),'name','现名','balanceCents',90000,'expectedBalanceCents',100000);
  perform public.ledger_account_update(owner_a,v_account_id,correction);
  perform public.ledger_account_update(owner_a,v_account_id,correction);
  perform public.ledger_account_update(owner_a,v_account_id,jsonb_build_object('requestId',gen_random_uuid(),'name','现名','balanceCents',90000,'expectedBalanceCents',90000));
  perform public.ledger_account_update(owner_a,v_account_id,jsonb_build_object('requestId',gen_random_uuid(),'name','含原余额','balanceCents',90000,'expectedBalanceCents',90000));
  perform public.ledger_account_update(owner_a,v_account_id,jsonb_build_object('requestId',gen_random_uuid(),'name','改名'));
  if (select count(*) from public.ledger_balance_adjustments where owner_id=owner_a) <> 1 or
    not exists(select from public.ledger_balance_adjustments where owner_id=owner_a and ledger_balance_adjustments.account_id=v_account_id and before_cents=100000 and after_cents=90000)
    then raise exception 'INTERNAL_CORRECTION_FACTS'; end if;
  if (select count(*) from public.ledger_entries where owner_id=owner_a) <> 0 then raise exception 'CORRECTION_MUST_NOT_BE_ENTRY'; end if;
  if (select count(*) from public.ledger_accounts a, jsonb_object_keys(a.update_requests) r where a.id=v_account_id) <> 4 then
    raise exception 'EVERY_SETTLED_UPDATE_NEEDS_RECEIPT'; end if;
  if not exists(select from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.relname='ledger_accounts_update_requests' and am.amname='gin' and i.indisvalid) then raise exception 'REQUEST_LOOKUP_INDEX_REQUIRED'; end if;
  begin update public.ledger_accounts set update_requests='{}'::jsonb where id=v_account_id;
    raise exception 'UPDATE_RECEIPTS_REMOVABLE'; exception when check_violation then null; end;
  begin update public.ledger_accounts set update_requests=update_requests||jsonb_build_object(correction->>'requestId',repeat('0',64)) where id=v_account_id;
    raise exception 'UPDATE_RECEIPTS_REWRITABLE'; exception when check_violation then null; end;
  begin update public.ledger_accounts set request_hash=repeat('0',64) where id=v_account_id; raise exception 'ACCOUNT_REQUEST_MUTABLE'; exception when check_violation then null; end;
  begin delete from public.ledger_accounts where id=v_account_id; raise exception 'ACCOUNT_DELETE_ALLOWED'; exception when check_violation then null; end;
  begin update public.ledger_balance_adjustments set after_cents=1 where owner_id=owner_a; raise exception 'CORRECTION_MUTABLE'; exception when check_violation then null; end;
  begin delete from public.ledger_balance_adjustments where owner_id=owner_a; raise exception 'CORRECTION_DELETE_ALLOWED'; exception when check_violation then null; end;
  begin
    insert into public.ledger_balance_adjustments(owner_id,account_id,before_cents,after_cents,request_id,request_hash)
      values(owner_b,v_account_id,0,1,gen_random_uuid(),repeat('0',64));
    raise exception 'CROSS_OWNER_CORRECTION_ALLOWED';
  exception when foreign_key_violation then null; end;
  foreach bad in array array['{"balanceCents":null,"expectedBalanceCents":90000}'::jsonb,'{"name":null}'::jsonb,'{"balanceCents":100000000000,"expectedBalanceCents":90000}'::jsonb,'{"balanceCents":1.5,"expectedBalanceCents":90000}'::jsonb,'{"expectedBalanceCents":90000}'::jsonb,'{"ownerId":"forged"}'::jsonb,'{"update_requests":{}}'::jsonb] loop
    begin
      perform public.ledger_account_update(owner_a,v_account_id,jsonb_build_object('requestId',gen_random_uuid())||bad);
      raise exception 'DATABASE_ACCOUNT_VALIDATION_MISSING';
    exception when raise_exception then if sqlerrm <> 'INVALID_ACCOUNT' then raise; end if; end;
  end loop;
  begin
    update public.ledger_accounts set balance_cents=100000000000 where id=v_account_id;
    raise exception 'DATABASE_ACCOUNT_LIMIT_MISSING';
  exception when check_violation then null; end;
  begin
    update public.ledger_accounts set name=repeat('😀',51) where id=v_account_id;
    raise exception 'DATABASE_ACCOUNT_CODEPOINT_LIMIT_MISSING';
  exception when check_violation then null; end;
end $$;
rollback;
