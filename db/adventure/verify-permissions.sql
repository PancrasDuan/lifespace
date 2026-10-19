-- 仅在新增迁移获授权且成功后执行。任何非预期结果抛错；事务回滚不保留测试行。
begin;
select set_config('adventure.probe_owner', gen_random_uuid()::text, true) is not null as probe_owner_prepared;
set local role anon;
do $$ begin
  begin perform owner_id from public.adventure_states limit 1; raise exception 'anon SELECT unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.adventure_states(owner_id,state) values(gen_random_uuid(),'{}'); raise exception 'anon INSERT unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin update public.adventure_states set version=version where false; raise exception 'anon UPDATE unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.adventure_states where false; raise exception 'anon DELETE unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform owner_id from public.adventure_states limit 1; raise exception 'authenticated SELECT unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.adventure_states(owner_id,state) values(gen_random_uuid(),'{}'); raise exception 'authenticated INSERT unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin update public.adventure_states set version=version where false; raise exception 'authenticated UPDATE unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.adventure_states where false; raise exception 'authenticated DELETE unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ declare affected integer; begin
  insert into public.adventure_states(owner_id,state) values(current_setting('adventure.probe_owner')::uuid,'{"probe":true}');
  update public.adventure_states set version=1, journal='{"probe":{"hash":"probe"}}' where owner_id=current_setting('adventure.probe_owner')::uuid and version=0;
  get diagnostics affected = row_count; if affected<>1 then raise exception 'CAS first write failed'; end if;
  update public.adventure_states set version=2 where owner_id=current_setting('adventure.probe_owner')::uuid and version=0;
  get diagnostics affected = row_count; if affected<>0 then raise exception 'CAS stale write succeeded'; end if;
  insert into public.adventure_states(owner_id,state,version) values(current_setting('adventure.probe_owner')::uuid,'{}',0) on conflict(owner_id) do nothing;
  if not exists(select 1 from public.adventure_states where owner_id=current_setting('adventure.probe_owner')::uuid and version=1 and state->>'probe'='true' and journal ? 'probe') then raise exception 'initialization overwrote state'; end if;
  begin delete from public.adventure_states where false; raise exception 'service_role DELETE unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select true as anon_all_four_denied, true as authenticated_all_four_denied, true as service_cas_and_ignore_duplicates_ok, true as probe_transaction_rolled_back;
