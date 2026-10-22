import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Accounts } from '../src/whatsapp.js';
import { Telegram } from '../src/telegram.js';
function setup(t,notify=async()=>({chat:{id:123},message_id:1})){
  const dir=mkdtempSync(`${tmpdir()}/wa-accounts-`),s=new Store(dir),a=s.invite('12025550123','Test').account;
  s.update(a.id,'consent',1);const manager=new Accounts(s,dir,notify);
  t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});return {s,a,manager};
}
test('pause and revoked consent block outgoing messages',async t=>{
  const {s,a,manager}=setup(t);let sent=0;manager.live.set(a.id,{ready:true,client:{sendMessage:async()=>{sent++}}});
  s.update(a.id,'paused',1);await assert.rejects(manager.send(a.id,'12025550124@c.us','hola'));assert.equal(sent,0);
  s.update(a.id,'paused',0);await manager.send(a.id,'12025550124@c.us','hola');assert.equal(sent,1);
  s.revoke(a.id);await assert.rejects(manager.send(a.id,'12025550124@c.us','hola'));assert.equal(sent,1);
});
test('duplicate incoming event is not mirrored or auto-replied twice',async t=>{
  let mirrored=0,sent=0;const {s,a,manager}=setup(t,async()=>{mirrored++;return {chat:{id:123},message_id:mirrored};});
  manager.live.set(a.id,{ready:true,client:{sendMessage:async()=>{sent++}}});s.setRule(a.id,'hola','Buenos días');
  const msg={id:{_serialized:'msg-1'},from:'12025550124@c.us',body:'hola'};await manager.receive(a.id,msg);await manager.receive(a.id,msg);assert.equal(sent,1);assert.equal(mirrored,2);
});
test('uncertain Telegram failure is held for review, not automatically resent',async t=>{
  let calls=0;const {s,a,manager}=setup(t,async()=>{calls++;throw new Error('network');});
  const msg={id:{_serialized:'msg-1'},from:'12025550124@c.us',body:'hola'};await assert.rejects(manager.receive(a.id,msg));await manager.receive(a.id,msg);
  assert.equal(calls,2);assert.equal(s.enqueue(a.id,msg).state,'review');
});

test('an error before inbox insertion is persisted and visible in /pendientes',async t=>{
  const notices=[];const {s,a,manager}=setup(t,async text=>{notices.push(text);return {chat:{id:123},message_id:1};});
  const msg={from:'12025550124@c.us',type:'chat',body:'hola'};
  await assert.rejects(manager.receive(a.id,msg));
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
  const incidents=s.openIncidents();assert.equal(incidents.length,1);assert.equal(incidents[0].code,'INVALID_MESSAGE_ID');
  assert.match(notices[0],/Incidencia #1/);
  const bot=new Telegram(s,{admins:'123'});let reply='';
  bot.send=async(chat,text)=>{reply=text;};
  await bot.handle({message:{text:'/pendientes',from:{id:123},chat:{id:123,type:'private'}}});
  assert.match(reply,/Incidencia #1/);assert.doesNotMatch(reply,/Sin incidencias/);
});
test('non-chat events after linking cause neither alerts nor incidents',async t=>{
  let sent=0;const {s,a,manager}=setup(t,async()=>{sent++;});
  await manager.receive(a.id,{from:'12025550124@c.us',type:'e2e_notification'});
  assert.equal(sent,0);assert.equal(s.openIncidents().length,0);
});
test('SQL failure before insertion remains reviewable without replaying messages',async t=>{
  const notices=[];const {s,a,manager}=setup(t,async text=>{notices.push(text);return {chat:{id:123},message_id:1};});
  s.enqueue=()=>{const err=new Error('binding');err.code='ERR_SQLITE_ERROR';throw err;};
  const msg={id:{_serialized:'sql-failure'},from:'12025550124@c.us',body:'hola'};
  await assert.rejects(manager.receive(a.id,msg));
  assert.equal(s.openIncidents()[0].stage,'registro');assert.match(notices[0],/guardada|Guardada/);
});

test('repeated ready events send one connection notice per active connection',async t=>{
  let notices=0;const {s,a,manager}=setup(t,async()=>{notices++;});
  const entry={ready:false,code:'pending',client:{info:{wid:{user:a.phone}}}};
  manager.live.set(a.id,entry);
  await Promise.all([manager.connected(a.id,entry),manager.connected(a.id,entry)]);
  assert.equal(notices,1);assert.equal(entry.ready,true);assert.equal(entry.code,null);
  assert.equal(s.account(a.id).status,'connected');
  entry.ready=false;
  await manager.connected(a.id,entry);assert.equal(notices,2);
  manager.live.delete(a.id);entry.ready=false;
  await manager.connected(a.id,entry);assert.equal(notices,2);
});
