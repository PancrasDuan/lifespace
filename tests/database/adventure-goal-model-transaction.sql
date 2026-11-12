-- Four-table transaction fault probes; all rows and test triggers roll back.
begin;
create function pg_temp.adventure_transaction_failpoint() returns trigger language plpgsql as $$
begin
  if new.request_id in ('four-fail-complete','four-fail-cancel','four-fail-end','four-fail-achieve') then
    raise exception 'FOUR_TABLE_EVENT_FAILPOINT';
  end if;
  return new;
end $$;
create trigger adventure_transaction_failpoint before insert on public.adventure_events
  for each row execute function pg_temp.adventure_transaction_failpoint();
do $$
declare o uuid:=gen_random_uuid(); g uuid; t uuid; done uuid; r jsonb; c jsonb; today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  r:=public.adventure_planning_command(o,'four-create-goal',0,'{"type":"createGoal","title":"目标","standards":["标准"]}'); g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'four-create-task',1,jsonb_build_object('type','createTask','title','任务','description','','plannedOn',today,'destination',g)); t:=(r->'result'->>'entityId')::uuid;
  c:=jsonb_build_object('type','completeTask','id',t);
  begin
    perform public.adventure_planning_command(o,'four-fail-complete',2,c);
    raise exception 'completion fault was ignored';
  exception when others then if sqlerrm<>'FOUR_TABLE_EVENT_FAILPOINT' then raise; end if; end;
  if (select status from public.adventure_tasks where owner_id=o and id=t)<>'pending'
    or (select revision from public.adventure_accounts where owner_id=o)<>2
    or (select total_xp from public.adventure_accounts where owner_id=o)<>0
    or exists(select 1 from public.adventure_events where owner_id=o and request_id='four-fail-complete') then raise exception 'completion fault leaked'; end if;
  r:=public.adventure_planning_command(o,'four-complete',2,c); done:=(r->'result'->>'completionId')::uuid;
  begin
    perform public.adventure_planning_command(o,'four-fail-cancel',3,jsonb_build_object('type','cancelTaskCompletion','completionId',done));
    raise exception 'cancellation fault was ignored';
  exception when others then if sqlerrm<>'FOUR_TABLE_EVENT_FAILPOINT' then raise; end if; end;
  if (select status from public.adventure_tasks where owner_id=o and id=t)<>'completed'
    or (select invalidated_at from public.adventure_events where owner_id=o and id=done) is not null
    or (select revision from public.adventure_accounts where owner_id=o)<>3
    or (select total_xp from public.adventure_accounts where owner_id=o)<>1 then raise exception 'cancellation fault leaked'; end if;
  for c in select * from (values (jsonb_build_object('type','endGoal','id',g)),(jsonb_build_object('type','achieveGoal','id',g))) as commands(value) loop
    begin
      perform public.adventure_planning_command(o,case c->>'type' when 'endGoal' then 'four-fail-end' else 'four-fail-achieve' end,3,c);
      raise exception 'goal fault was ignored';
    exception when others then if sqlerrm<>'FOUR_TABLE_EVENT_FAILPOINT' then raise; end if; end;
    if (select status from public.adventure_goals where owner_id=o and id=g)<>'active'
      or (select revision from public.adventure_accounts where owner_id=o)<>3
      or (select total_xp from public.adventure_accounts where owner_id=o)<>1 then raise exception 'goal fault leaked'; end if;
  end loop;
  update public.adventure_accounts set total_xp=7 where owner_id=o;
  begin
    perform public.adventure_planning_command(o,'four-inconsistent-create',3,jsonb_build_object('type','createTask','title','不得保存','description','','plannedOn',today,'destination',''));
    raise exception 'inconsistent rewards accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if exists(select 1 from public.adventure_tasks where owner_id=o and title='不得保存')
    or exists(select 1 from public.adventure_events where owner_id=o and request_id='four-inconsistent-create')
    or (select revision from public.adventure_accounts where owner_id=o)<>3 then raise exception 'inconsistent rewards leaked writes'; end if;
end $$;
-- Historical amounts must survive current-rule preview and cancellation.
do $$
declare o uuid:=gen_random_uuid(); today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; t uuid; done uuid; r jsonb; page jsonb;
begin
  r:=public.adventure_planning_command(o,'four-frozen-create',0,jsonb_build_object('type','createTask','title','历史奖励','description','','plannedOn',today,'destination',''));
  t:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'four-frozen-complete',1,jsonb_build_object('type','completeTask','id',t));
  done:=(r->'result'->>'completionId')::uuid;
  update public.adventure_events set amount=3000000000,calculation=jsonb_set(calculation,'{coefficient}','3000000000') where owner_id=o and id=done;
  update public.adventure_accounts set total_xp=3000000000 where owner_id=o;
  page:=public.adventure_workspace_read(o);
  if page->'tasks'->0->'reward'->>'amount' is distinct from '3000000000'
    or page->'tasks'->0->'reward'->'calculation'->>'coefficient' is distinct from '3000000000' then raise exception 'historical reward recalculated'; end if;
  page:=public.adventure_planning_preview(o,2,jsonb_build_object('type','cancelTaskCompletion','completionId',done));
  if page->'growthAfter'->>'totalXp' is distinct from '0' or page->'reward'->>'amount' is distinct from '3000000000' then raise exception 'historical preview recalculated'; end if;
  r:=public.adventure_planning_command(o,'four-frozen-cancel',2,jsonb_build_object('type','cancelTaskCompletion','completionId',done));
  if r->'result'->'growthChange'->>'xpDelta' is distinct from '-3000000000' or r->'result'->'reward'->>'amount' is distinct from '3000000000'
    or (select total_xp from public.adventure_accounts where owner_id=o)<>0
    or not exists(select 1 from public.adventure_events where owner_id=o and id=done and amount=3000000000 and invalidated_at is not null)
    then raise exception 'historical cancellation recalculated'; end if;
end $$;
rollback;
