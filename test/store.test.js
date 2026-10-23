import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store,phoneNumber } from '../src/store.js';
function setup(t){const d=mkdtempSync(`${tmpdir()}/wa-test-`),s=new Store(d);t.after(()=>{s.db.close();rmSync(d,{recursive:true,force:true});});return s;}
test('invitation is one use; browser access is isolated and revocable',t=>{
  const s=setup(t),one=s.invite('+12025550123','Uno'),two=s.invite('+12025550124','Dos');
  const browser=s.exchange(one.secret);assert.ok(browser);assert.equal(s.exchange(one.secret),null);
  assert.equal(s.browser(browser).id,one.account.id);assert.notEqual(s.browser(browser).id,two.account.id);
  s.update(one.account.id,'consent',1);s.revoke(one.account.id);assert.equal(s.browser(browser),undefined);assert.equal(s.account(one.account.id).consent,0);
});
test('expired invitations cannot authorize; reissue invalidates previous link',t=>{
  const s=setup(t),one=s.invite('12025550123','Uno');s.db.prepare('UPDATE access SET expires=0').run();assert.equal(s.exchange(one.secret),null);
  const two=s.invite('12025550123','Uno'),three=s.invite('12025550123','Uno');assert.equal(s.exchange(two.secret),null);assert.ok(s.exchange(three.secret));
});
test('inbound message deduplication and reply routing survive reopening',t=>{
  const s=setup(t),a=s.invite('12025550123','Uno').account;
  const msg={id:{_serialized:'same-id'},from:'12025550125@c.us',body:'hola'};
  const one=s.enqueue(a.id,msg);s.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(one.id);assert.equal(s.enqueue(a.id,msg).state,'done');
  s.route('123',56,a.id,msg.from);assert.equal(s.getRoute('123',56).account,a.id);assert.equal(s.getRoute('456',56),undefined);
});
test('phone validation rejects code, markup and malformed account numbers',()=>{
  assert.equal(phoneNumber('+1 (202) 555-0123'),'12025550123');for(const p of ['123456','<script>','+012345678','abc',''])assert.throws(()=>phoneNumber(p));
});
test('public onboarding creates isolated browser access and cannot take over a known phone',t=>{
  const s=setup(t),first=s.register('+12025550123');assert.ok(first);assert.equal(s.browser(first).phone,'12025550123');
  assert.equal(s.register('+12025550123'),null);assert.equal(s.all().length,1);
  const existing=s.invite('+12025550124','Titular');s.update(existing.account.id,'consent',1);
  assert.equal(s.register('+12025550124'),null);assert.equal(s.account(existing.account.id).consent,1);
  const other=s.register('+12025550125');assert.notEqual(s.browser(first).id,s.browser(other).id);
});

test('string message IDs and non-text bodies do not break SQLite registration',t=>{
  const s=setup(t),a=s.invite('12025550123','Uno').account;
  const msg={id:'id-string',from:'12025550124@c.us',body:{system:true}};
  const one=s.enqueue(a.id,msg);assert.equal(one.body,'');assert.equal(one.message,'id-string');
  assert.equal(s.enqueue(a.id,msg).id,one.id);
});
test('system events are not inserted as conversations',t=>{
  const s=setup(t),a=s.invite('12025550123','Uno').account;
  assert.equal(s.enqueue(a.id,{from:'12025550124@c.us',type:'e2e_notification'}),null);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
});


