// Exercise unmodified production RPCs at READ COMMITTED while the first owner
// transaction commits. An absent account has no row for FOR SHARE to lock.
export async function verifyFirstAccountReads({client,connect,command,today,assert}) {
  const cases = [
    { name: 'recurring/list', sql: 'select public.adventure_recurring_list($1,0,$2,$2) r', args: x => [x.owner,today], empty: r => r.total===0 && r.parents.length===0 },
    { name: 'date-tasks/list', sql: 'select public.adventure_date_task_list($1,0,$2,$2) r', args: x => [x.owner,today], empty: r => r.total===0 && r.tasks.length===0 && r.progress.total===0 },
    { name: 'recurring/detail', sql: 'select public.adventure_recurring_detail($1,0,$2,$3) r', args: x => [x.owner,today,x.parent], empty: () => false },
    { name: 'recurring/child', sql: 'select public.adventure_recurring_child($1,0,$2,$3) r', args: x => [x.owner,today,x.child], empty: () => false },
    { name: 'recurring/children', sql: 'select public.adventure_recurring_children($1,0,$2,$3) r', args: x => [x.owner,today,x.parent], empty: () => false },
    { name: 'planning/read', sql: 'select public.adventure_planning_read($1) r', args: x => [x.owner], empty: r => r.totalGoals===0 && r.goals.length===0 && r.growth.totalXp===0 && r.growth.actions===0 },
    { name: 'workspace/read', sql: 'select public.adventure_workspace_read($1) r', args: x => [x.owner], empty: r => r.totalGoals===0 && r.goals.length===0 && r.totalTasks===0 && r.tasks.length===0 && r.growth.totalXp===0 && r.todayTaskProgress.total===0 },
    { name: 'workspace/goal', sql: 'select public.adventure_workspace_read(p_owner=>$1,p_goal_id=>$2) r', args: x => [x.owner,x.goal], empty: () => false },
    { name: 'tasks/list', sql: "select public.adventure_task_list($1,$2,'all',0,$2) r", args: x => [x.owner,today], empty: r => r.total===0 && r.tasks.length===0 && r.progress.total===0 },
    { name: 'task/history', sql: 'select public.adventure_task_history($1,$2) r', args: x => [x.owner,x.once], empty: () => false },
    { name: 'migration/options', sql: "select public.adventure_migration_options($1,'task',$2) r", args: x => [x.owner,x.once], empty: () => false },
    { name: 'growth/read', sql: 'select public.adventure_growth_read($1,0) r', args: x => [x.owner], empty: r => r.total===0 && r.items.length===0 && r.growth.actions===0 },
    { name: 'reward/source', sql: 'select public.adventure_reward_source($1,$2,1,0) r', args: x => [x.owner,x.completion], empty: () => false },
    { name: 'preview/end-parent', sql: 'select public.adventure_planning_preview($1,0,$2) r', args: x => [x.owner,{type:'endRecurringTask',id:x.parent,today}], empty: () => false },
    { name: 'preview/cancel-child', sql: 'select public.adventure_planning_preview($1,0,$2) r', args: x => [x.owner,{type:'cancelRecurringCompletion',completionId:x.completion,today}], empty: () => false },
  ]
  const versionPinned=new Set(['recurring/list','date-tasks/list','recurring/detail','recurring/child','recurring/children','tasks/list','growth/read','reward/source','preview/end-parent','preview/cancel-child'])
  const readers=await Promise.all(cases.flatMap(() => [connect(),connect()]))
  const outcomes=Object.fromEntries(cases.map(c => [c.name,{empty:0,committed:0,rejected:0}]))
  const virgin={owner:crypto.randomUUID(),goal:crypto.randomUUID(),parent:crypto.randomUUID(),child:crypto.randomUUID(),completion:crypto.randomUUID(),once:crypto.randomUUID()}
  for(let index=0;index<cases.length;index++) {
    const c=cases[index]
    try {const result=(await readers[index*2].query(c.sql,c.args(virgin))).rows[0].r;assert.equal(result.version,0);assert.ok(c.empty(result))}
    catch(error){if(error.message!=='NOT_FOUND')throw error}
  }
  assert.equal((await client.query('select count(*)::integer n from public.adventure_accounts where owner_id=$1',[virgin.owner])).rows[0].n,0)
  let attempts=0
  for(let round=0;round<20;round++) {
    const owner=crypto.randomUUID()
    await client.query('begin')
    let transaction=true
    try {
      const goal=(await command(client,owner,`first-goal-${round}`,0,{type:'createGoal',title:'首次目标',standards:['标准']})).result.entityId
      const parent=(await command(client,owner,`first-parent-${round}`,1,{type:'createRecurringTask',title:'首次父',description:'',periodType:'week',startOn:today,requiredCount:2,destination:goal,today})).result.entityId
      const done=await command(client,owner,`first-child-${round}`,2,{type:'recordRecurringCompletion',id:parent,today})
      const once=(await command(client,owner,`first-once-${round}`,3,{type:'createTask',title:'首次一次性',description:'',destination:goal,plannedOn:today})).result.entityId
      const fixture={owner,goal,parent,child:done.result.entityId,completion:done.result.completionId,once}
      const pending=readers.map(async(reader,index)=>{
        const c=cases[Math.floor(index/2)];attempts++
        try {
          const result=(await reader.query(c.sql,c.args(fixture))).rows[0].r
          if(result.version===0 && c.empty(result)) outcomes[c.name].empty++
          else if(result.version===4 && !versionPinned.has(c.name)) outcomes[c.name].committed++
          else return {endpoint:c.name,version:result.version,total:result.total,round}
        }catch(error) {
          if(['VERSION_CONFLICT','NOT_FOUND'].includes(error.message))outcomes[c.name].rejected++
          else return {endpoint:c.name,error:error.message,round}
        }
      })
      await new Promise(resolve=>setTimeout(resolve,round%3))
      await client.query('commit');transaction=false
      const mixed=(await Promise.all(pending)).filter(Boolean)
      assert.deepEqual(mixed,[],`mixed first-account snapshots: ${JSON.stringify(mixed)}`)
      const account=(await client.query('select revision::integer,total_xp::integer from public.adventure_accounts where owner_id=$1',[owner])).rows[0]
      assert.deepEqual(account,{revision:4,total_xp:1})
    } finally {
      if(transaction)await client.query('rollback')
    }
  }
  console.log(`PASS SQL: first-account concurrent snapshots (${cases.length} RPCs, ${attempts} reads, 0 mixed/failed/skipped): ${JSON.stringify(outcomes)}`)
}
