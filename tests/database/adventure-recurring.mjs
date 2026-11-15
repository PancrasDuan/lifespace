// Disposable PostgreSQL only. Clock injection is installed by this suite, never by the migration.
export async function verifyRecurring({client:c,connect,command,today,assert}) {
 let tests=0
 const test=async(name,run)=>{await run();tests++;console.log(`PASS SQL: ${name}`)}
 const query=async(sql,args=[]) => (await c.query(sql,args)).rows[0]?.r
 const owner=crypto.randomUUID();let revision=0,serial=0
 const send=async(value)=>{const r=await command(c,owner,`recurring-${++serial}`,revision,value);revision=r.version;return r}
 const create=(requiredCount=5,destination='',startOn=today,periodType='week')=>send({type:'createRecurringTask',title:'每周行动',description:'说明',periodType,startOn,requiredCount,destination,today})
 const parent=id=>query('select public.adventure_recurring_parent_view($1,$2,$3) r',[owner,id,today])
 const record=id=>send({type:'recordRecurringCompletion',id,today})
 const edit=(id,requiredCount,extra={})=>send({type:'editRecurringTask',id,title:'新名称',description:'新说明',requiredCount,today,...extra})
 const cancel=completionId=>send({type:'cancelRecurringCompletion',completionId,today})
 const state=()=>query(`select jsonb_build_object('a',(select to_jsonb(x) from public.adventure_accounts x where owner_id=$1),'p',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_recurring_tasks x where owner_id=$1),'t',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_tasks x where owner_id=$1),'e',(select jsonb_agg(to_jsonb(x) order by id) from public.adventure_events x where owner_id=$1)) r`,[owner])
 const rejects=async(value,error)=>{const before=await state();await assert.rejects(send(value),{message:error});assert.deepEqual(await state(),before)}
 await test('original month-end/leap/quarter/year anchors, Wednesday weeks and constant long jump',async()=>{
  for(const [anchor,type,day,expected] of [
   ['2024-01-31','month','2024-02-29',{number:2,startOn:'2024-02-29',endOn:'2024-03-30'}],
   ['2024-01-31','month','2024-03-31',{number:3,startOn:'2024-03-31',endOn:'2024-04-29'}],
   ['2024-02-29','year','2025-02-28',{number:2,startOn:'2025-02-28',endOn:'2026-02-27'}],
   ['2024-02-29','year','2028-02-29',{number:5,startOn:'2028-02-29',endOn:'2029-02-27'}],
   ['2024-01-31','quarter','2024-04-30',{number:2,startOn:'2024-04-30',endOn:'2024-07-30'}],
   ['2026-11-11','week','2026-11-17',{number:1,startOn:'2026-11-11',endOn:'2026-11-17'}],
   ['2026-11-11','week','2026-11-18',{number:2,startOn:'2026-11-18',endOn:'2026-11-24'}],
   ['0001-01-31','month','9998-12-31',{number:119976,startOn:'9998-12-31',endOn:'9999-01-30'}],
  ]) assert.deepEqual(await query('select public.adventure_recurring_period($1,$2,$3) r',[anchor,type,day]),expected)
  assert.equal(await query("select public.adventure_recurring_period('2026-12-01','month','2026-11-30') r"),null)
  for(const type of ['week','month','quarter','year']) await assert.rejects(query('select public.adventure_recurring_period($1,$2,$1) r',['9999-12-31',type]),/CAPACITY_REACHED$/)
 })
 let id,children=[]
 await test('4/5 down to 4/3 preserves immutable snapshots, one contribution, higher requirement and cancellation reverse it',async()=>{
  id=(await create()).result.entityId
  for(let i=0;i<4;i++) children.push(await record(id))
  const frozen=await query('select snapshot r from public.adventure_events where id=$1',[children[0].result.completionId])
  assert.equal((await parent(id)).completedPeriods,0)
  await edit(id,3)
  assert.deepEqual((await parent(id)).currentPeriod,{number:1,startOn:today,endOn:await query('select to_char($1::date+6,\'YYYY-MM-DD\') r',[today]),completed:4,required:3,satisfied:true,ratio:1})
  assert.equal((await parent(id)).completedPeriods,1)
  await rejects({type:'recordRecurringCompletion',id,today},'PERIOD_FULL')
  await cancel(children[0].result.completionId)
  assert.equal((await parent(id)).completedPeriods,1)
  assert.equal((await parent(id)).effectiveChildren,3)
  await edit(id,4)
  assert.equal((await parent(id)).completedPeriods,0)
  await record(id)
  assert.equal((await parent(id)).completedPeriods,1)
  const after=await query('select snapshot r from public.adventure_events where id=$1',[children[0].result.completionId])
  assert.deepEqual(after,frozen)
  assert.equal((await query('select public.adventure_recurring_child_view($1,$2,$3) r',[owner,children[0].result.entityId,today])).status,'cancelled')
  assert.equal(await query('select status r from public.adventure_tasks where id=$1',[children[0].result.entityId]),'completed')
  await rejects({type:'cancelRecurringCompletion',completionId:children[0].result.completionId,today},'COMPLETION_CHANGED')
  await rejects({type:'cancelTaskCompletion',completionId:children[1].result.completionId},'NOT_FOUND')
  await rejects({type:'editTask',id:children[1].result.entityId,title:'篡改',description:'',plannedOn:today,destination:''},'NOT_FOUND')
 })
 await test('start-day lifecycle, future start edit/delete, no read mutations and strict dates/counts',async()=>{
  await rejects({type:'deleteRecurringTask',id,today},'RECURRING_ALREADY_STARTED')
  await rejects({type:'editRecurringTask',id,title:'同锚点也拒绝',description:'',requiredCount:4,startOn:today,today},'RECURRING_ALREADY_STARTED')
  const future='2098-01-01';const f=(await create(1,'',future)).result.entityId
  await rejects({type:'recordRecurringCompletion',id:f,today},'RECURRING_NOT_STARTED')
  await rejects({type:'endRecurringTask',id:f,today},'RECURRING_NOT_STARTED')
  await edit(f,1,{startOn:'2098-02-01'})
  await send({type:'deleteRecurringTask',id:f,today})
  await assert.rejects(parent(f),/NOT_FOUND$/)
  for(const requiredCount of [0,-1,1.5,'2',9007199254740992]) await rejects({type:'createRecurringTask',title:'无效',description:'',periodType:'month',startOn:today,requiredCount,destination:'',today},'INVALID_COMMAND')
  await rejects({type:'createRecurringTask',title:'过去',description:'',periodType:'week',startOn:'2020-01-01',requiredCount:1,destination:'',today},'RECURRING_START_PAST')
  const before=await state();await parent(id);await parent(id);assert.deepEqual(await state(),before)
  const stranger=crypto.randomUUID()
  assert.equal((await query('select public.adventure_workspace_read($1) r',[stranger])).version,0)
  assert.equal(await query('select count(*)::integer r from public.adventure_accounts where owner_id=$1',[stranger]),0)
 })
 let goalA,goalB,moved,first,second
 await test('migration preserves attribution; target blockers include future/full parents; goal reward counts child identities',async()=>{
  goalA=(await send({type:'createGoal',title:'目标 A',standards:['标准']})).result.entityId
  goalB=(await send({type:'createGoal',title:'目标 B',standards:['标准']})).result.entityId
  moved=(await create(3,goalA)).result.entityId;first=await record(moved)
  await edit(moved,3,{destination:goalB});second=await record(moved)
  assert.equal(first.result.source.goalId,goalA);assert.equal(second.result.source.goalId,goalB)
  assert.equal((await parent(moved)).currentPeriod.completed,2)
  const view=await query('select public.adventure_goal_view($1,$2) r',[owner,goalB])
  assert.equal(view.taskCount,1);assert.deepEqual(view.progress,{completed:0,total:0,ratio:null})
  await rejects({type:'achieveGoal',id:goalB,coefficient:2},'PENDING_RECURRING_TASKS')
  await rejects({type:'endGoal',id:goalB},'PENDING_RECURRING_TASKS')
  const f=(await create(1,goalA,'2098-01-01')).result.entityId
  await rejects({type:'endGoal',id:goalA},'PENDING_RECURRING_TASKS')
  await send({type:'deleteRecurringTask',id:f,today})
  const achieved=await send({type:'achieveGoal',id:goalA,coefficient:3})
  assert.equal(achieved.result.reward.amount,3)
  assert.deepEqual(achieved.result.reward.calculation.actionIds,[first.result.entityId])
  await rejects({type:'cancelRecurringCompletion',completionId:first.result.completionId,today},'READ_ONLY')
  await send({type:'endRecurringTask',id:moved,today})
  await rejects({type:'cancelRecurringCompletion',completionId:second.result.completionId,today},'READ_ONLY')
  await rejects({type:'editRecurringTask',id:moved,title:'不可恢复',description:'',requiredCount:3,today},'READ_ONLY')
  assert.equal((await parent(moved)).status,'ended')
  const b=await send({type:'achieveGoal',id:goalB,coefficient:2});assert.equal(b.result.reward.amount,2)
 })
 await test('owner composite FK, RLS and RPC grants; no old task/RPC mutation path into child',async()=>{
  const stranger=crypto.randomUUID();await command(c,stranger,'other-owner-create',0,{type:'createGoal',title:'其他账户',standards:['标准']})
  await assert.rejects(query('select public.adventure_recurring_parent_view($1,$2,$3) r',[stranger,id,today]),/NOT_FOUND$/)
  await assert.rejects(c.query('update public.adventure_recurring_tasks set owner_id=$1 where id=$2',[stranger,id]),/foreign key/)
  await assert.rejects(c.query('update public.adventure_tasks set title=$1 where id=$2',['篡改',children[1].result.entityId]),/IMMUTABLE_RECURRING_CHILD$/)
  await assert.rejects(c.query("update public.adventure_events set snapshot=jsonb_set(snapshot,'{recurring,title}','\"篡改\"') where id=$1",[children[1].result.completionId]),/INCONSISTENT_RECURRING_SNAPSHOT|IMMUTABLE_RECURRING_SNAPSHOT/)
  await assert.rejects(c.query('update public.adventure_events set recurring_parent_id=null where id=$1',[children[1].result.completionId]),/INCONSISTENT_RECURRING_IDENTITY$/)
  const denied=await query(`select count(*)::integer r from pg_proc p where pronamespace='public'::regnamespace and proname like 'adventure_%' and (prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`)
  assert.equal(denied,0)
  for(const role of ['anon','authenticated']) {
   await c.query(`set role ${role}`)
   await assert.rejects(c.query('select * from public.adventure_recurring_tasks'),/permission denied/)
   await assert.rejects(c.query("update public.adventure_recurring_tasks set title='越权' where id=$1",[id]),/permission denied/)
   await assert.rejects(c.query('select public.adventure_recurring_detail($1,$2,$3,$4)',[owner,revision,today,id]),/permission denied/)
   await c.query('reset role')
  }
 })
 await test('receipt replay wins over stale date/version/full/ended state; changed summary rejected; failed writes have no side effects',async()=>{
  const event=await query('select to_jsonb(e) r from public.adventure_events e where id=$1',[second.result.completionId])
  const original={type:'recordRecurringCompletion',id:moved,today}
  const before=await state()
  assert.deepEqual(await command(c,owner,event.request_id,0,original),second)
  assert.deepEqual(await query('select public.adventure_receipt_lookup($1,$2,$3) r',[owner,event.request_id,original]),second)
  await assert.rejects(command(c,owner,event.request_id,0,{...original,today:'2020-01-01'}),/REQUEST_ID_REUSED$/)
  await rejects({type:'recordRecurringCompletion',id,today:'2020-01-01'},'PLANNING_DATE_CHANGED')
  assert.deepEqual(await state(),before)
 })
 await test('real simultaneous transactions cannot exceed quota, replay same request only once',async()=>{
  const quota=(await create(1)).result.entityId
  const a=await connect(),b=await connect()
  const same={type:'recordRecurringCompletion',id:quota,today};const v=revision
  const responses=await Promise.allSettled([command(a,owner,'race-record-first',v,same),command(b,owner,'race-record-other',v,same)])
  assert.equal(responses.filter(x=>x.status==='fulfilled').length,1)
  assert.match(responses.find(x=>x.status==='rejected').reason.message,/VERSION_CONFLICT/)
  revision++
  assert.equal((await parent(quota)).effectiveChildren,1)
  const q=(await create(1)).result.entityId;const value={type:'recordRecurringCompletion',id:q,today};const vv=revision
  const replays=await Promise.all([command(a,owner,'same-request-race',vv,value),command(b,owner,'same-request-race',vv,value)])
  assert.deepEqual(replays[0],replays[1]);revision++
  assert.equal((await parent(q)).effectiveChildren,1)
 })
 // A real SQL clock seam exists only in this disposable database. Production
 // still uses clock_timestamp() after its account lock, with no time parameter.
 await c.query('create table public.adventure_test_clock_value(t timestamptz not null)')
 await c.query("insert into public.adventure_test_clock_value values('2024-01-31 12:00:00+08')")
 await c.query("create function public.adventure_test_clock() returns timestamptz language sql volatile as 'select t from public.adventure_test_clock_value'")
 let def=(await c.query("select pg_get_functiondef('public.adventure_planning_command(uuid,text,bigint,jsonb)'::regprocedure) d")).rows[0].d
 def=def.replace('FUNCTION public.adventure_planning_command(', 'FUNCTION public.adventure_test_recurring_command(').replaceAll('clock_timestamp()','public.adventure_test_clock()')
 await c.query(def)
 const historical=crypto.randomUUID();let hv=0,hs=0
 const at=async(day,value)=>{
  await c.query('update public.adventure_test_clock_value set t=$1',[`${day}T12:00:00+08:00`])
  const r=await query('select public.adventure_test_recurring_command($1,$2,$3,$4) r',[historical,`historical-${++hs}`,hv,{...value,today:day}]);hv=r.version;return r
 }
 await test('cross-period history stays frozen without per-period rows, long unused skip and exact audit reconciliation',async()=>{
  const h=(await at('2024-01-31',{type:'createRecurringTask',title:'月末历史',description:'',periodType:'month',startOn:'2024-01-31',requiredCount:5,destination:''})).result.entityId
  for(let i=0;i<4;i++)await at('2024-01-31',{type:'recordRecurringCompletion',id:h})
  await at('2024-01-31',{type:'editRecurringTask',id:h,title:'变更',description:'',requiredCount:3})
  const old=await query("select snapshot->'recurring' r from public.adventure_events where owner_id=$1 and kind='task_completed' order by applied_revision limit 1",[historical])
  assert.equal(old.requiredCount,5)
  assert.equal((await query('select public.adventure_recurring_parent_view($1,$2,$3) r',[historical,h,'2024-02-29'])).completedPeriods,1)
  const edit=await at('2024-02-29',{type:'editRecurringTask',id:h,title:'上调',description:'',requiredCount:10})
  let view=await query('select public.adventure_recurring_parent_view($1,$2,$3) r',[historical,h,'2024-02-29'])
  assert.equal(view.completedPeriods,1);assert.equal(view.currentPeriod.completed,0);assert.equal(view.currentPeriod.number,2)
  await at('2090-03-31',{type:'recordRecurringCompletion',id:h})
  view=await query('select public.adventure_recurring_parent_view($1,$2,$3) r',[historical,h,'2090-03-31'])
  assert.equal(view.completedPeriods,1);assert.equal(view.currentPeriod.completed,1);assert.equal(view.currentPeriod.number,795)
  const audit=await query(`select sum((snapshot->'recurringCounter'->>'delta')::bigint)::integer r from public.adventure_events where owner_id=$1 and recurring_parent_id=$2`,[historical,h])
  assert.equal(audit,view.completedPeriods)
  assert.equal(edit.version,7)
 })
 await test('real lock wait across injected server midnight rejects stale intent, success receipt still replays first',async()=>{
  const h=(await at('2024-01-31',{type:'createRecurringTask',title:'日界锁',description:'',periodType:'week',startOn:'2024-01-31',requiredCount:3,destination:''})).result.entityId
  const blocker=await connect(),waiting=await connect()
  await blocker.query('begin');await blocker.query('select * from public.adventure_accounts where owner_id=$1 for update',[historical])
  await c.query("update public.adventure_test_clock_value set t='2024-01-31 23:59:59+08'")
  const waitingResult=waiting.query('select public.adventure_test_recurring_command($1,$2,$3,$4) r',[historical,'lock-midnight-failed',hv,{type:'recordRecurringCompletion',id:h,today:'2024-01-31'}]).then(v=>({v}),e=>({e}))
  let blocked=false
  for(let i=0;i<40;i++) {
   const r=await c.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[waiting.processID]);if(r.rowCount){blocked=true;break}
   await new Promise(r=>setTimeout(r,10))
  }
  assert.equal(blocked,true)
  await c.query("update public.adventure_test_clock_value set t='2024-02-01 00:00:01+08'")
  await blocker.query('commit')
  assert.equal((await waitingResult).e.message,'PLANNING_DATE_CHANGED')
  assert.equal(await query('select count(*)::integer r from public.adventure_events where request_id=$1',['lock-midnight-failed']),0)
  assert.equal((await query('select revision::integer r from public.adventure_accounts where owner_id=$1',[historical])),hv)
  const done=await at('2024-02-01',{type:'recordRecurringCompletion',id:h})
  const requestId=`historical-${hs}`
  await c.query("update public.adventure_test_clock_value set t='2024-02-02 12:00:00+08'")
  assert.deepEqual(await query('select public.adventure_test_recurring_command($1,$2,$3,$4) r',[historical,requestId,0,{type:'recordRecurringCompletion',id:h,today:'2024-02-01'}]),done)
 })
 await test('XP/revision/date overflow and post-write failure roll back all facts/counters/receipts',async()=>{
  const rollback=(await create(2)).result.entityId
  await c.query(`create function public.adventure_test_fail_event() returns trigger language plpgsql as $$ begin if new.request_id='injected-write-fail' then raise exception 'INJECTED_WRITE_FAILURE'; end if;return new;end $$;create trigger test_recurring_fail before insert on public.adventure_events for each row execute function public.adventure_test_fail_event()`)
  const before=await state()
  await assert.rejects(command(c,owner,'injected-write-fail',revision,{type:'recordRecurringCompletion',id:rollback,today}),/INJECTED_WRITE_FAILURE$/)
  assert.deepEqual(await state(),before)
  await c.query('drop trigger test_recurring_fail on public.adventure_events;drop function public.adventure_test_fail_event()')
  await rejects({type:'createRecurringTask',title:'溢出',description:'',periodType:'year',startOn:'9999-12-31',requiredCount:1,destination:'',today},'CAPACITY_REACHED')
  await c.query('begin')
  await c.query('update public.adventure_accounts set revision=9007199254740991 where owner_id=$1',[owner])
  await assert.rejects(command(c,owner,'revision-overflow',9007199254740991,{type:'recordRecurringCompletion',id:rollback,today}),/CAPACITY_REACHED$/)
  await c.query('rollback')
  assert.deepEqual(await state(),before)
  const xpOwner=crypto.randomUUID()
  const once=await command(c,xpOwner,'xp-create-once',0,{type:'createTask',title:'历史奖励边界',description:'',destination:'',plannedOn:today})
  const complete=await command(c,xpOwner,'xp-complete-once',1,{type:'completeTask',id:once.result.entityId})
  await c.query('update public.adventure_events set amount=9007199254740991 where id=$1',[complete.result.completionId])
  await c.query('update public.adventure_accounts set total_xp=9007199254740991 where owner_id=$1',[xpOwner])
  const p=await command(c,xpOwner,'xp-create-parent',2,{type:'createRecurringTask',title:'XP上限',description:'',periodType:'week',startOn:today,requiredCount:1,destination:'',today})
  await assert.rejects(command(c,xpOwner,'xp-overflow-failed',3,{type:'recordRecurringCompletion',id:p.result.entityId,today}),/CAPACITY_REACHED$/)
  assert.equal(await query('select count(*)::integer r from public.adventure_events where request_id=$1',['xp-overflow-failed']),0)
  assert.equal((await query('select public.adventure_recurring_parent_view($1,$2,$3) r',[xpOwner,p.result.entityId,today])).effectiveChildren,0)
  assert.equal(await query('select revision::integer r from public.adventure_accounts where owner_id=$1',[xpOwner]),3)
 })
 await test('global child/event identity, historical audit sum, XP and revision/request reconciliation',async()=>{
  assert.equal(await query(`select count(*)::integer r from public.adventure_tasks t where kind='recurring_child' and
    (select count(*) from public.adventure_events e where e.owner_id=t.owner_id and e.task_id=t.id and e.recurring_parent_id=t.recurring_parent_id and e.kind='task_completed')<>1`),0)
  assert.equal(await query(`select count(*)::integer r from public.adventure_recurring_tasks p where completed_periods<>(select coalesce(sum((snapshot->'recurringCounter'->>'delta')::bigint),0) from public.adventure_events e where e.owner_id=p.owner_id and e.recurring_parent_id=p.id)`),0)
  assert.equal(await query(`select count(*)::integer r from public.adventure_accounts a where total_xp<>(select coalesce(sum(amount),0) from public.adventure_events e where e.owner_id=a.owner_id and kind in ('task_completed','goal_achieved') and invalidated_at is null)`),0)
  assert.equal(await query(`select count(*)::integer r from public.adventure_events where request_id is not null and (command_hash is null or applied_revision is null)`),0)
 })
 console.log(`SQL verification: ${tests} cases, 0 skipped`)
}
