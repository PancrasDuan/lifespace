-- Synthetic data only. Exercise the same public database RPCs on an isolated,
-- freshly initialized or upgraded database; the transaction leaves no rows.
begin;
create function pg_temp.goal_rpc_failpoint() returns trigger language plpgsql as $$
begin
  if new.kind='task_completed' and new.snapshot->>'title'='合成完成故障' then raise exception 'SYNTHETIC_COMPLETION_FAILPOINT'; end if;
  if new.kind='task_completion_cancelled' and new.snapshot->>'title'='合成取消故障' then raise exception 'SYNTHETIC_CANCELLATION_FAILPOINT'; end if;
  if new.kind='goal_achieved' and new.snapshot->>'title'='合成达成故障' then raise exception 'SYNTHETIC_ACHIEVEMENT_FAILPOINT'; end if;
  return new;
end $$;
create trigger goal_rpc_failpoint before insert on public.adventure_events for each row execute function pg_temp.goal_rpc_failpoint();
create function pg_temp.goal_end_failpoint() returns trigger language plpgsql as $$
begin
  if new.status='ended' and new.title='合成结束故障' then raise exception 'SYNTHETIC_END_FAILPOINT'; end if;
  return new;
end $$;
create trigger goal_end_failpoint before update on public.adventure_goals for each row execute function pg_temp.goal_end_failpoint();
do $$
declare
  o uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  ga uuid; gb uuid; t uuid; action uuid; completion uuid; cancelled uuid; again uuid; failtask uuid; failgoal uuid;
  rev bigint:=0; r jsonb; receipt jsonb; historical_receipt jsonb; result jsonb; before_account jsonb; before_task jsonb; old_count bigint; old_xp bigint; cmd jsonb;
