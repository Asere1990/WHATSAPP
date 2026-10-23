import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync,lstatSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Accounts } from '../src/whatsapp.js';
import { Telegram } from '../src/telegram.js';
import { releaseStaleLock,connectionLabel,connectionErrorCode } from '../src/session.js';
function folder(t){const dir=mkdtempSync(`${tmpdir()}/wa-recovery-`);t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function setup(t,createClient){const dir=folder(t),s=new Store(dir),a=s.invite('12025550123','Prueba').account;s.update(a.id,'consent',1);const messages=[];
  const manager=new Accounts(s,dir,async text=>{messages.push(text);},2,createClient);t.after(async()=>{await manager.close(a.id);s.db.close();});return {dir,s,a,manager,messages};}
test('old-host Chromium markers are cleared without touching account credentials',t=>{
  const dir=folder(t);mkdirSync(path.join(dir,'Default'));writeFileSync(path.join(dir,'Default','Cookies'),'preserved');
  symlinkSync('old-host-123',path.join(dir,'SingletonLock'));symlinkSync('/tmp/old-socket',path.join(dir,'SingletonSocket'));symlinkSync('cookie-id',path.join(dir,'SingletonCookie'));
  assert.equal(releaseStaleLock(dir,'new-host',()=>true),true);
  assert.throws(()=>lstatSync(path.join(dir,'SingletonLock')),/ENOENT/);assert.equal(readFileSync(path.join(dir,'Default','Cookies'),'utf8'),'preserved');
});
test('an active local browser lock is retained',t=>{
  const dir=folder(t);symlinkSync('current-host-123',path.join(dir,'SingletonLock'));
  assert.equal(releaseStaleLock(dir,'current-host',()=>true),false);assert.equal(lstatSync(path.join(dir,'SingletonLock')).isSymbolicLink(),true);
});
test('a dead local browser releases its marker but a normal file is never deleted',t=>{
  const dir=folder(t);symlinkSync('current-host-123',path.join(dir,'SingletonLock'));
  assert.equal(releaseStaleLock(dir,'current-host',()=>false),true);writeFileSync(path.join(dir,'SingletonLock'),'regular-file');
  assert.equal(releaseStaleLock(dir,'current-host',()=>false),false);assert.equal(readFileSync(path.join(dir,'SingletonLock'),'utf8'),'regular-file');
});
test('restoring after browser launch failure retains consent and credentials, records the error and allows retry',async t=>{
  let attempt=0;
  class Fake extends EventEmitter{async initialize(){if(++attempt===1)throw new Error('The profile appears to be in use by another Chromium process');}async destroy(){}}
  const {dir,s,a,manager,messages}=setup(t,()=>new Fake());const profile=path.join(dir,'sessions',`session-${a.id}`);mkdirSync(profile,{recursive:true});writeFileSync(path.join(profile,'credentials'),'preserved');
  await manager.restore();const first=manager.live.get(a.id);if(first)await first.initializing;
  assert.equal(s.account(a.id).status,'error');assert.equal(s.account(a.id).consent,1);assert.equal(manager.live.has(a.id),false);
  assert.equal(readFileSync(path.join(profile,'credentials'),'utf8'),'preserved');assert.equal(s.openIncidents()[0].code,'PROFILE_LOCKED');assert.match(messages[0],/PROFILE_LOCKED/);
  const retry=await manager.start(a.id);await retry.initializing;assert.equal(attempt,2);assert.equal(manager.live.get(a.id),retry);
});
test('saved session restores through ready without requesting a new pairing code',async t=>{
  let options;
  class Fake extends EventEmitter{constructor(){super();this.info={wid:{user:'12025550123'},pushname:'Nombre real'};}async initialize(){this.emit('authenticated');this.emit('ready');}async destroy(){}}
  const {dir,s,a,manager}=setup(t,o=>{options=o;return new Fake();});mkdirSync(path.join(dir,'sessions',`session-${a.id}`),{recursive:true});
  await manager.restore();const entry=manager.live.get(a.id);await entry.initializing;
  assert.equal(entry.ready,true);assert.equal(s.account(a.id).status,'connected');assert.equal(options.pairWithPhoneNumber,undefined);
});
test('a missing local session is distinguished from an inactive server connection',async t=>{
  const {s,a,manager}=setup(t,()=>assert.fail('No browser should be launched'));await manager.restore();
  assert.equal(s.account(a.id).status,'needs_pairing');assert.equal(connectionLabel(manager,s.account(a.id)),'Requiere vinculación');assert.equal(s.account(a.id).consent,1);
});
test('private account card offers recovery and shows initialization status accurately',async t=>{
  class Fake extends EventEmitter{async initialize(){}async destroy(){}}
  const {s,a,manager}=setup(t,()=>new Fake()),bot=new Telegram(s,{admins:'123'});bot.accounts=manager;const sent=[];bot.api=async(method,body)=>{sent.push(body);return {};};
  await bot.control.account(123,123,a.id);assert.match(sent.at(-1).reply_markup.inline_keyboard[0][0].text,/RECUPERAR/);
  await bot.control.action(123,123,{kind:'recover',id:a.id});assert.equal(connectionLabel(manager,s.account(a.id)),'Conectando / sincronizando');
});
test('error classifications never include credentials or raw error content',()=>{
  assert.equal(connectionErrorCode(Error('secret text timeout')),'INIT_TIMEOUT');assert.equal(connectionErrorCode(Error('unknown private text')),'INIT_FAILED');
});
test('explicit unlink allows same number to register with fresh identity while preserving archived history',async t=>{
 class Fake extends EventEmitter{async initialize(){}async logout(){this.emit('disconnected','LOGOUT');}async destroy(){}}
 const {s,a,manager}=setup(t,()=>new Fake());const oldSession=s.register('12025550124');
 const link=s.invite(a.phone,'Owner'),oldSecret=s.exchange(link.secret);
 s.claimExport(a.id,'kept-file');s.finishExport(a.id,'kept-file','done');s.route('-123',5,a.id,'12025550124@c.us');
 await manager.start(a.id);await manager.disconnect(a.id);assert.equal(s.account(a.id).status,'revoked');assert.ok(!s.browser(oldSecret));
 const fresh=s.register(a.phone),next=s.browser(fresh);assert.ok(next);assert.notEqual(next.id,a.id);assert.equal(next.consent,0);assert.equal(next.phone,a.phone);
 assert.equal(s.all().some(x=>x.id===a.id),false);assert.equal(s.exportState(a.id,'kept-file'),'done');assert.equal(s.getRoute('-123',5).account,a.id);
 assert.equal(JSON.parse(s.db.prepare('SELECT metadata FROM account_archives WHERE account=?').get(a.id).metadata).phone,a.phone);
 assert.equal(s.register(a.phone),null);assert.ok(s.browser(oldSession));
});
test('LOGOUT from WhatsApp revokes browser access, while a temporary disconnection cannot release number',async t=>{
 class Fake extends EventEmitter{async initialize(){}async destroy(){}}
 const {s,a,manager}=setup(t,()=>new Fake());const invite=s.invite(a.phone,'Owner'),secret=s.exchange(invite.secret);
 let e=await manager.start(a.id);e.client.emit('disconnected','CONFLICT');assert.equal(s.account(a.id).consent,1);assert.equal(s.register(a.phone),null);assert.ok(s.browser(secret));
 e=await manager.start(a.id);e.client.emit('disconnected','LOGOUT');assert.equal(s.account(a.id).consent,0);assert.equal(s.account(a.id).status,'revoked');assert.ok(!s.browser(secret));assert.ok(s.register(a.phone));
});

test('unawaited library pairing rejection is contained to its own account',async t=>{
 class Fake extends EventEmitter{
   async requestPairingCode(){throw Error('t: t');}
   async initialize(){this.requestPairingCode('12025550123');}
   async destroy(){}
 }
 const {s,a,manager}=setup(t,()=>new Fake());
 const other=s.invite('12025550124','Other').account;s.update(other.id,'consent',1);
 manager.live.set(other.id,{ready:true,client:{destroy:async()=>{}}});
 const entry=await manager.start(a.id,true);await entry.initializing;
 for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.account(a.id).status,'error');assert.equal(manager.live.has(a.id),false);
 assert.equal(manager.live.get(other.id).ready,true);
 assert.equal(s.openIncidents().find(x=>x.account===a.id).code,'WA_PAIRING_CODE');
});

