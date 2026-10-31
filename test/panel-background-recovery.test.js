import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {PanelProfiles} from '../src/panel-profiles.js';
import {PanelMetadataRecovery,messageContactName} from '../src/panel-metadata-recovery.js';
import {BaileysClient} from '../src/baileys.js';
import {WebPanel} from '../src/panel.js';

const jid='12025550129@s.whatsapp.net',lid='987654321@lid',group='123456789@g.us';
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-bg-metadata-'),store=new Store(dir);
 const a=store.invite('12025550123','Primera').account,b=store.invite('12025550124','Segunda').account;
 for(const x of [a,b]){
  store.update(x.id,'consent',1);
  store.update(x.id,'status','connected');
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(x.id);
  store.setConfig('engine:'+x.id,'baileys');
 }
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,a,b,db:new BaileysStore(store,a.id)};
}
const raw=(peer,id,fromMe=false,pushName='Nombre verificado',timestamp=100)=>({
 key:{remoteJid:peer,id,fromMe},pushName,messageTimestamp:timestamp,message:{conversation:'Hola'}
});
const recovery=store=>{const scan=new PanelMetadataRecovery(store,{batchSize:2,scanDelay:10000});scan.started=true;return scan;};

test('background name recovery indexes already stored messages without an open panel or socket',t=>{
 const {store,a,db}=setup(t);
 db.message(raw(jid,'first',false,'Amiga Clara',100));
 db.message(raw(lid,'alias',false,'Clara en WhatsApp',101));
 db.message(raw(group,'group',false,'Mi vecino',102));
 db.message(raw(jid,'mine',true,'Mi propio apodo',103));
 const worker=recovery(store);t.after(()=>worker.shutdown());
 worker.step();
 const marker=Number(store.config()['panel:name-scan:v1:'+a.id]);
 assert.ok(marker>0,'progress is written to the persistent config table');
 worker.step();worker.step();
 const aName=db.get('panel-name',jid),bName=db.get('panel-name',lid);
 assert.equal(aName?.name,'Amiga Clara');
 assert.equal(bName?.name,'Clara en WhatsApp');
 assert.equal(db.get('panel-name',group),undefined,'never mistake a group sender for the group name');
 assert.equal(new BaileysStore(store,store.all().find(x=>x.id!==a.id).id).get('panel-name',jid),undefined);
 assert.equal(db.get('message',db.messageKey(raw(jid,'first').key)).pushName,'Amiga Clara',
  'original saved messages remain intact');
});

test('cached phone and LID aliases show real sender names only if WhatsApp provided them',t=>{
 const {store,a,db}=setup(t);
 const accounts={live:new Map()},profiles=new PanelProfiles(store,accounts);
 db.put('mapping',lid,jid);
 db.put('chat',jid,{id:jid,conversationTimestamp:100});
 db.message(raw(lid,'inbound',false,'Clara Verified',200));
 const worker=recovery(store);t.after(()=>worker.shutdown());worker.step();worker.step();
 assert.equal(profiles.name(a.id,jid),'Clara Verified');
 db.put('contact',jid,{id:jid,name:'Nombre de agenda'});
 assert.equal(profiles.name(a.id,jid),'Nombre de agenda',
  'the original saved contact name takes precedence over recovered pushName');
});

test('resume markers prevent repeated scans after a process restart, and accept new history later',t=>{
 const {store,a,db}=setup(t);
 db.message(raw(jid,'old',false,'Nombre anterior',100));
 let worker=recovery(store);worker.step();worker.shutdown();
 const first=store.config()['panel:name-scan:v1:'+a.id];
 assert.ok(Number(first)>0);
 worker=recovery(store);t.after(()=>worker.shutdown());
 worker.step();assert.equal(store.config()['panel:name-scan:v1:'+a.id],first);
 db.message(raw(jid,'new',false,'Nombre actualizado',200));
 worker.step();
 assert.equal(db.get('panel-name',jid)?.name,'Nombre actualizado');
 assert.ok(Number(store.config()['panel:name-scan:v1:'+a.id])>Number(first));
});

test('old messages never replace newer names; number-like and outgoing names are rejected',t=>{
 const {store,a,db}=setup(t);
 db.message(raw(jid,'newer',false,'Clara actual',200));
 db.message(raw(jid,'old',false,'Clara antigua',100));
 db.message(raw('99999@lid','id',false,'123456789',300));
 const worker=recovery(store);t.after(()=>worker.shutdown());
 worker.step();worker.step();
 assert.equal(db.get('panel-name',jid)?.name,'Clara actual');
 assert.equal(db.get('panel-name','99999@lid'),undefined);
 assert.equal(messageContactName(raw(jid,'outgoing',true)),null);
 assert.equal(messageContactName(raw(group,'group')),null);
 assert.equal(messageContactName({...raw(jid,'participant'),key:{remoteJid:jid,id:'participant',participant:group,fromMe:false}}),null);
});

test('revoked and corporate accounts are not indexed in the background',t=>{
 const {store,a,b,db}=setup(t);
 store.setConfig('portal:'+a.id,'cubamax-corporate');
 store.revoke(b.id);
 db.message(raw(jid,'one',false,'Should not index',100));
 const worker=recovery(store);t.after(()=>worker.shutdown());
 assert.deepEqual(worker.allowedAccounts(),[]);
 worker.step();assert.equal(db.get('panel-name',jid),undefined);
});

test('background recovery keeps working on an authorized account even when its connection is offline',t=>{
 const {store,a,db}=setup(t);
 store.update(a.id,'status','disconnected');
 db.message(raw(jid,'offline',false,'Nombre offline',100));
 const worker=recovery(store);t.after(()=>worker.shutdown());worker.step();
 assert.equal(db.get('panel-name',jid)?.name,'Nombre offline');
});

test('history schedules are faster only for confirmed WhatsApp archive accounts and preserve existing backoff',async t=>{
 const {store,a}=setup(t);
 store.setConfig('panel_archive','1');
 const client=new BaileysClient({store,id:a.id,phone:a.phone,persistentRecovery:true});
 t.after(()=>client.destroy());
 client.socket={user:{id:a.phone+':1@s.whatsapp.net'},end(){},fetchMessageHistory:async()=>true};
 client.generation=1;
 await client.onConnection({connection:'open'},1);
 const now=Date.now();
 assert.ok(client.historyDue>now&&client.historyDue<=now+31000,
  'background history runs even without an open browser');
 assert.equal(client.panelFocusPeer,null);
 client.stopHistory();
});

test('avatar requests have their own quota and cannot block existing chat or gallery quota',t=>{
 const {store}=setup(t);
 const panel=new WebPanel(store,{live:new Map()},{
  admins:()=>new Set(['1']),permissions:()=>new Set()
 },{url:'http://test',allowedOrigins:new Set()});
 for(let i=0;i<190;i++)panel.limit('asset:1',240);
 for(let i=0;i<120;i++)panel.limit('user:1',180);
 assert.throws(()=>{for(let i=0;i<51;i++)panel.limit('asset:1',240);},/Espera/);
 panel.limit('user:1',180);
});
