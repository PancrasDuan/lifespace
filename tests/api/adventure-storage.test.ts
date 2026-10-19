import { afterEach, expect, it, vi } from 'vitest'
import { AdventureStore, MAX_ADVENTURE_ROW_BYTES, MAX_ADVENTURE_RESPONSE_BYTES, type StoredState } from '../../worker/adventure/store'
import { initialState } from '../../src/shared/adventure'
const owner='00000000-0000-4000-8000-000000000041'
const env={SUPABASE_URL:'https://storage-test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fake-capacity-test'}
const now='2026-10-19T01:00:00Z'
afterEach(()=>vi.unstubAllGlobals())
it('候选整行超限时不发送PATCH，原行仍能读回；预算包括UTF-8 state和journal',async()=>{
 let saved:StoredState={owner_id:owner,state:initialState(),version:0,journal:{}}
 const patch=vi.fn()
 vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit={})=>{
  if(init.method==='PATCH'){patch();saved={...saved,...JSON.parse(String(init.body))}}
  return Response.json([saved])
 })
 const store=new AdventureStore(env,owner,{maxRowBytes:1024})
 const previous=await store.load()
 const state=initialState();state.containers.push({id:'first',kind:'main',name:'健康',archived:false})
 const result={reward:0,ledgerIds:[],achievementIds:[],levelBefore:1,levelAfter:1}
 const accepted=await store.compareAndSwap(previous,state,{'request:small':{hash:'one',result}},now)
 expect(accepted?.version).toBe(1)
 const tooLarge={...accepted!.journal,['request:'+ '长'.repeat(400)]:{hash:'two',result}}
 await expect(store.compareAndSwap(accepted!,state,tooLarge,now)).rejects.toMatchObject({code:'ADVENTURE_CAPACITY_REACHED',status:400})
 expect(patch).toHaveBeenCalledTimes(1)
 const recovered=await new AdventureStore(env,owner).load()
 expect(recovered).toEqual(accepted)
 expect(recovered.state.containers).toEqual([{id:'first',kind:'main',name:'健康',archived:false}])
})

it('整行恰好预算内可提交回读，多一个UTF-8字节就拒绝；生产读写预算预留四倍空间',async()=>{
 expect(MAX_ADVENTURE_ROW_BYTES).toBe(8_000_000)
 expect(MAX_ADVENTURE_RESPONSE_BYTES).toBe(32_000_000)
 let saved:StoredState={owner_id:owner,state:initialState(),version:0,journal:{}}
 const fetcher=vi.fn(async(_url:unknown,init:RequestInit={})=>{if(init.method==='PATCH')saved={...saved,...JSON.parse(String(init.body))};return Response.json([saved])})
 vi.stubGlobal('fetch',fetcher)
 const candidate={owner_id:owner,state:initialState(),journal:{},version:1,updated_at:now}
 const exact=new TextEncoder().encode(JSON.stringify(candidate)).byteLength
 const accepted=await new AdventureStore(env,owner,{maxRowBytes:exact}).compareAndSwap(saved,candidate.state,{},now)
 expect(accepted?.version).toBe(1)
 const tighter=new AdventureStore(env,owner,{maxRowBytes:exact-1})
 // Version has the same encoded width, so only the one-byte smaller budget makes this fail.
 const beforeCalls=fetcher.mock.calls.length
 await expect(tighter.compareAndSwap(accepted!,candidate.state,{},now)).rejects.toMatchObject({code:'ADVENTURE_CAPACITY_REACHED'})
 expect(fetcher.mock.calls).toHaveLength(beforeCalls)
 expect((await new AdventureStore(env,owner).load()).version).toBe(1)
})
