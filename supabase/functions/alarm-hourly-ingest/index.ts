// The deployment replaces this placeholder with a SHA-256 digest, never the token.
const TOKEN_SHA256 = '__ALARM_INGEST_HASH__';
Deno.serve(async (req: Request) => {
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(req.method!=='POST') return reply(405,{error:'method_not_allowed'});
  const token=req.headers.get('x-alarm-sync-token')||'';
  if(token.length!==64) return reply(403,{error:'forbidden'});
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  const hash=Array.from(bytes).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==TOKEN_SHA256 || TOKEN_SHA256.startsWith('__')) return reply(403,{error:'forbidden'});
  if(Number(req.headers.get('content-length')||'0')>10000000) return reply(413,{error:'too_large'});
  let text:string;
  try { text=await req.text(); } catch { return reply(400,{error:'invalid_body'}); }
  if(text.length>10000000) return reply(413,{error:'too_large'});
  let payload: any;
  try {payload=JSON.parse(text);} catch {return reply(400,{error:'invalid_json'});}
  if(!payload || !Array.isArray(payload.sites) || !payload.sites.length || payload.sites.length>10000) return reply(400,{error:'invalid_sites'});
  const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!key) return reply(503,{error:'service_unavailable'});
  try {
    const response=await fetch(base+'/rest/v1/rpc/alarm_ingest_snapshot',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_sites:payload.sites})});
    if(!response.ok) return reply(502,{error:'ingest_failed',status:response.status});
    const result=await response.json();
    return reply(200,{ok:true,run_id:result.run_id,source_groups:result.source_groups,source_records:result.source_records,unique_records:result.unique_records});
  } catch {return reply(502,{error:'ingest_unavailable'});}
});