begin
  result:=public.adventure_planning_preview(o,0,'{"type":"createGoal","title":"预览","standards":["标准"]}');
  if not (result->>'allowed')::boolean or exists(select 1 from public.adventure_accounts where owner_id=o) then raise exception 'preview wrote an account'; end if;
  r:=public.adventure_planning_command(o,'reg-goal-a',rev,'{"type":"createGoal","title":"目标甲","standards":["完成甲"],"categoryLabel":"主题甲"}'); rev:=rev+1; ga:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-goal-b',rev,'{"type":"createGoal","title":"目标乙","standards":["完成乙"],"categoryLabel":"主题乙"}'); rev:=rev+1; gb:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-create-task',rev,jsonb_build_object('type','createTask','title','迁移任务','description','原说明','destination',ga,'plannedOn',today)); rev:=rev+1; t:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-edit-task',rev,jsonb_build_object('type','editTask','id',t,'title','迁移任务','description','原说明','destination',gb,'plannedOn',today)); rev:=rev+1;
  if not exists(select 1 from public.adventure_tasks where owner_id=o and id=t and goal_id=gb)
    or not exists(select 1 from public.adventure_events where owner_id=o and task_id=t and kind='task_migrated' and snapshot->'origin'->>'goalId'=ga::text) then raise exception 'task edit did not preserve identity and origin'; end if;
  r:=public.adventure_planning_command(o,'reg-edit-date',rev,jsonb_build_object('type','editTask','id',t,'title','迁移任务','description','原说明','destination',gb,'plannedOn',today+1)); rev:=rev+1;
  r:=public.adventure_planning_command(o,'reg-restore-date',rev,jsonb_build_object('type','editTask','id',t,'title','迁移任务','description','原说明','destination',gb,'plannedOn',today)); rev:=rev+1;
  result:=public.adventure_task_history(o,t,1);
  if (result->>'total')::integer<>3 or not exists(select 1 from public.adventure_events where owner_id=o and task_id=t and kind='task_rescheduled') then raise exception 'date edit lost history'; end if;
  begin perform public.adventure_planning_command(o,'reg-block-achieve',rev,jsonb_build_object('type','achieveGoal','id',gb)); raise exception 'pending goal achieved';
  exception when others then if sqlerrm<>'PENDING_TASKS' then raise; end if; end;
  begin perform public.adventure_planning_command(o,'reg-block-end',rev,jsonb_build_object('type','endGoal','id',gb)); raise exception 'pending goal ended';
  exception when others then if sqlerrm<>'PENDING_TASKS' then raise; end if; end;
  r:=public.adventure_planning_command(o,'reg-source-task',rev,jsonb_build_object('type','createTask','title','甲行动','description','冻结说明','destination',ga,'plannedOn',today)); rev:=rev+1; action:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-source-done',rev,jsonb_build_object('type','completeTask','id',action)); rev:=rev+1; completion:=(r->'result'->>'completionId')::uuid;
  r:=public.adventure_planning_command(o,'reg-achieve-a',rev,jsonb_build_object('type','achieveGoal','id',ga,'coefficient',3,'reflection','完成')); rev:=rev+1;
  if (r->'result'->'reward'->>'amount')::bigint<>3 or (select total_xp from public.adventure_accounts where owner_id=o)<>4
    or not exists(select 1 from public.adventure_events where owner_id=o and kind='goal_achieved' and goal_id=ga
      and snapshot->'actionSources'->0->>'completionId'=completion::text and snapshot->'actionSources'->0->'source'->>'description'='冻结说明')
    then raise exception 'achievement reward or source changed'; end if;
  begin perform public.adventure_planning_command(o,'reg-terminal-cancel',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',completion)); raise exception 'terminal history unlocked';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  begin perform public.adventure_planning_command(other,'reg-other-edit',0,jsonb_build_object('type','editGoal','id',gb,'title','越权','standards',jsonb_build_array('完成'))); raise exception 'cross owner edit accepted';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  r:=public.adventure_planning_command(o,'reg-complete-b',rev,jsonb_build_object('type','completeTask','id',t)); rev:=rev+1; receipt:=r; cancelled:=(r->'result'->>'completionId')::uuid;
  result:=public.adventure_planning_preview(o,rev,jsonb_build_object('type','cancelTaskCompletion','completionId',cancelled));
  if result->'reward'->>'amount'<>'1' or result->'growthAfter'->>'totalXp'<>'4' then raise exception 'cancellation preview changed reward'; end if;
  r:=public.adventure_planning_command(o,'reg-cancel-b',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',cancelled)); rev:=rev+1;
  if (select total_xp from public.adventure_accounts where owner_id=o)<>4 or not exists(select 1 from public.adventure_events where id=cancelled and invalidated_at is not null and amount=1)
    then raise exception 'cancellation erased frozen reward'; end if;
  if public.adventure_planning_command(o,'reg-complete-b',0,jsonb_build_object('type','completeTask','id',t))<>receipt then raise exception 'invalidated receipt did not replay'; end if;
  r:=public.adventure_planning_command(o,'reg-recomplete-b',rev,jsonb_build_object('type','completeTask','id',t)); rev:=rev+1; again:=(r->'result'->>'completionId')::uuid;
  if again=cancelled or (select total_xp from public.adventure_accounts where owner_id=o)<>5 then raise exception 'recompletion reused history'; end if;
  begin perform public.adventure_planning_command(o,'reg-cancel-old',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',cancelled)); raise exception 'invalidated completion cancelled twice';
  exception when others then if sqlerrm<>'COMPLETION_CHANGED' then raise; end if; end;
  result:=public.adventure_task_list(o,today,'all',rev,today,1);
  if (result->'progress'->>'completed')::integer<>2 or (result->'progress'->>'total')::integer<>2 then raise exception 'date-list progress differs'; end if;
  update public.adventure_goals set focused=true where owner_id=o and id=gb;
  result:=public.adventure_task_list(o,today,'focus',rev,today,1);
  if (result->>'total')::integer<>1 or result->'tasks'->0->>'id'<>t::text then raise exception 'focused date-list scope differs'; end if;
  update public.adventure_goals set focused=false where owner_id=o and id=gb;
  result:=public.adventure_growth_read(o,rev,null);
  if result->'growth'->>'totalXp'<>'5' or result->'growth'->>'actions'<>'2' or (result->>'total')::integer<>3 then raise exception 'growth differs from frozen rewards'; end if;
  result:=public.adventure_reward_source(o,(select id from public.adventure_events where owner_id=o and kind='goal_achieved' and goal_id=ga),1,rev);
  if result->'actionSources'->0->>'completionId'<>completion::text then raise exception 'growth source missing'; end if;
  r:=public.adventure_planning_command(o,'reg-fail-task',rev,jsonb_build_object('type','createTask','title','合成完成故障','description','','destination',gb,'plannedOn',today)); rev:=rev+1; failtask:=(r->'result'->>'entityId')::uuid;
  select to_jsonb(a) into before_account from public.adventure_accounts a where owner_id=o;
  select to_jsonb(x) into before_task from public.adventure_tasks x where owner_id=o and id=failtask;
  select count(*) into old_count from public.adventure_events where owner_id=o;
  begin perform public.adventure_planning_command(o,'reg-fail-done',rev,jsonb_build_object('type','completeTask','id',failtask)); raise exception 'completion fault ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_COMPLETION_FAILPOINT' then raise; end if; end;
  if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account or (select to_jsonb(x) from public.adventure_tasks x where owner_id=o and id=failtask)<>before_task
    or (select count(*) from public.adventure_events where owner_id=o)<>old_count then raise exception 'completion failure persisted partial facts'; end if;
  r:=public.adventure_planning_command(o,'reg-fail-delete',rev,jsonb_build_object('type','deleteTask','id',failtask)); rev:=rev+1;
  r:=public.adventure_planning_command(o,'reg-cancel-fail-task',rev,jsonb_build_object('type','createTask','title','合成取消故障','description','','destination',gb,'plannedOn',today)); rev:=rev+1; failtask:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-cancel-fail-done',rev,jsonb_build_object('type','completeTask','id',failtask)); rev:=rev+1; completion:=(r->'result'->>'completionId')::uuid;
  historical_receipt:=r;
  select to_jsonb(a) into before_account from public.adventure_accounts a where owner_id=o;
  select to_jsonb(x) into before_task from public.adventure_tasks x where owner_id=o and id=failtask;
  select count(*) into old_count from public.adventure_events where owner_id=o;
  begin perform public.adventure_planning_command(o,'reg-cancel-fail',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',completion)); raise exception 'cancellation fault ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_CANCELLATION_FAILPOINT' then raise; end if; end;
  if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account or (select to_jsonb(x) from public.adventure_tasks x where owner_id=o and id=failtask)<>before_task
    or (select count(*) from public.adventure_events where owner_id=o)<>old_count or (select invalidated_at from public.adventure_events where id=completion) is not null
    then raise exception 'cancellation failure persisted partial facts'; end if;
  update public.adventure_events set occurred_on=today-1,occurred_at=((today-1)+time '12:00') at time zone 'Asia/Shanghai' where owner_id=o and id=completion;
  update public.adventure_tasks set completed_on=today-1,completed_at=((today-1)+time '12:00') at time zone 'Asia/Shanghai' where owner_id=o and id=failtask;
  begin perform public.adventure_planning_command(o,'reg-past-cancel',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',completion)); raise exception 'past completion cancelled';
  exception when others then if sqlerrm<>'DATE_LOCKED' then raise; end if; end;
  if public.adventure_planning_command(o,'reg-cancel-fail-done',0,jsonb_build_object('type','completeTask','id',failtask))<>historical_receipt then raise exception 'past completion receipt changed'; end if;
  r:=public.adventure_planning_command(o,'reg-fail-goal',rev,'{"type":"createGoal","title":"合成结束故障","standards":["完成"]}'); rev:=rev+1; failgoal:=(r->'result'->>'entityId')::uuid;
  select to_jsonb(a) into before_account from public.adventure_accounts a where owner_id=o;
  select count(*) into old_count from public.adventure_events where owner_id=o;
  begin perform public.adventure_planning_command(o,'reg-fail-end',rev,jsonb_build_object('type','endGoal','id',failgoal)); raise exception 'goal failure ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_END_FAILPOINT' then raise; end if; end;
  if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account or (select status from public.adventure_goals where owner_id=o and id=failgoal)<>'active'
    or (select count(*) from public.adventure_events where owner_id=o)<>old_count then raise exception 'end failure persisted partial facts'; end if;
  r:=public.adventure_planning_command(o,'reg-fail-achieve-goal',rev,'{"type":"createGoal","title":"合成达成故障","standards":["完成"]}'); rev:=rev+1; failgoal:=(r->'result'->>'entityId')::uuid;
  select to_jsonb(a) into before_account from public.adventure_accounts a where owner_id=o;
  select count(*) into old_count from public.adventure_events where owner_id=o;
  begin perform public.adventure_planning_command(o,'reg-fail-achieve',rev,jsonb_build_object('type','achieveGoal','id',failgoal)); raise exception 'achievement failure ignored';
  exception when others then if sqlerrm<>'SYNTHETIC_ACHIEVEMENT_FAILPOINT' then raise; end if; end;
  if (select to_jsonb(a) from public.adventure_accounts a where owner_id=o)<>before_account or (select status from public.adventure_goals where owner_id=o and id=failgoal)<>'active'
    or (select count(*) from public.adventure_events where owner_id=o)<>old_count then raise exception 'achievement failure persisted partial facts'; end if;
  r:=public.adventure_planning_command(o,'reg-frozen-task',rev,jsonb_build_object('type','createTask','title','旧规则奖励','description','','destination',failgoal,'plannedOn',today)); rev:=rev+1; failtask:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'reg-frozen-complete',rev,jsonb_build_object('type','completeTask','id',failtask)); rev:=rev+1; completion:=(r->'result'->>'completionId')::uuid;
  update public.adventure_events set amount=3000000000,calculation=jsonb_build_object('type','fixed_task','completionId',completion,'count',1,'coefficient',3000000000)
    where owner_id=o and id=completion;
  update public.adventure_accounts set total_xp=total_xp+2999999999 where owner_id=o;
  select total_xp-3000000000 into old_xp from public.adventure_accounts where owner_id=o;
  result:=public.adventure_planning_preview(o,rev,jsonb_build_object('type','cancelTaskCompletion','completionId',completion));
  if (result->'reward'->>'amount')::bigint<>3000000000 or (result->'growthAfter'->>'totalXp')::bigint<>old_xp then raise exception 'preview recalculated frozen historical reward'; end if;
  r:=public.adventure_planning_command(o,'reg-frozen-cancel',rev,jsonb_build_object('type','cancelTaskCompletion','completionId',completion)); rev:=rev+1;
  if (r->'result'->'reward'->>'amount')::bigint<>3000000000 or (select total_xp from public.adventure_accounts where owner_id=o)<>old_xp
    or not exists(select 1 from public.adventure_events where id=completion and amount=3000000000 and invalidated_at is not null)
    then raise exception 'cancellation recalculated frozen historical reward'; end if;
  r:=public.adventure_planning_command(o,'reg-achieve-b',rev,jsonb_build_object('type','achieveGoal','id',gb)); rev:=rev+1;
  if (r->'result'->'reward'->>'amount')::bigint<>2 then raise exception 'goal reward action count differs'; end if;
  begin perform public.adventure_planning_command(o,'reg-achieve-twice',rev,jsonb_build_object('type','achieveGoal','id',gb)); raise exception 'achieved twice';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  cmd:=jsonb_build_object('type','createGoal','title','并发版本','standards',jsonb_build_array('标准'));
  begin perform public.adventure_planning_command(o,'reg-stale',0,cmd); raise exception 'stale version accepted';
  exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
  begin perform public.adventure_planning_command(o,'reg-complete-b',0,jsonb_build_object('type','completeTask','id',action)); raise exception 'reused key accepted';
  exception when others then if sqlerrm<>'REQUEST_ID_REUSED' then raise; end if; end;
  update public.adventure_accounts set total_xp=total_xp+1 where owner_id=o;
  select count(*) into old_count from public.adventure_events where owner_id=o;
  begin perform public.adventure_growth_read(o,rev,null); raise exception 'inconsistent growth accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  begin perform public.adventure_planning_command(o,'reg-inconsistent',rev,cmd); raise exception 'inconsistent write accepted';
  exception when others then if sqlerrm<>'INCONSISTENT_REWARDS' then raise; end if; end;
  if (select count(*) from public.adventure_events where owner_id=o)<>old_count or exists(select 1 from public.adventure_goals where owner_id=o and title='并发版本')
    or (select revision from public.adventure_accounts where owner_id=o)<>rev then raise exception 'inconsistent write persisted partial facts'; end if;
end $$;
-- Older history can retain a completion's original goal after the task's
-- current goal changed under a former rule. Keep the two projections distinct.
do $$
declare o uuid:=gen_random_uuid(); today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  ga uuid; gb uuid; ta uuid; tb uuid; ea uuid; eb uuid; r jsonb; preview jsonb; detail jsonb; achieved jsonb;
begin
  r:=public.adventure_planning_command(o,'history-goal-a',0,'{"type":"createGoal","title":"历史甲","standards":["标准"]}'); ga:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'history-goal-b',1,'{"type":"createGoal","title":"历史乙","standards":["标准"]}'); gb:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'history-task-a',2,jsonb_build_object('type','createTask','title','甲时完成','description','原说明','destination',ga,'plannedOn',today)); ta:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'history-done-a',3,jsonb_build_object('type','completeTask','id',ta)); ea:=(r->'result'->>'completionId')::uuid;
  r:=public.adventure_planning_command(o,'history-task-b',4,jsonb_build_object('type','createTask','title','乙时完成','description','','destination',gb,'plannedOn',today)); tb:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'history-done-b',5,jsonb_build_object('type','completeTask','id',tb)); eb:=(r->'result'->>'completionId')::uuid;
  update public.adventure_tasks set goal_id=case when id=ta then gb else ga end where owner_id=o and id in (ta,tb);
  preview:=public.adventure_planning_preview(o,6,jsonb_build_object('type','achieveGoal','id',ga));
  if preview->'rewards'->2->'calculation'->'actionIds'<>jsonb_build_array(ta) or preview->'rewards'->2->>'amount'<>'3'
    then raise exception 'achievement preview ignored frozen historical attribution'; end if;
  achieved:=public.adventure_planning_command(o,'history-achieve-a',6,jsonb_build_object('type','achieveGoal','id',ga,'coefficient',3,'reflection','保留'));
  detail:=public.adventure_workspace_read(o,1,20,'today',1,'all','',ga,1,true);
  if detail->'goalDetail'->>'totalTasks'<>'2'
    or not (detail->'goalDetail'->'tasks' @> jsonb_build_array(jsonb_build_object('id',ta,'goalId',gb,
      'completionId',ea,'reward',jsonb_build_object('amount',1),
      'completionOrigin',jsonb_build_object('goalId',ga,'title','甲时完成','description','原说明'))))
    or not (detail->'goalDetail'->'tasks' @> jsonb_build_array(jsonb_build_object('id',tb)))
    or detail->'goalDetail'->>'totalRelatedTasks'<>'1'
    or detail->'goalDetail'->'relatedTasks'->0->>'id'<>tb::text
    or not exists(select 1 from public.adventure_goals where owner_id=o and id=ga and attainment_action_ids=array[ta]
      and attainment_snapshot->'actionSources'->0->>'completionId'=ea::text)
    or (select total_xp from public.adventure_accounts where owner_id=o)<>5
    then raise exception 'current task projection replaced historical sources'; end if;
  begin perform public.adventure_planning_command(o,'history-deny-old',7,jsonb_build_object('type','cancelTaskCompletion','completionId',ea)); raise exception 'historical terminal source unlocked';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  begin perform public.adventure_planning_command(o,'history-deny-current',7,jsonb_build_object('type','cancelTaskCompletion','completionId',eb)); raise exception 'current terminal source unlocked';
  exception when others then if sqlerrm<>'READ_ONLY' then raise; end if; end;
  if public.adventure_planning_command(o,'history-achieve-a',0,jsonb_build_object('type','achieveGoal','id',ga,'coefficient',3,'reflection','保留'))<>achieved
    then raise exception 'achievement receipt changed'; end if;
