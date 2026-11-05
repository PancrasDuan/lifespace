-- Current final schema; synthetic probes always roll back. Business assertions
-- run through Worker HTTP, while physical retention/ACL have no public read API.
begin;
do $$
declare o uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); a uuid; b uuid;
  p uuid; c uuid; receipt jsonb; before_parent jsonb; before_child jsonb;
  field text; value text; role_name text; fn text;
begin
  if exists(select from pg_attribute where attrelid='public.ledger_entries'::regclass
    and attname='account_name' and not attisdropped) then raise exception 'LEGACY_COLUMN_REMAINS'; end if;
  if not exists(select from pg_attribute where attrelid='public.ledger_entries'::regclass
    and attname='account_id' and attnotnull) then raise exception 'ACCOUNT_ID_NULLABLE'; end if;
  if exists(select from pg_constraint where conrelid='public.ledger_entries'::regclass
    and conname in ('ledger_entries_account_name_check','ledger_entries_account_name_snapshot')) then raise exception 'LEGACY_CHECK_REMAINS'; end if;
  if exists(select from pg_tables where schemaname='public' and tablename like 'ledger_%' and not rowsecurity)
    or (select count(*) from pg_tables where schemaname='public' and tablename like 'ledger_%')<>4 then raise exception 'FOUR_RLS_TABLES_REQUIRED'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(role_name,'public.ledger_entries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege(role_name,'public.ledger_owner_revision','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'DIRECT_LEDGER_ACCESS'; end if;
    if has_function_privilege(role_name,'public.ledger_entry_immutable()','EXECUTE') then raise exception 'IMMUTABLE_HELPER_EXPOSED'; end if;
    foreach fn in array array['ledger_create(uuid,jsonb)','ledger_list(uuid,integer,date,date,bigint)','ledger_detail(uuid,uuid,bigint,bigint)','ledger_refund(uuid,uuid,jsonb)','ledger_delete_preview(uuid,uuid)','ledger_delete(uuid,uuid,text)'] loop
      if has_function_privilege(role_name,'public.'||fn,'EXECUTE')<>(role_name='service_role') then raise exception 'LEDGER_RPC_ACL'; end if;
    end loop;
  end loop;
  a:=(public.ledger_account_create(o,jsonb_build_object('requestId',gen_random_uuid(),'name','合成账户','balanceCents',10000))->>'accountId')::uuid;
  b:=(public.ledger_account_create(other,jsonb_build_object('requestId',gen_random_uuid(),'name','合成另一所有者','balanceCents',0))->>'accountId')::uuid;
  p:=(public.ledger_create(o,jsonb_build_object('requestId',gen_random_uuid(),'direction','expense','amountCents',-1000,'occurredAt','2025-01-01T00:00:00Z','accountId',a,'categoryCode','dining','note','合成原文'))->>'entryId')::uuid;
  c:=(public.ledger_refund(o,p,jsonb_build_object('requestId',gen_random_uuid(),'amountCents',100,'occurredAt','2025-01-02T00:00:00Z','note','合成退款'))->>'entryId')::uuid;
  -- Every original immutable field must still reject change after the drop.
  for field,value in select * from (values
    ('id','gen_random_uuid()'),('owner_id','gen_random_uuid()'),('request_id','gen_random_uuid()'),
    ('direction',quote_literal('income')),('amount_cents','-2'),('occurred_at',quote_literal('2025-01-03T00:00:00Z')),
    ('account_id',quote_literal(b)),('transfer_id','gen_random_uuid()'),('category_code',quote_literal('other_expense')),
    ('note',quote_literal('被改写')),('parent_entry_id','gen_random_uuid()'),('created_at',quote_literal('2020-01-01T00:00:00Z'))) changes loop
    begin
      execute format('update public.ledger_entries set %I=%s where id=$1',field,value) using p;
      raise exception 'IMMUTABLE_FIELD_ALLOWED:%',field;
    exception when check_violation then if sqlerrm<>'LEDGER_IMMUTABLE' then raise; end if; end;
  end loop;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code)
      values(o,gen_random_uuid(),'expense',-1,'2025-01-01T00:00:00Z',null,'dining');
    raise exception 'NULL_ACCOUNT_ALLOWED'; exception when not_null_violation then null; end;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code)
      values(o,gen_random_uuid(),'expense',-1,'2025-01-01T00:00:00Z',b,'dining');
    raise exception 'CROSS_OWNER_ACCOUNT_ALLOWED'; exception when foreign_key_violation then null; end;
  begin
    insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,parent_entry_id)
      values(other,gen_random_uuid(),'income',1,'2025-01-01T00:00:00Z',b,'dining',p);
    raise exception 'CROSS_OWNER_PARENT_ALLOWED'; exception when foreign_key_violation then null; end;
  select to_jsonb(e)-'deleted_at' into before_parent from public.ledger_entries e where id=p;
  select to_jsonb(e)-'deleted_at' into before_child from public.ledger_entries e where id=c;
  receipt:=public.ledger_delete_preview(o,p);
  perform public.ledger_delete(o,p,receipt->>'scope');
  if (select count(*) from public.ledger_entries where owner_id=o and deleted_at is not null)<>2
    or (select count(distinct deleted_at) from public.ledger_entries where owner_id=o)<>1
    or (select to_jsonb(e)-'deleted_at' from public.ledger_entries e where id=p)<>before_parent
    or (select to_jsonb(e)-'deleted_at' from public.ledger_entries e where id=c)<>before_child then raise exception 'DELETION_CHANGED_FACTS'; end if;
  begin update public.ledger_entries set deleted_at=null where id=p;
    raise exception 'RESTORE_ALLOWED'; exception when check_violation then if sqlerrm<>'LEDGER_IMMUTABLE' then raise; end if; end;
  begin delete from public.ledger_entries where id=c;
    raise exception 'PHYSICAL_DELETE_ALLOWED'; exception when check_violation then if sqlerrm<>'LEDGER_IMMUTABLE' then raise; end if; end;
end $$;
rollback;
