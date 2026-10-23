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
async function page({registerStatus=201,completed=false,initialAccount={}}={}){
  const elements=new Map(),requests=[],intervals=new Map();let sequence=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,value:'',checked:false,textContent:'',disabled:false,events:{},setAttribute(){},focus(){this.focusCount=(this.focusCount||0)+1;},scrollIntoView(options){this.scrollCount=(this.scrollCount||0)+1;this.scrollOptions=options;},pause(){},showModal(){this.open=true;},close(){this.open=false;},play:async()=>{},appendChild(){},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
  let account={name:'Primera',phone:'+12025550123',country:'US',nationalNumber:'2025550123',status:'connected',consent:true,paused:false,...initialAccount};
  let deferStatus=null;
  const fetch=async(url,options={})=>{
    requests.push({url,data:options.body?JSON.parse(options.body):null});let data;
    if(url==='/api/branding')data={title:'WhatsApp',description:'Gestión',button:'Conectar'};
    else if(url==='/api/guides')data={android:[{title:'Android',text:'Paso',asset:null}],iphone:[{title:'iPhone',text:'Paso',asset:null}]};
    else if(url==='/api/status'){if(deferStatus){const pending=deferStatus;deferStatus=null;return pending;}data={...account};}
    else if(url==='/api/browser-reset')data={ok:true};
    else if(url==='/api/register'){if(completed)return {ok:true,status:200,json:async()=>({ok:true,completed:true})};if(registerStatus!==201)return {ok:false,status:registerStatus,json:async()=>({error:'duplicate'})};account={name:'Segunda',phone:JSON.parse(options.body).phone,status:'pending',consent:false,paused:false};data={ok:true};}
    else if(url==='/api/connect'){if(JSON.parse(options.body).phone!==account.phone)return {ok:false,status:400,json:async()=>({error:'Confirma tu número y la autorización.'})};account={...account,status:'connecting',consent:true,code:'87654321'};data={ok:true};}
    else throw Error('Unexpected request: '+url);
    return {ok:true,status:200,json:async()=>data};
  };
  const context=vm.createContext({document:{getElementById:element,styleSheets:[],createElement:()=>({})},localStorage:{getItem:()=> 'iphone',setItem(){}},location:{hash:'',pathname:'/',replace(path){this.replacedPath=path;}},history:{replaceState(){}},fetch,setInterval:fn=>{const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout,console,navigator:{clipboard:{writeText:async value=>{element('clipboard').value=value;}}}});
  vm.runInContext(source,context);for(let n=0;n<6;n++)await tick();
  return {element,requests,intervals,context,defer(promise){deferStatus=promise;},get account(){return account;}};
}
test('same browser connects a different phone with a new registration and code, never disconnecting first WhatsApp',async()=>{
  const p=await page();assert.equal(p.element('welcome').hidden,false);assert.equal(p.account.status,'connected');
  p.element('another-account').onclick();assert.equal(p.element('phone').value,'');assert.equal(p.element('consent').checked,false);assert.equal(p.intervals.size,0);
  p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
  await p.element('connect').events.submit({preventDefault(){}});
  const actions=p.requests.filter(r=>['/api/register','/api/connect','/api/disconnect'].includes(r.url));
  assert.deepEqual(actions.map(r=>r.url),['/api/register','/api/connect']);assert.ok(actions.every(r=>r.data.phone==='+12025550124'));
  assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('code').textContent,'8765 4321');assert.match(p.element('pairing-account').textContent,/12025550124/);
});
test('late status response from previous account cannot replace the new-number form',async()=>{
  const p=await page({initialAccount:{status:'pending'}});let resolve;
  p.defer(new Promise(r=>resolve=r));const pending=vm.runInContext('refresh()',p.context);await tick();
  p.element('another-account').onclick();p.element('phone').value='+12025550125';
  resolve({ok:true,status:200,json:async()=>({name:'Primera',phone:'+12025550123',country:'US',nationalNumber:'2025550123',status:'connected',consent:true})});await pending;
  assert.equal(p.element('connected').hidden,true);assert.equal(p.element('connect').hidden,false);assert.equal(p.element('phone').value,'+12025550125');
});
test('cancel after a completed account returns to clean welcome without revoking WhatsApp',async()=>{
  const p=await page();p.element('another-account').onclick();await p.element('cancel-new-account').onclick();
  assert.equal(p.element('welcome').hidden,false);assert.equal(p.element('phone').value,'');assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
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
 const p=await page({initialAccount:{status:'disconnected'}});
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

test('reloading with a saved unlinked session leaves country and phone empty',async()=>{
 const p=await page({initialAccount:{status:'disconnected'}});
 assert.equal(p.element('country').value,'');
 assert.equal(p.element('phone').value,'');
 assert.equal(p.element('consent').checked,false);
 p.account.status='disconnected';
 for(let n=0;n<3;n++)await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('country').value,'');
 assert.equal(p.element('phone').value,'');
 assert.equal(p.element('connect').hidden,false);
 assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
});

test('ENTENDIDO closes popup and centers the visible tutorial image without focusing input',async()=>{
 const p=await page();p.element('guide-image').hidden=false;p.element('copy-help').open=true;
 const inputFocus=p.element('phone').focusCount||0;
 p.element('close-copy-help').onclick();
 assert.equal(p.element('copy-help').open,false);
 assert.equal(p.element('guide-image').scrollCount,1);
 assert.equal(p.element('guide-image').scrollOptions.block,'center');
 assert.equal(p.element('guide-image').scrollOptions.behavior,'smooth');
 assert.equal(p.element('phone').focusCount||0,inputFocus);
});

test('last tutorial button opens WhatsApp instead of checking connection',async()=>{
 const p=await page();
 assert.equal(p.element('guide-next').textContent,'IR A LA APP');
 const count=p.requests.length;
 p.element('guide-next').onclick();
 assert.equal(p.context.location.href,'whatsapp://');
 assert.equal(p.requests.length,count);
});

test('reload of a pending pairing starts at welcome without revealing previous phone or code',async()=>{
 const p=await page({initialAccount:{status:'connecting',code:'OLD12345',expires:Date.now()+60000}});
 assert.equal(p.element('welcome').hidden,false);
 assert.equal(p.element('pairing').hidden,true);
 assert.equal(p.element('pairing-account').textContent,'');
 assert.equal(p.element('code').textContent,'···· ····');
 assert.equal(p.element('copy').disabled,true);
 assert.equal(p.element('country').value,'');assert.equal(p.element('phone').value,'');
 assert.equal(p.intervals.size,0);
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550123';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('code').textContent,'8765 4321');
 assert.equal(p.intervals.size,1);
 assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
});

test('temporary invalid status response preserves pairing screen, session and automatic polling',async()=>{
 const p=await page({initialAccount:{status:'connecting',code:null}});
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550123';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 const fetch=p.context.fetch;let fail=true;
 p.context.fetch=async(...args)=>{if(fail&&args[0]==='/api/status')return {ok:false,status:502,json:async()=>{throw SyntaxError('html');}};return fetch(...args);};
 await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('welcome').hidden,true);
 assert.equal(p.intervals.size,1);assert.equal(vm.runInContext('session',p.context),true);
 assert.match(p.element('expires').textContent,/no necesitas recargar/);assert.equal(p.element('error').hidden,true);
 fail=false;p.account.code='NEW12345';await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('code').textContent,'NEW1 2345');
 p.context.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Conecta tu cuenta'})});
 await vm.runInContext('refresh()',p.context);assert.equal(p.element('welcome').hidden,false);assert.equal(p.intervals.size,0);
});