test('retry isolates an unfinished browser profile while preserving confirmed account credentials',async t=>{
 class Fake extends EventEmitter{async initialize(){}async destroy(){}}
 const {dir,s,a,manager}=setup(t,()=>new Fake());const profile=path.join(dir,'sessions',`session-${a.id}`);
 mkdirSync(profile,{recursive:true});writeFileSync(path.join(profile,'credentials'),'pending');
 await manager.start(a.id,true);assert.throws(()=>readFileSync(path.join(profile,'credentials')));await manager.close(a.id);
 mkdirSync(profile,{recursive:true});writeFileSync(path.join(profile,'credentials'),'confirmed');s.audit(a.id,'connected');
 await manager.start(a.id,true);assert.equal(readFileSync(path.join(profile,'credentials'),'utf8'),'confirmed');
});
test('a code request that never settles is stopped within its deadline, with other accounts untouched',async t=>{
 class Fake extends EventEmitter{async initialize(){}async destroy(){}}
 const {s,a,manager}=setup(t,()=>new Fake());manager.pairingTimeoutMs=10;
 const other=s.invite('12025550124','Other').account;manager.live.set(other.id,{ready:true,client:{destroy:async()=>{}}});
 await manager.start(a.id,true);await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(manager.live.has(a.id),false);assert.equal(s.account(a.id).status,'error');
 assert.equal(s.openIncidents().find(x=>x.account===a.id).code,'WA_PAIRING_TIMEOUT');
 assert.equal(manager.live.get(other.id).ready,true);
});

test('confirmed WhatsApp 429 pauses new pairing requests without affecting live accounts',async t=>{
 let launched=0;class Fake extends EventEmitter{async initialize(){}async destroy(){}}
 const {s,a,manager}=setup(t,()=>{launched++;return new Fake();});
 s.recordIncident(a.id,'conexion',{code:'WA_PAIRING_RATE_LIMIT'});
 assert.ok(manager.pairingRetryAfter(a.id)>Date.now());
 await assert.rejects(manager.start(a.id,true),/WhatsApp limitó/);assert.equal(launched,0);
 s.db.prepare("UPDATE incidents SET created=? WHERE account=?").run(Date.now()-1800001,a.id);
 assert.equal(manager.pairingRetryAfter(a.id),0);await manager.start(a.id,true);assert.equal(launched,1);
});
