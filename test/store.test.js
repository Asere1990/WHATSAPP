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
