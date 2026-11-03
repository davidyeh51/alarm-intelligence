const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements={};function el(id){return elements[id]||(elements[id]={id,value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(n,f){this['on'+n]=f},querySelector(){return {disabled:false}},click(){}})}
const nav=['records','analytics','inv'].map(view=>({dataset:{view},classList:{toggle(){}}}));
const document={querySelector:el,querySelectorAll(){return nav},createElement(){return el('anchor')}};
const c={document,window:{APP_CONFIG:{url:'https://example.invalid',key:'test'}},localStorage:{getItem(){return null},setItem(){},removeItem(){}},URL,Blob,console,setTimeout,fetch(){throw Error('unexpected network')}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app.js','utf8'),c);
vm.runInContext(`const rows=[
{id:1,factory_name:'甲場',county:'臺南',maintainer:'小王',device:'6',alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T08:30:00+08:00',description:'第一筆'},
{id:2,factory_name:'甲場',county:'臺南',maintainer:'小王',device:'6',alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T09:30:00+08:00',description:'第二筆'},
{id:3,factory_name:'甲場',county:'臺南',maintainer:'小王',device:'INV07',alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T10:30:00+08:00'},
{id:4,factory_name:'乙場',county:'高雄',maintainer:'小李',device:'2',alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T11:30:00+08:00'},
{id:5,factory_name:'丙場',device:null,alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T11:30:00+08:00'},
{id:6,factory_name:'丁場',device:'HV_Meter',alarm_type:'無發電數據',level:'2',event_time:'2026-11-03T11:30:00+08:00'},
{id:7,factory_name:'戊場',device:'3',alarm_type:'發電效率不佳',level:'9',event_time:'2026-11-03T11:30:00+08:00'}];all=buildGroups(rows);renderInv();`,c);
assert.equal(vm.runInContext('buildInvSites(all).length',c),2);
assert.equal(vm.runInContext('buildInvSites(all).reduce((n,s)=>n+s.devices.length,0)',c),3);
assert.equal(vm.runInContext('buildInvSites(all).reduce((n,s)=>n+s.devices.reduce((m,d)=>m+d.events.length,0),0)',c),4);
assert.equal(elements['#invCount'].textContent,'共 2 個案場');
assert(elements['#invRows'].innerHTML.includes('INV06'));assert(elements['#invRows'].innerHTML.includes('INV07'));
assert(!elements['#invRows'].innerHTML.includes('丙場'));assert(!elements['#invRows'].innerHTML.includes('丁場'));assert(!elements['#invRows'].innerHTML.includes('戊場'));
elements['#invSearch'].value='INV06';elements['#invSearch'].oninput();assert.equal(elements['#invCount'].textContent,'共 1 個案場');assert(elements['#invRows'].innerHTML.includes('甲場'));
nav[2].onclick();assert.equal(elements['#pageTitle'].textContent,'INV 無發電');
elements['#invSearch'].value='找不到';elements['#invSearch'].oninput();assert(elements['#invRows'].innerHTML.includes('目前沒有符合條件的案場'));
console.log('PASS: INV-only filtering, grouped counts, details, search, navigation and empty state');
