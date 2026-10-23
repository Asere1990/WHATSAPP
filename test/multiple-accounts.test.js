import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {Store} from '../src/store.js';
import {Accounts} from '../src/whatsapp.js';
const countries=readFileSync(new URL('../public/countries.js',import.meta.url),'utf8');
const source=countries+readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function page({registerStatus=201}={}){
  const elements=new Map(),requests=[],intervals=new Map();let sequence=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,value:'',checked:false,textContent:'',disabled:false,events:{},setAttribute(){},focus(){this.focusCount=(this.focusCount||0)+1;},scrollIntoView(){this.scrollCount=(this.scrollCount||0)+1;},pause(){},showModal(){this.open=true;},close(){this.open=false;},play:async()=>{},appendChild(){},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
  let account={name:'Primera',phone:'+12025550123',country:'US',nationalNumber:'2025550123',status:'connected',consent:true,paused:false};
  let deferStatus=null;
  const fetch=async(url,options={})=>{
    requests.push({url,data:options.body?JSON.parse(options.body):null});let data;
    if(url==='/api/branding')data={title:'WhatsApp',description:'Gestión',button:'Conectar'};
    else if(url==='/api/guides')data={android:[{title:'Android',text:'Paso',asset:null}],iphone:[{title:'iPhone',text:'Paso',asset:null}]};
    else if(url==='/api/status'){if(deferStatus){const pending=deferStatus;deferStatus=null;return pending;}data={...account};}
    else if(url==='/api/register'){if(registerStatus!==201)return {ok:false,status:registerStatus,json:async()=>({error:'duplicate'})};account={name:'Segunda',phone:JSON.parse(options.body).phone,status:'pending',consent:false,paused:false};data={ok:true};}
    else if(url==='/api/connect'){account={...account,status:'connecting',consent:true,code:'87654321'};data={ok:true};}
    else throw Error('Unexpected request: '+url);
    return {ok:true,status:200,json:async()=>data};
  };
  const context=vm.createContext({document:{getElementById:element,styleSheets:[],createElement:()=>({})},localStorage:{getItem:()=> 'iphone',setItem(){}},location:{hash:'',pathname:'/'},history:{replaceState(){}},fetch,setInterval:fn=>{const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout,console,navigator:{clipboard:{writeText:async value=>{element('clipboard').value=value;}}}});
  vm.runInContext(source,context);for(let n=0;n<6;n++)await tick();
  return {element,requests,intervals,context,defer(promise){deferStatus=promise;},get account(){return account;}};
}
test('same browser connects a different phone with a new registration and code, never disconnecting first WhatsApp',async()=>{
  const p=await page();assert.match(p.element('connected-account').textContent,/12025550123/);
  p.element('another-account').onclick();assert.equal(p.element('phone').value,'');assert.equal(p.element('consent').checked,false);assert.equal(p.intervals.size,0);
  p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
  await p.element('connect').events.submit({preventDefault(){}});
  const actions=p.requests.filter(r=>['/api/register','/api/connect','/api/disconnect'].includes(r.url));
  assert.deepEqual(actions.map(r=>r.url),['/api/register','/api/connect']);assert.ok(actions.every(r=>r.data.phone==='+12025550124'));
  assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('code').textContent,'8765 4321');assert.match(p.element('pairing-account').textContent,/12025550124/);
});
test('late status response from previous account cannot replace the new-number form',async()=>{
  const p=await page();let resolve;
  p.defer(new Promise(r=>resolve=r));const pending=vm.runInContext('refresh()',p.context);await tick();
  p.element('another-account').onclick();p.element('phone').value='+12025550125';
  resolve({ok:true,status:200,json:async()=>({name:'Primera',phone:'+12025550123',country:'US',nationalNumber:'2025550123',status:'connected',consent:true})});await pending;
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

test('duplicate number error is visible and blocks repeated submissions until number changes',async()=>{
 const p=await page({registerStatus:409});p.element('another-account').onclick();p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});assert.match(p.element('error').textContent,/enlace privado/);assert.equal(p.element('error').hidden,false);assert.equal(p.element('connect-button').disabled,true);
 await p.element('connect').events.submit({preventDefault(){}});assert.equal(p.requests.filter(r=>r.url==='/api/register').length,1);
 p.element('phone').events.input();assert.equal(p.element('connect-button').disabled,false);
});
test('copying current code opens activation popup; expired code is never copied',async()=>{
 const p=await page();vm.runInContext("state={code:'12345678',expires:Date.now()+60000}",p.context);await p.element('copy').onclick();
 assert.equal(p.element('clipboard').value,'12345678');assert.equal(p.element('copy-help').open,true);p.element('close-copy-help').onclick();assert.equal(p.element('copy-help').open,false);
 p.element('clipboard').value='';vm.runInContext("state={code:'87654321',expires:Date.now()-1}",p.context);await p.element('copy').onclick();assert.equal(p.element('clipboard').value,'');
});

test('Safari pattern errors and network or invalid server responses are presented in Spanish',async()=>{
 const p=await page();
 const message=vm.runInContext("userError(Object.assign(new Error('The string did not match the expected pattern.'),{name:'SyntaxError'}))",p.context);
 assert.match(message,/No se pudo preparar la conexión/);assert.doesNotMatch(message,/pattern/);
 p.context.fetch=async()=>{throw TypeError('Load failed');};
 await assert.rejects(vm.runInContext("api('status')",p.context),/No se pudo conectar con el servicio/);
 p.context.fetch=async()=>({ok:false,status:503,json:async()=>{throw SyntaxError('The string did not match the expected pattern.');}});
 await assert.rejects(vm.runInContext("api('status')",p.context),/No se pudo leer la respuesta del servicio/);
});

test('background disconnected polling does not show an error, scroll or steal input focus',async()=>{
 const p=await page();p.account.status='disconnected';
 p.element('phone').value='321512';
 for(let n=0;n<3;n++)await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('connect').hidden,false);
 assert.equal(p.element('error').hidden,true);
 assert.equal(p.element('error').focusCount||0,0);
 assert.equal(p.element('error').scrollCount||0,0);
 assert.equal(p.element('phone').value,'321512');
 p.element('phone').value='';p.element('phone').events.input();
 await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('phone').value,'');
 p.element('country').value='CU';p.element('country').events.change();
 await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('country').value,'CU');
});
test('validation alerts clear when editing and repeated alerts do not scroll or focus again',async()=>{
 const p=await page();
 vm.runInContext("error('Escribe tu número correctamente.')",p.context);
 vm.runInContext("error('Escribe tu número correctamente.')",p.context);
 assert.equal(p.element('error').focusCount,1);
 assert.equal(p.element('error').scrollCount,1);
 p.element('phone').events.input();
 assert.equal(p.element('error').hidden,true);
 assert.equal(p.element('error').textContent,'');
});