test('three loading dots are visible only while waiting for a pairing code',async()=>{
 const p=await page({initialAccount:{status:'connecting',code:null}});
 await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('code-loading').hidden,false);assert.equal(p.element('code').hidden,true);assert.equal(p.element('copy').disabled,true);
 p.account.code='12345678';await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('code-loading').hidden,true);assert.equal(p.element('code').hidden,false);
 p.account.code=null;p.account.status='error';await vm.runInContext('refresh()',p.context);
 assert.equal(p.element('code-loading').hidden,true);assert.match(p.element('error').textContent,/Obtener código/);
});


test('saved disconnected session registers a changed phone before connecting from welcome',async()=>{
 const p=await page({initialAccount:{status:'disconnected'}});
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 const actions=p.requests.filter(r=>['/api/register','/api/connect','/api/disconnect'].includes(r.url));
 assert.deepEqual(actions.map(r=>r.url),['/api/register','/api/connect']);
 assert.ok(actions.every(r=>r.data.phone==='+12025550124'));
 assert.equal(p.element('error').hidden,true);assert.equal(p.element('pairing').hidden,false);
});

test('retry after connect failure reuses the newly registered phone session',async()=>{
 const p=await page({initialAccount:{status:'disconnected'}});
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
 const fetch=p.context.fetch;let fail=true;
 p.context.fetch=async(...args)=>{if(fail&&args[0]==='/api/connect'){fail=false;throw TypeError('Load failed');}return fetch(...args);};
 await p.element('connect').events.submit({preventDefault(){}});
 await p.element('connect').events.submit({preventDefault(){}});
 assert.equal(p.requests.filter(r=>r.url==='/api/register').length,1);
 assert.equal(p.element('pairing').hidden,false);assert.equal(p.element('error').hidden,true);
});

