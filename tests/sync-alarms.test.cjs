const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateData,sync}=require('../scripts/sync-alarms.cjs');
const good={success:true,data:[{factoryName:'甲場',allAlarms:[{timestamp:'2026-11-04T09:00:00+08:00',alarmType:'無發電數據',inv:6}]}]};
test('rejects incomplete source data',()=>{assert.throws(()=>validateData({success:false,data:[]}));assert.throws(()=>validateData({success:true,data:[{factoryName:'甲',allAlarms:[{}]}]}));});
test('authenticates, keeps cookie, and submits snapshot without exposing credentials',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});if(calls.length===1)return {ok:true,headers:{getSetCookie:()=>['session=opaque; Path=/; HttpOnly']},json:async()=>({success:true})};if(calls.length===2)return {ok:true,json:async()=>good};return {ok:true,json:async()=>({ok:true,unique_records:1})}};
 const r=await sync({username:'name',password:'secret',token:'t'.repeat(64),fetcher});
 assert.equal(r.siteCount,1);assert.equal(r.recordCount,1);assert.equal(calls[1].options.headers.cookie,'session=opaque');assert.equal(JSON.parse(calls[2].options.body).sites.length,1);assert(!calls[2].options.body.includes('secret'));
});
test('failed source does not invoke ingestion',async()=>{let calls=0;const fetcher=async()=>{calls++;return {ok:true,headers:{getSetCookie:()=>['session=x']},json:async()=>calls===1?{success:true}:{success:false,data:[]}}};await assert.rejects(sync({username:'u',password:'p',token:'t',fetcher}));assert.equal(calls,2)});
