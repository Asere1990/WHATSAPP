import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {AssociatedLinks} from '../src/associated-links.js';
import {AssociatedLinkCounts} from '../src/associated-link-counts.js';

function data(t){const dir=mkdtempSync(tmpdir()+'/wa-opening-'),store=new Store(dir),links=new AssociatedLinks(store);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {dir,store,links};}
test('daily and total counters persist independently for each associated link',t=>{
 const {store,dir,links}=data(t),a=links.save('12025550123','text','A'),b=links.save('12025550124','text','B');
 let now=Date.UTC(2026,9,29,18,0);const counts=new AssociatedLinkCounts(store,{now:()=>now});
 assert.deepEqual(counts.totals(a.token),{today:0,total:0});
 assert.deepEqual(counts.record(a.token,a.phone),{phone:a.phone,today:1,total:1,time:now});
 assert.equal(counts.record(a.token,a.phone).today,2);
 assert.equal(counts.record(b.token,b.phone).today,1);
 assert.deepEqual(counts.totals(a.token),{today:2,total:2});
 now+=86400000;
 assert.deepEqual(counts.totals(a.token),{today:0,total:2});
 assert.deepEqual(counts.record(a.token,a.phone),{phone:a.phone,today:1,total:3,time:now});
 const reopened=new Store(dir),copy=new AssociatedLinkCounts(reopened,{now:()=>now});
 assert.deepEqual(copy.totals(a.token),{today:1,total:3});
 reopened.db.close();
});
test('notifications include assigned number and daily/lifetime counts, not identity or IP',async t=>{
 const {store,links}=data(t),entry=links.save('12025550126','text','Privado'),counts=new AssociatedLinkCounts(store,{now:()=>Date.UTC(2026,9,29,20)});
 const event=counts.record(entry.token,entry.phone),out=[];
 await counts.notify({send:async(chat,message)=>out.push({chat,message})},event);
 assert.equal(out[0].chat,'-1004461387155');
 assert.match(out[0].message,/Número asignado al enlace: \+12025550126/);
 assert.match(out[0].message,/Aperturas hoy: 1/);
 assert.match(out[0].message,/Aperturas acumuladas: 1/);
 assert.match(out[0].message,/no a la persona que lo abrió/);
 assert.doesNotMatch(out[0].message,/dirección IP|GPS|ubicación aproximada/);
});
test('malformed links or invalid assigned number do not modify the counters',t=>{
 const {store}=data(t),counts=new AssociatedLinkCounts(store);
 assert.equal(counts.record('short','12025550123'),null);
 assert.equal(counts.record('A'.repeat(43),'bad-number'),null);
 assert.deepEqual(counts.totals('short'),{today:0,total:0});
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM wa_associated_link_daily').get().n,0);
});
