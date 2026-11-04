'use strict';
const SOURCE='https://om.acmepointes.com';
const TARGET='https://cowljafosekwvxithwjd.supabase.co/functions/v1/alarm-hourly-ingest';
function validateData(body) {
  if (!body || body.success !== true || !Array.isArray(body.data) || body.data.length === 0 || body.data.length > 10000) throw new Error('來源回傳失敗或案場清單無效');
  let count=0;
  for (const site of body.data) {
    if (!site || typeof site.factoryName !== 'string' || !site.factoryName.trim() || !Array.isArray(site.allAlarms)) throw new Error('來源案場資料格式錯誤');
    for (const alarm of site.allAlarms) {
      if (!alarm || typeof alarm.timestamp !== 'string' || !Number.isFinite(Date.parse(alarm.timestamp)) || typeof alarm.alarmType !== 'string' || !alarm.alarmType.trim()) throw new Error('來源告警資料格式錯誤');
      count++;
      if (count > 200000) throw new Error('來源告警數量超出限制');
    }
  }
  return {sites:body.data,siteCount:body.data.length,recordCount:count};
}
async function sync({username,password,token,fetcher=fetch}) {
  if (!username || !password || !token) throw new Error('未設定同步所需的機密');
  const timeout=()=>AbortSignal.timeout(60000);
  const login=await fetcher(SOURCE+'/api/cosmos/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:username,password}),signal:timeout()});
  if(!login.ok) throw new Error('來源登入失敗 HTTP '+login.status);
  const loginBody=await login.json();
  if(loginBody.success!==true) throw new Error('來源登入未成功');
  const cookies=login.headers.getSetCookie().map(x=>x.split(';',1)[0]).filter(Boolean).join('; ');
  if(!cookies) throw new Error('來源未提供登入工作階段');
  const history=await fetcher(SOURCE+'/api/cosmos/devicestatus/historyalarms',{method:'POST',headers:{'content-type':'application/json',cookie:cookies},body:'{}',signal:timeout()});
  if(!history.ok) throw new Error('來源告警查詢失敗 HTTP '+history.status);
  const {sites,siteCount,recordCount}=validateData(await history.json());
  const ingest=await fetcher(TARGET,{method:'POST',headers:{'content-type':'application/json','x-alarm-sync-token':token},body:JSON.stringify({sites}),signal:timeout()});
  if(!ingest.ok) throw new Error('資料匯入失敗 HTTP '+ingest.status);
  const result=await ingest.json();
  if(!result || result.ok!==true) throw new Error('資料匯入未確認成功');
  return {siteCount,recordCount,uniqueRecords:result.unique_records};
}
module.exports={validateData,sync};
if(require.main===module) sync({username:process.env.ALARM_SOURCE_USERNAME,password:process.env.ALARM_SOURCE_PASSWORD,token:process.env.ALARM_SYNC_TOKEN})
 .then(r=>console.log(JSON.stringify({success:true,...r}))).catch(e=>{console.error('同步失敗：'+e.message);process.exitCode=1});
