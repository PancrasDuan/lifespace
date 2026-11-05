-- Forward-only #126 cleanup; run the entire reviewed file in one transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;
set local timezone = 'UTC';
lock table public.ledger_owner_revision in access exclusive mode;
lock table public.ledger_accounts in access exclusive mode;
lock table public.ledger_entries in access exclusive mode;
lock table public.ledger_balance_adjustments in access exclusive mode;

-- Keep the OID-independent catalog definition used to review the pre-cleanup
-- schema. UTC fixes timestamptz constraint rendering; no live hash is blessed.
do $cleanup$
declare
  catalog_sql constant text := $catalog$
with tables as (
  select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('ledger_owner_revision','ledger_accounts','ledger_entries','ledger_balance_adjustments')
), facts as (
  select 'table:'||relname as key, jsonb_build_array(relkind,relrowsecurity,relforcerowsecurity,
    pg_get_userbyid(relowner),relacl::text) as value from tables
  union all
  select 'column:'||t.relname||':'||a.attname, jsonb_build_array(a.attnum,
    format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid),a.attacl::text)
  from tables t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum
  union all
  select 'constraint:'||t.relname||':'||c.conname,
    jsonb_build_array(pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred)
  from tables t join pg_constraint c on c.conrelid=t.oid
  union all
  select 'index:'||t.relname||':'||i.relname,
    jsonb_build_array(pg_get_indexdef(x.indexrelid),x.indisvalid,x.indisready)
  from tables t join pg_index x on x.indrelid=t.oid join pg_class i on i.oid=x.indexrelid
  union all
  select 'trigger:'||t.relname||':'||regexp_replace(g.tgname,'(RI_ConstraintTrigger_[ac])_[0-9]+','\1')||':'||g.tgtype||':'||coalesce((select conrelid::regclass::text||':'||conname from pg_constraint where oid=g.tgconstraint),''),
    jsonb_build_array(regexp_replace(pg_get_triggerdef(g.oid),'(RI_ConstraintTrigger_[ac])_[0-9]+','\1'),g.tgenabled)
  from tables t join pg_trigger g on g.tgrelid=t.oid
  union all
  select 'policy:'||t.relname||':'||p.polname,
    jsonb_build_array(p.polcmd,p.polpermissive,
      (select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by case when r=0 then 'public' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
  from tables t join pg_policy p on p.polrelid=t.oid
  union all
  select 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_array(regexp_replace(p.prosrc,'\s+',' ','g'),l.lanname,
      pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),
      p.prokind,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
      pg_get_userbyid(p.proowner),p.proacl::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.proname like 'ledger\_%' escape '\'
)
select encode(sha256(convert_to(jsonb_object_agg(key,value)::text,'UTF8')),'hex') as catalog_hash from facts
$catalog$;
  data_sql constant text := $data$
select encode(sha256(convert_to(jsonb_build_object(
    'owners',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.ledger_owner_revision t),
    'accounts',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_accounts t),
    'entries',(select jsonb_agg(to_jsonb(t)-'account_name' order by id) from public.ledger_entries t),
    'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_balance_adjustments t)
  )::text,'UTF8')),'hex')
$data$;
  catalog_hash text;
  data_before text;
  data_after text;
  immutable_ddl text;
begin
  -- Repeated/unknown results require read-only catalog/history reconciliation.
  if not exists(select from pg_attribute where attrelid='public.ledger_entries'::regclass
    and attname='account_name' and not attisdropped) then
    raise exception 'ACCOUNT_NAME_CLEANUP_STATE';
  end if;
  if exists(select from public.ledger_entries where account_name is not null or account_id is null) then
    raise exception 'ACCOUNT_NAME_CLEANUP_LEGACY_DATA';
  end if;
  execute catalog_sql into catalog_hash;
  if catalog_hash is distinct from '04898ad1a371ac32cb793acbf9aeaa93631d41a1d9acebcfd0c05e0e42e21e9c' then
    raise exception 'ACCOUNT_NAME_CLEANUP_CATALOG_DRIFT';
  end if;
  -- RESTRICT still drops AUTO dependents, including extended statistics whose
  -- expressions may reference the column without listing it in stxkeys.
  -- Allow only the two reviewed CHECK objects; do not rely on the catalog hash
  -- to enumerate every object class that PostgreSQL can remove with this column.
  if exists(select from pg_depend d
    where d.refclassid='pg_class'::regclass and d.refobjid='public.ledger_entries'::regclass
      and d.refobjsubid=(select attnum from pg_attribute
        where attrelid=d.refobjid and attname='account_name' and not attisdropped)
      and not (d.classid='pg_constraint'::regclass and d.objsubid=0 and d.deptype in ('a','n')
        and exists(select from pg_constraint c where c.oid=d.objid
          and c.conrelid=d.refobjid and c.contype='c'
          and c.conname in ('ledger_entries_account_name_check','ledger_entries_account_name_snapshot')))) then
    raise exception 'ACCOUNT_NAME_CLEANUP_DEPENDENCY';
  end if;
  execute data_sql into data_before;

  -- Reuse the complete existing definition so auxiliary properties (including
  -- cost), owner and ACL stay intact. Only the two obsolete record fields change.
  select replace(replace(pg_get_functiondef('public.ledger_entry_immutable()'::regprocedure),
    'new.account_name,',''),'old.account_name,','') into immutable_ddl;
  execute immutable_ddl;
  alter table public.ledger_entries drop constraint ledger_entries_account_name_check restrict;
  alter table public.ledger_entries drop constraint ledger_entries_account_name_snapshot restrict;
  alter table public.ledger_entries alter column account_id set not null;
  alter table public.ledger_entries drop column account_name restrict;

  execute data_sql into data_after;
  if data_after is distinct from data_before then raise exception 'ACCOUNT_NAME_CLEANUP_DATA_CHANGED'; end if;
  execute catalog_sql into catalog_hash;
  if catalog_hash is distinct from 'a022cf8559153d2dcdbf9810a212138cd61595d29dac0054bf565f462a9fe272' then
    raise exception 'ACCOUNT_NAME_CLEANUP_POSTCONDITION';
  end if;
end $cleanup$;
commit;
