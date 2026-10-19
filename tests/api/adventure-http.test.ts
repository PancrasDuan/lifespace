import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import type { AdventureState, CommandResult } from '../../src/shared/adventure'
type ApiBody = { state: AdventureState; version: number; today: string; result: CommandResult }
const body = async (response: Response) => await response.json() as ApiBody

const A='00000000-0000-4000-8000-000000000011', B='00000000-0000-4000-8000-000000000012'
const env={SUPABASE_URL:'https://adventure-test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fake-adventure-test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake-adventure-test',AUTH_ALLOWED_EMAILS:'a@example.com,b@example.com'}
const encode=(v:unknown)=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
const token=(owner:string)=>`${encode({alg:'HS256'})}.${encode({sub:owner,session_id:'00000000-0000-4000-8000-000000000022',exp:4102444800})}.test-signature`
const rows=new Map<string,any>()
let loseNextWriteResponse=false
let failUpstream=false
let competingWrites=0
const request=(owner=A,path='/api/adventure',body?:unknown)=>app.request(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token(owner)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env)
function database(){vi.stubGlobal('fetch',vi.fn(async(input:URL|string|Request,init:RequestInit={})=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.pathname==='/auth/v1/user'){const auth=new Headers(init.headers).get('Authorization')??'';const owner=auth.includes(token(B))?B:A;return Response.json({id:owner,email:owner===A?'a@example.com':'b@example.com',email_confirmed_at:'2026-10-01',is_anonymous:false})}
 if(url.pathname!=='/rest/v1/adventure_states')throw new Error('Unexpected upstream')
 if(failUpstream)return new Response('secret upstream details',{status:503})
 const owner=url.searchParams.get('owner_id')?.slice(3)
 if(init.method==='POST'){const row=JSON.parse(String(init.body));if(!rows.has(row.owner_id))rows.set(row.owner_id,structuredClone(row));return Response.json([])}
 if(init.method==='PATCH'){if(competingWrites>0){competingWrites--;const existing=rows.get(owner!);existing.version++;return Response.json([])}const row=rows.get(owner!);const version=Number(url.searchParams.get('version')?.slice(3));if(!row||row.version!==version)return Response.json([]);const next={...row,...JSON.parse(String(init.body))};rows.set(owner!,next);if(loseNextWriteResponse){loseNextWriteResponse=false;throw new Error('network interrupted after commit')}return Response.json([next])}
 return Response.json(rows.has(owner!)?[rows.get(owner!)]:[])
}))}
describe('人生冒险持久命令 HTTP',()=>{
 beforeEach(()=>{rows.clear();loseNextWriteResponse=false;failUpstream=false;competingWrites=0;database();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T18:00:00Z'))})
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
 it('首次账户从零开始，写入后从独立HTTP读取仍保留，并隔离其他账户',async()=>{
  const initial=await body(await request());expect(initial).toMatchObject({version:0,today:'2026-10-19',state:{containers:[],ledger:[]}})
  const written=await request(A,'/api/adventure/commands',{requestId:'new-main-1',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'职业'}});expect(written.status).toBe(200)
  expect(await body(await request())).toMatchObject({version:1,state:{containers:[{name:'职业'}]}})
  expect(await body(await request(B))).toMatchObject({version:0,state:{containers:[]}})
 })
 it('未知响应重试同 key 仅创建一次，并返回最新状态和稳定结果',async()=>{
  await request()
  const first={requestId:'stable-create-1',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'健康'}}
  loseNextWriteResponse=true
  expect((await request(A,'/api/adventure/commands',first)).status).toBe(503)
  const retry=await body(await request(A,'/api/adventure/commands',first))
  expect(retry).toMatchObject({version:1,state:{containers:[{name:'健康'}]}})
  const result=retry.result
  await request(A,'/api/adventure/commands',{requestId:'stable-create-2',expectedVersion:1,command:{type:'createContainer',kind:'main',name:'职业'}})
  const replay=await body(await request(A,'/api/adventure/commands',first))
  expect(replay.version).toBe(2);expect(replay.state.containers).toHaveLength(2);expect(replay.result).toEqual(result)
  expect((await request(A,'/api/adventure/commands',{...first,command:{...first.command,name:'另一件事'}})).status).toBe(409)
 })
 it('并发旧版本只有一个写入成功；冲突不能悄悄重算用户意图',async()=>{
  await request()
  const responses=await Promise.all(['职业','健康'].map((name,i)=>request(A,'/api/adventure/commands',{requestId:`concurrent-${i}`,expectedVersion:0,command:{type:'createContainer',kind:'main',name}})))
  expect(responses.map(r=>r.status).sort()).toEqual([200,409])
  const state=await body(await request());expect(state.version).toBe(1);expect(state.state.containers).toHaveLength(1)
 })
 it('跨账户猜测 ID 无法读取或编辑、排序、迁移与结算他人的内容',async()=>{
  const main=await body(await request(A,'/api/adventure/commands',{requestId:'owner-a-main',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'职业'}}))
  const id=main.result.entityId!
  await request(B)
  const mutations=[{type:'editContainer',id,name:'被改名'},{type:'reorderGoals',containerId:id,goalIds:[]},{type:'migrateSide',id,newMainName:'偷来的'},{type:'completeTask',id},{type:'refresh'}]
  for(let i=0;i<mutations.length;i++)await request(B,'/api/adventure/commands',{requestId:`guess-target-${i}`,expectedVersion:0,command:mutations[i]})
  expect(await body(await request(A))).toMatchObject({version:1,state:{containers:[{id,name:'职业'}],ledger:[]}})
  const b=await body(await request(B));expect(b.state.containers).toEqual([]);expect(b.state.ledger).toEqual([])
 })
 it('所有客户端 owner、任意 state、XP 和日期字段都不能进入严格命令',async()=>{
  const base={requestId:'invalid-fields',expectedVersion:0,command:{type:'refresh'}}
  for(const payload of [{...base,owner:A},{...base,today:'2030-01-01'},{...base,command:{type:'refresh',today:'2030-01-01'}},{...base,command:{type:'createContainer',kind:'main',name:'职业',xp:99}},{...base,state:{ledger:[{amount:9999}]}},{requestId:'no-version-1',command:{type:'refresh'}}])expect((await request(A,'/api/adventure/commands',payload)).status).toBe(400)
  expect((await request(A,'/api/adventure?owner='+B+'&today=2030-01-01')).status).toBe(200)
  expect(await body(await request())).toMatchObject({today:'2026-10-19',version:0,state:{ledger:[]}})
 })
 it('未登录或无效身份被拒绝，服务源错误不泄露内容或凭据',async()=>{
  expect((await app.request('/api/adventure',{},env)).status).toBe(401)
  expect((await app.request('/api/adventure',{headers:{Authorization:'Bearer invalid'}},env)).status).toBe(401)
  failUpstream=true
  const failed=await request();expect(failed.status).toBe(503)
  expect(await failed.text()).not.toMatch(/secret upstream|sb_secret|Authorization/)
 })
 it('限制请求类型和体积，原型污染属性不会变成已执行命令',async()=>{
  expect((await request(A,'/api/adventure/commands',{requestId:'large-body-1',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'x'.repeat(140000)}})).status).toBe(400)
  const payload={requestId:'__proto__',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'学习'}}
  expect((await request(A,'/api/adventure/commands',payload)).status).toBe(200)
  expect((await request(A,'/api/adventure/commands',payload)).status).toBe(200)
  expect((await body(await request())).state.containers).toHaveLength(1)
 })

 it('同 key 并发提交稳定重放，refresh可有限CAS重读但不会无限循环',async()=>{
  await request()
  const create={requestId:'duplicate-concurrent',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'财务'}}
  const responses=await Promise.all([request(A,'/api/adventure/commands',create),request(A,'/api/adventure/commands',create)])
  expect(responses.map(r=>r.status)).toEqual([200,200]);expect(await body(responses[0])).toEqual(await body(responses[1]))
  competingWrites=2
  const refreshed=await request(A,'/api/adventure/commands',{requestId:'refresh-race-win',expectedVersion:1,command:{type:'refresh'}})
  expect(refreshed.status).toBe(200);expect(await body(refreshed)).toMatchObject({version:4})
  competingWrites=4
  expect((await request(A,'/api/adventure/commands',{requestId:'refresh-race-limit',expectedVersion:4,command:{type:'refresh'}})).status).toBe(409)
 })
 it('同一天待结算，跨服务端上海午夜刷新才发行动经验且重复刷新不再增加',async()=>{
  const main=await body(await request(A,'/api/adventure/commands',{requestId:'xp-main-create',expectedVersion:0,command:{type:'createContainer',kind:'main',name:'健康'}}))
  const goal=await body(await request(A,'/api/adventure/commands',{requestId:'xp-goal-create',expectedVersion:1,command:{type:'createGoal',containerId:main.result.entityId!,title:'稳定运动',standard:'每周跑三次'}}))
  const task=await body(await request(A,'/api/adventure/commands',{requestId:'xp-task-create',expectedVersion:2,command:{type:'createTask',goalId:goal.result.entityId!,title:'跑步',date:'2026-10-19',checklist:[]}}))
  await request(A,'/api/adventure/commands',{requestId:'xp-task-complete',expectedVersion:3,command:{type:'completeTask',id:task.result.entityId!}})
  const sameDay=await body(await request(A,'/api/adventure/commands',{requestId:'xp-refresh-same',expectedVersion:4,command:{type:'refresh'}}))
  expect(sameDay.state.ledger).toEqual([])
  vi.setSystemTime(new Date('2026-10-19T16:00:00Z'))
  const nextDay=await body(await request(A,'/api/adventure/commands',{requestId:'xp-refresh-next',expectedVersion:5,command:{type:'refresh'}}))
  expect(nextDay).toMatchObject({today:'2026-10-20',result:{reward:1},state:{ledger:[{kind:'action',amount:1,date:'2026-10-19',settledOn:'2026-10-20'}]}})
  const again=await body(await request(A,'/api/adventure/commands',{requestId:'xp-refresh-again',expectedVersion:6,command:{type:'refresh'}}))
  expect(again.result.reward).toBe(0);expect(again.state.ledger).toHaveLength(1)
 })

})
