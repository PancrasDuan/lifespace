-- Read only. Run before/after migration; never prints hashes or credentials.
select current_database() database, current_setting('server_version') server_version;
select setting from pg_settings where name='pgrst.db_schemas';
select setdatabase, setrole, option from pg_db_role_setting cross join lateral unnest(setconfig) option where option like 'pgrst.db_schemas=%';
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='token_private' and c.relkind='r' order by c.relname;
select n.nspname,p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') anon,
 has_function_privilege('authenticated',p.oid,'execute') authenticated,
 has_function_privilege('service_role',p.oid,'execute') service_role
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='token_private' or (n.nspname='public' and p.proname like 'token_%') order by n.nspname,p.proname;
-- Dashboard/API exposed schemas is authoritative if no role-setting is returned.
-- Never expose token_private, even though direct table permissions are revoked.
