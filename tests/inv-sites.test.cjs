const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements={};function el(id){return elements[id]||(elements[id]={id,value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(n,f){this['on'+n]=f},querySelector(){return {disabled:false}},click(){}})}
const nav=['records','analytics','inv'].map(view=>({dataset:{view},classList:{toggle(){}}}));
const document={querySelector:el,querySelectorAll(){return nav},createElement(){return el('anchor')}};
const c={document,window:{APP_CONFIG:{url:'https://example.invalid',key:'test'},confirm:()=>true,alert:()=>{}},localStorage:{getItem(){return null},setItem(){},removeItem(){}},URL,Blob,console,setTimeout,fetch(){throw Error('unexpected network')}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app.js','utf8'),c);
vm.runInContext(`lastRun={synced_at:'2026-11-04T09:00:00Z',source:'historyalarms'};
openCases=[{id:1,factory_name:'甲場',county:'臺南',maintainer:'小王',last_event_at:'2026-11-04T08:30:00Z',last_observed_at:'2026-11-04T09:00:00Z'},{id:2,factory_name:'乙場',county:'高雄',maintainer:'小李',last_event_at:'2026-11-03T08:30:00Z',last_observed_at:'2026-11-03T09:00:00Z'}];
caseDevices=[{case_id:1,device:'INV06',last_event_at:'2026-11-04T08:30:00Z'},{case_id:1,device:'INV07',last_event_at:'2026-11-04T08:30:00Z'},{case_id:2,device:'INV02',last_event_at:'2026-11-03T08:30:00Z'}];
renderInv();`,c);
assert.equal(elements['#invCount'].textContent,'共 2 個待追蹤案場');assert(elements['#invRows'].innerHTML.includes('INV06'));assert(elements['#invRows'].innerHTML.includes('INV07'));assert(elements['#invRows'].innerHTML.includes('未出現，待確認'));assert(elements['#invRows'].innerHTML.includes('本次有紀錄'));
elements['#invSearch'].value='INV06';elements['#invSearch'].oninput();assert.equal(elements['#invCount'].textContent,'共 1 個待追蹤案場');assert(elements['#invRows'].innerHTML.includes('甲場'));assert(!elements['#invRows'].innerHTML.includes('乙場'));
nav[2].onclick();assert.equal(elements['#pageTitle'].textContent,'INV 無發電');
elements['#invSearch'].value='找不到';elements['#invSearch'].oninput();assert(elements['#invRows'].innerHTML.includes('目前沒有符合條件的待追蹤案場'));
vm.runInContext("session={access_token:'test-token'};request=async (path,opts)=>{globalThis.closedPath=path;globalThis.closedBody=JSON.parse(opts.body);return true};refreshData=async()=>{globalThis.refreshed=true}",c);
const button={dataset:{resolveId:'1'},disabled:false};
Promise.resolve(elements['#invRows'].onclick({target:{closest:()=>button}})).then(()=>{assert.equal(c.closedPath,'/rest/v1/rpc/alarm_resolve_case');assert.equal(c.closedBody.p_case_id,1);assert.equal(c.refreshed,true);console.log('PASS: open sites, device details, stale status, search, navigation and case resolution')}).catch(e=>{console.error(e);process.exitCode=1});