test('unfinished attempts can restart with isolated access, preserving other connected accounts and cooldown',t=>{
 const s=setup(t),old=s.register('12025550123'),a=s.browser(old);
 s.update(a.id,'consent',1);s.update(a.id,'status','error');
 s.recordIncident(a.id,'conexion',{code:'WA_PAIRING_RATE_LIMIT'});
 const other=s.register('12025550124'),b=s.browser(other);s.update(b.id,'consent',1);s.update(b.id,'status','connected');
 const fresh=s.register(a.phone,{restartPending:true}),next=s.browser(fresh);
 assert.ok(next);assert.notEqual(next.id,a.id);assert.equal(next.linked,0);assert.equal(next.status,'pending');assert.equal(next.consent,0);
 assert.equal(s.browser(old),undefined);assert.equal(s.account(a.id).status,'archived');assert.equal(s.account(a.id).consent,0);
 assert.equal(s.browser(other).status,'connected');assert.equal(s.browser(other).consent,1);
 assert.equal(s.register(b.phone,{restartPending:true}),null);
 const cooldown=s.db.prepare("SELECT created FROM incidents WHERE account=? AND code='WA_PAIRING_RATE_LIMIT'").get(next.id);
 assert.equal(cooldown.created,s.db.prepare("SELECT created FROM incidents WHERE account=? AND code='WA_PAIRING_RATE_LIMIT'").get(a.id).created);
});

test('once linked, a later failure and expired audit never allow public registration to claim the account',t=>{
 const s=setup(t),secret=s.register('12025550123'),a=s.browser(secret);
 s.update(a.id,'consent',1);s.update(a.id,'status','connected');s.update(a.id,'status','error');
 s.db.prepare('DELETE FROM audit WHERE account=?').run(a.id);
 assert.equal(s.register(a.phone,{restartPending:true}),null);
 assert.equal(s.browser(secret).linked,1);assert.equal(s.browser(secret).consent,1);
});

test('legacy connected accounts acquire a durable linked marker without changing their browser access',t=>{
 const d=mkdtempSync(`${tmpdir()}/wa-migration-`),s=new Store(d);
 const secret=s.register('12025550123'),a=s.browser(secret);s.update(a.id,'consent',1);s.update(a.id,'status','error');s.audit(a.id,'connected');
 s.db.exec('ALTER TABLE accounts DROP COLUMN linked; ALTER TABLE accounts DROP COLUMN confirmed');s.db.close();
 const migrated=new Store(d);t.after(()=>{migrated.db.close();rmSync(d,{recursive:true,force:true});});
 assert.equal(migrated.browser(secret).linked,1);assert.equal(migrated.browser(secret).status,'error');
 assert.equal(migrated.register(a.phone,{restartPending:true}),null);
});


test('every never-linked failure state can restart after a browser reload or server restart',t=>{
 const s=setup(t);
 for(const [index,status]of ['pending','connecting','error','expired','needs_pairing','auth_failure','disconnected'].entries()){
  const secret=s.register('12025550'+String(200+index)),a=s.browser(secret);
  s.update(a.id,'consent',1);s.update(a.id,'status',status);
  const next=s.register(a.phone,{restartPending:true});assert.ok(next,status);
  assert.equal(s.browser(secret),undefined);assert.equal(s.browser(next).phone,a.phone);
 }
});


test('migration repairs authentication-only legacy attempts while preserving accounts that reached ready',t=>{
 const d=mkdtempSync(`${tmpdir()}/wa-confirmation-`),s=new Store(d);
 const pending=s.register('12025550123'),a=s.browser(pending);s.update(a.id,'consent',1);s.update(a.id,'linked',1);s.update(a.id,'status','error');s.saveProfile(a.id,a.phone+'@c.us','Cuenta de WhatsApp',a.phone);
 const active=s.register('12025550124'),b=s.browser(active);s.update(b.id,'consent',1);s.update(b.id,'status','connected');s.audit(b.id,'connected');s.update(b.id,'status','error');
 s.db.exec('ALTER TABLE accounts DROP COLUMN confirmed');s.db.close();
 const migrated=new Store(d);t.after(()=>{migrated.db.close();rmSync(d,{recursive:true,force:true});});
 assert.equal(migrated.account(a.id).confirmed,0);assert.equal(migrated.account(b.id).confirmed,1);
 const fresh=migrated.register(a.phone,{restartPending:true});assert.ok(fresh);assert.equal(migrated.browser(pending),undefined);
 assert.equal(migrated.register(b.phone,{restartPending:true}),null);assert.equal(migrated.browser(active).id,b.id);
});
