import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {Store} from '../src/store.js';
import {Accounts} from '../src/whatsapp.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function page(){
  const elements=new Map(),requests=[],intervals=new Map();let sequence=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,value:'',checked:false,textContent:'',disabled:false,events:{},setAttribute(){},focus(){},pause(){},play:async()=>{},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
  let account={name:'Primera',phone:'+12025550123',status:'connected',consent:true,paused:false};
  let deferStatus=null;
  const fetch=async(url,options={})=>{
    requests.push({url,data:options.body?JSON.parse(options.body):null});let data;
    if(url==='/api/branding')data={title:'WhatsApp',description:'Gestión',button:'Conectar'};
    else if(url==='/api/guides')data={android:[{title:'Android',text:'Paso',asset:null}],iphone:[{title:'iPhone',text:'Paso',asset:null}]};
    else if(url==='/api/status'){if(deferStatus){const pending=deferStatus;deferStatus=null;return pending;}data={...account};}
    else if(url==='/api/register'){account={name:'Segunda',phone:JSON.parse(options.body).phone,status:'pending',consent:false,paused:false};data={ok:true};}
    else if(url==='/api/connect'){account={...account,status:'connecting',consent:true,code:'87654321'};data={ok:true};}
    else throw Error('Unexpected request: '+url);
    return {ok:true,status:200,json:async()=>data};
  };
  const context=vm.createContext({document:{getElementById:element,styleSheets:[]},localStorage:{getItem:()=> 'iphone',setItem(){}},location:{hash:'',pathname:'/'},history:{replaceState(){}},fetch,setInterval:fn=>{const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout,console});
  vm.runInContext(source,context);for(let n=0;n<6;n++)await tick();
  return {element,requests,intervals,context,defer(promise){deferStatus=promise;},get account(){return account;}};
}
test('same browser connects a different phone with a new registration and code, never disconnecting first WhatsApp',async()=>{
  const p=await page();assert.match(p.element('connected-account').textContent,/12025550123/);
  p.element('another-account').onclick();assert.equal(p.element('phone').value,'');assert.equal(p.element('consent').checked,false);assert.equal(p.intervals.size,0);
  p.element('phone').value='+12025550124';p.element('consent').checked=true;
  await p.element('connect').events.submit({preventDefault(){}});
  const actions=p.requests.filter(r=>['/api/register','/api/connect','/api/disconnect'].includes(r.url));
  assert.deepEqual(actions.map(r=>r.url),['/api/register','/api/connect']);assert.ok(actions.every(r=>r.data.phone==='+12025550124'));
  assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('code').textContent,'8765 4321');assert.match(p.element('pairing-account').textContent,/12025550124/);
});
test('late status response from previous account cannot replace the new-number form',async()=>{
  const p=await page();let resolve;
  p.defer(new Promise(r=>resolve=r));const pending=vm.runInContext('refresh()',p.context);await tick();
  p.element('another-account').onclick();p.element('phone').value='+12025550125';
  resolve({ok:true,status:200,json:async()=>({name:'Primera',phone:'+12025550123',status:'connected',consent:true})});await pending;
  assert.equal(p.element('connected').hidden,true);assert.equal(p.element('connect').hidden,false);assert.equal(p.element('phone').value,'+12025550125');
});
test('cancel before registering returns to previous browser account without revoking WhatsApp',async()=>{
  const p=await page();p.element('another-account').onclick();await p.element('cancel-new-account').onclick();
  assert.equal(p.element('connected').hidden,false);assert.match(p.element('connected-account').textContent,/12025550123/);assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
});
test('three phone numbers have separate authorization and WhatsApp browser profiles',async t=>{
  const dir=mkdtempSync(`${tmpdir()}/wa-multi-`),store=new Store(dir),options=[];
  const phones=['12025550123','12025550124','12025550125'];
  class Fake extends EventEmitter{async initialize(){}async destroy(){}}
  const manager=new Accounts(store,dir,async()=>{},3,config=>{options.push(config);return new Fake();});
  t.after(async()=>{for(const account of store.all())await manager.close(account.id);store.db.close();rmSync(dir,{recursive:true,force:true});});
  const tokens=phones.map(phone=>store.register(phone)),accounts=tokens.map(token=>store.browser(token));
  for(const account of accounts){store.update(account.id,'consent',1);await manager.start(account.id,true);}
  assert.equal(manager.live.size,3);assert.equal(new Set(accounts.map(a=>a.id)).size,3);
  assert.deepEqual(options.map(o=>o.pairWithPhoneNumber.phoneNumber),phones);
  assert.equal(new Set(options.map(o=>o.authStrategy.clientId)).size,3);
  for(const [i,token]of tokens.entries())assert.equal(store.browser(token).phone,phones[i]);
  assert.equal(store.register(phones[0]),null); // A phone number never grants another browser access.
});