end $$;
-- Exercise current-relationship exclusions and pagination with historical
-- ended/deleted fixtures; all rows remain inside this rolled-back transaction.
do $$
declare o uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  g uuid; pending_id uuid; completed_id uuid; r jsonb; first_page jsonb; second_page jsonb;
begin
  r:=public.adventure_planning_command(o,'relations-goal',0,'{"type":"createGoal","title":"关系","standards":["标准"]}'); g:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'relations-pending',1,jsonb_build_object('type','createTask','title','待完成','description','','destination',g,'plannedOn',today)); pending_id:=(r->'result'->>'entityId')::uuid;
  r:=public.adventure_planning_command(o,'relations-completed',2,jsonb_build_object('type','createTask','title','已完成','description','','destination',g,'plannedOn',today)); completed_id:=(r->'result'->>'entityId')::uuid;
  perform public.adventure_planning_command(o,'relations-done',3,jsonb_build_object('type','completeTask','id',completed_id));
  insert into public.adventure_tasks(owner_id,goal_id,title,planned_on,status,ended_at,end_cause)
    values(o,g,'历史已结束',today,'ended',now(),'historical_ended');
  insert into public.adventure_tasks(owner_id,goal_id,title,planned_on,deleted_at)
    values(o,g,'已删除',today,now());
  first_page:=public.adventure_workspace_read(o,1,1,'today',1,'all','',g,1,true);
  second_page:=public.adventure_workspace_read(o,1,1,'today',1,'all','',g,2,true);
  if first_page->'goalDetail'->>'totalRelatedTasks'<>'2' or second_page->'goalDetail'->>'totalRelatedTasks'<>'2'
    or jsonb_array_length(first_page->'goalDetail'->'relatedTasks')<>1 or jsonb_array_length(second_page->'goalDetail'->'relatedTasks')<>1
    or not ((first_page->'goalDetail'->'relatedTasks'||second_page->'goalDetail'->'relatedTasks') @> jsonb_build_array(jsonb_build_object('id',pending_id,'completedAt',null)))
    or not ((first_page->'goalDetail'->'relatedTasks'||second_page->'goalDetail'->'relatedTasks') @> jsonb_build_array(jsonb_build_object('id',completed_id)))
    then raise exception 'current relationship exclusions or pagination incorrect'; end if;
  begin perform public.adventure_workspace_read(other_owner,1,1,'today',1,'all','',g,1,true); raise exception 'other owner saw goal';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
end $$;
rollback;