test('unchecked authorization never registers or connects a changed phone',async()=>{
 const p=await page({initialAccount:{status:'disconnected'}});
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=false;
 await p.element('connect').events.submit({preventDefault(){}});
 assert.equal(p.requests.some(r=>['/api/register','/api/connect'].includes(r.url)),false);
 assert.match(p.element('error').textContent,/autorización/);
});


test('reload of a connected account shows an empty landing without polling or disconnecting it',async()=>{
 const p=await page();
 assert.equal(p.element('welcome').hidden,false);assert.equal(p.element('connected').hidden,true);
 assert.equal(p.element('country').value,'');assert.equal(p.element('phone').value,'');assert.equal(p.element('consent').checked,false);
 assert.equal(p.intervals.size,0);assert.equal(p.account.status,'connected');
 assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
 p.element('begin').onclick();assert.equal(p.element('connect').hidden,false);
});


test('successful pairing clears browser state and next account registers independently',async()=>{
 const p=await page({initialAccount:{status:'pending'}});
 p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550123';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 p.account.status='connected';p.account.code=null;await vm.runInContext('refresh()',p.context);
 assert.equal(p.account.status,'connected');assert.equal(p.element('welcome').hidden,false);
 assert.equal(p.element('phone').value,'');assert.equal(p.element('country').value,'');assert.equal(p.element('consent').checked,false);
 assert.equal(p.element('pairing-account').textContent,'');assert.equal(p.element('connected-account').textContent,'');assert.equal(p.element('copy').disabled,true);assert.equal(p.intervals.size,0);
 assert.equal(vm.runInContext('session',p.context),false);assert.equal(vm.runInContext('browserPhone',p.context),null);
 assert.equal(p.requests.filter(r=>r.url==='/api/browser-reset').length,1);assert.equal(p.requests.some(r=>r.url==='/api/disconnect'),false);
 // Simulate Safari restoring old form fields before the next click.
 p.element('phone').value='2025550123';p.element('consent').checked=true;p.element('begin').onclick();assert.equal(p.element('phone').value,'');assert.equal(p.element('consent').checked,false);
 p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 const last=p.requests.filter(r=>['/api/register','/api/connect'].includes(r.url)).slice(-2);
 assert.deepEqual(last.map(r=>r.url),['/api/register','/api/connect']);assert.ok(last.every(r=>r.data.phone==='+12025550124'));assert.equal(p.element('pairing').hidden,false);
});

test('forgetting browser authorization preserves connected account and other browser access',t=>{
 const dir=mkdtempSync(`${tmpdir()}/wa-forget-`),store=new Store(dir);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const one=store.register('12025550123'),account=store.browser(one),two=store.exchange(store.invite(account.phone,'Prueba').secret);
 store.update(account.id,'consent',1);store.update(account.id,'status','connected');
 store.forgetBrowser(one);assert.equal(store.browser(one),undefined);assert.equal(store.browser(two).id,account.id);
 assert.equal(store.account(account.id).status,'connected');assert.equal(store.account(account.id).consent,1);assert.equal(store.account(account.id).confirmed,1);
});


test('only an already enrolled number shows the red notice without acquiring access or connecting again',async()=>{
 const p=await page({completed:true,initialAccount:{status:'pending'}});p.element('begin').onclick();p.element('country').value='US';p.element('phone').value='2025550124';p.element('consent').checked=true;
 await p.element('connect').events.submit({preventDefault(){}});
 assert.equal(p.requests.some(r=>r.url==='/api/connect'),false);assert.equal(p.element('error').hidden,false);assert.equal(p.element('error').textContent,'Ya estás conectado al sistema.');assert.equal(p.element('phone').value,'2025550124');assert.equal(p.element('connect-button').disabled,true);assert.equal(p.context.location.replacedPath,undefined);assert.equal(vm.runInContext('session',p.context),false);
 p.element('phone').value='2025550125';p.element('phone').events.input();assert.equal(p.element('error').hidden,true);assert.equal(p.element('connect-button').disabled,false);
});

test('an unlinked legacy account can restart only when explicitly classified without usable credentials',t=>{
 const dir=mkdtempSync(`${tmpdir()}/wa-unlinked-`),store=new Store(dir);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const token=store.register('12025550123'),a=store.browser(token);store.update(a.id,'consent',1);store.update(a.id,'status','connected');store.update(a.id,'status','needs_pairing');
 assert.equal(store.register(a.phone,{restartPending:true}),null);
 const next=store.register(a.phone,{restartPending:true,restartUnlinked:true});assert.ok(next);assert.notEqual(store.browser(next).id,a.id);assert.equal(store.account(a.id).status,'archived');assert.equal(store.browser(token),undefined);assert.equal(store.browser(next).confirmed,0);
});
