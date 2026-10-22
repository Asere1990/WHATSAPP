import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Accounts } from '../src/whatsapp.js';
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
  assert.equal(calls,1);assert.equal(s.enqueue(a.id,msg).state,'review');
});
