-- Isolated test runner only. Never install this helper in a business database.
-- Seeds genuine historical facts with the existing transactional task implementation;
-- assertions continue to read and act through the production Worker API.
create function public.adventure_test_history_seed(p_owner uuid,p_request_id text,p_expected_version bigint,p_command jsonb,p_occurred_on date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_revision bigint;
begin
  if p_owner is null or p_occurred_on is null
    or p_occurred_on >= (clock_timestamp() at time zone 'Asia/Shanghai')::date
    or p_command->>'type' not in ('createTask','completeTask') then raise exception 'INVALID_HISTORY_FIXTURE'; end if;
  insert into public.adventure_accounts(owner_id) values(p_owner) on conflict do nothing;
  select revision into strict v_revision from public.adventure_accounts where owner_id=p_owner for update;
  if v_revision<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  return public.adventure_task_apply(p_owner,p_request_id,v_revision,p_command,(p_occurred_on + time '12:00') at time zone 'Asia/Shanghai');
end $$;
revoke execute on function public.adventure_test_history_seed(uuid,text,bigint,jsonb,date) from public,anon,authenticated;
grant execute on function public.adventure_test_history_seed(uuid,text,bigint,jsonb,date) to service_role;
