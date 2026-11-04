-- Read-only fingerprint, independent of database OIDs. Compare a reviewed clean
-- installation with the target before rendering; never bless an unknown live hash.
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
select encode(sha256(convert_to(jsonb_object_agg(key,value)::text,'UTF8')),'hex') as catalog_hash from facts;
