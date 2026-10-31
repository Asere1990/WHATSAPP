import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {BaileysClient} from '../src/baileys.js';
import {PanelMetadataRecovery} from '../src/panel-metadata-recovery.js';
import {receivedHistoryAnchor,oldestChatHistoryAnchor} from '../src/history-recovery-anchors.js';

const pn='12025550129@s.whatsapp.net',pn2='12025550131@s.whatsapp.net',group='123456789@g.us';
const message=(peer,id,ts=1700000000,extra={})=>({
 key:{remoteJid:peer,id,fromMe:false},messageTimestamp:ts,...extra
});
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-anchors-'),store=new Store(dir);
 const a=store.invite('12025550123','Primera').account,b=store.invite('12025550124','Segunda').account;
 for(const row of [a,b]){
  store.update(row.id,'consent',1);
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(row.id);
  store.setConfig('engine:'+row.id,'baileys');
 }
 store.setConfig('panel_archive','1');
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,a,b,db:new BaileysStore(store,a.id)};
}
function clientFor(t,store,a){
 const client=new BaileysClient({store,id:a.id,phone:a.phone,persistentRecovery:true});
 const history=[];
 client.socket={fetchMessageHistory:async(...args)=>{history.push(args);return 'accepted';},end(){}};
 client.historyOnline=true;
 t.after(()=>client.destroy());
 return {client,history};
}
function stepWorker(t,store,options={}){
 const worker=new PanelMetadataRecovery(store,{batchSize:2,scanDelay:99999,...options});
 worker.started=true;t.after(()=>worker.shutdown());
 return worker;
}
test('only a real WhatsApp message key and timestamp can anchor history, never chat IDs',()=>{
 const genuine=message(pn,'ABCD-1234');
 assert.deepEqual(receivedHistoryAnchor(genuine),{key:genuine.key,messageTimestamp:genuine.messageTimestamp});
 for(const bad of [
  {key:{remoteJid:pn,id:'',fromMe:false},messageTimestamp:1700000000},
  {key:{remoteJid:pn,id:'ABCD'},messageTimestamp:1700000000},
  {key:{remoteJid:pn,id:'ABCD',fromMe:false},messageTimestamp:0},
  {key:{remoteJid:'123@other.example',id:'ABCD',fromMe:false},messageTimestamp:1700000000},
  {key:{remoteJid:pn,id:'ABCD',fromMe:false},messageTimestamp:9999999999999},
  {key:{remoteJid:pn,id:'bad id',fromMe:false},messageTimestamp:1700000000}
 ])assert.equal(receivedHistoryAnchor(bad),null);
 assert.equal(oldestChatHistoryAnchor({id:pn,conversationTimestamp:1700000000}),null,
  'timestamps alone cannot be used to fabricate history requests');
 assert.equal(receivedHistoryAnchor(genuine,pn2),null,'chat keys must not be assigned to a different contact');
});
test('an authentic older chat key is recovered from WhatsApp headers without message bodies',t=>{
 const {store,a,db}=setup(t),{client,history}=clientFor(t,store,a);
 const old=message(pn,'old-original',1700000000),newer=message(pn,'new-original',1700000100);
 client.saveChat({id:pn,name:'Alguien',conversationTimestamp:1700000100,
  messages:[newer],lastMessage:old});
 assert.equal(db.get('cursor',pn)?.key.id,'old-original');
 assert.equal(db.get('history-priority',pn)?.peer,pn);
 assert.equal(db.messages(pn).length,0,'headers are not mistaken for real message content');
 assert.equal(db.get('chat',pn)?.lastMessage,undefined,'original gallery-only metadata rules stay unchanged');
 assert.equal(db.get('chat',pn)?.name,'Alguien');
 assert.ok(client.historyTimer,'the existing background history scheduler wakes even without a browser');
});
test('an incomplete but anchored chat is requested before a complete chat without ignoring cooldown',async t=>{
 const {store,a,db}=setup(t),{client,history}=clientFor(t,store,a);
 const older=message(pn2,'complete-1234',1700000000,{message:{conversation:'hello'}});
 client.saveMessage(older);
 client.saveChat({id:pn,conversationTimestamp:1700000200,lastMessage:message(pn,'anchor-1234',1700000200)});
 const now=Date.now();
 await client.pumpHistory(now);
 assert.equal(history.length,1);
 assert.equal(history[0][1].remoteJid,pn);
 assert.equal(history[0][1].id,'anchor-1234');
 assert.equal(history[0][2],1700000200000);
 assert.ok(db.get('history-sync',pn)?.next>now);
 await client.pumpHistory(now+1000);
 assert.equal(history.length,2);
 assert.equal(history[1][1].remoteJid,pn2,'complete chats still get a turn');
 const delivered=message(pn,'received-1234',1700000300,{message:{conversation:'Llegó WhatsApp'}});
 client.saveMessage(delivered);
 assert.equal(db.get('history-priority',pn),undefined,'the priority marker clears when actual history arrives');
 assert.equal(db.messages(pn).length,1);
});
test('a chat with no real message reference never sends synthetic history requests',async t=>{
 const {store,a,db}=setup(t),{client,history}=clientFor(t,store,a);
 client.saveChat({id:pn,conversationTimestamp:1700000200,name:'Sin mensajes'});
 await client.pumpHistory(Date.now());
 assert.equal(history.length,0);
 assert.equal(db.get('cursor',pn),undefined);
 assert.equal(db.get('history-priority',pn),undefined);
});
test('bounded offline scan discovers missing stored message cursors and persists its own progress',t=>{
 const {store,a,b,db}=setup(t);
 const first=message(pn,'archived-1234',1700000000,{message:{conversation:'Stored before cursor support'}});
 const stub=message(pn2,'header-1234',1700000100);
 db.put('message',db.messageKey(first.key),first,{peer:pn,timestamp:first.messageTimestamp});
 db.put('chat',pn2,{id:pn2,conversationTimestamp:1700000100,lastMessage:stub});
 let wakes=0;
 const worker=stepWorker(t,store,{onAnchorRecovered:id=>{assert.equal(id,a.id);wakes++;}});
 for(let i=0;i<20;i++)worker.step();
 assert.equal(db.get('cursor',pn)?.key.id,'archived-1234');
 assert.equal(db.get('cursor',pn2)?.key.id,'header-1234');
 assert.equal(db.get('history-priority',pn2)?.peer,pn2);
 assert.equal(db.get('history-priority',pn),undefined);
 assert.ok(wakes>=1,'the live history scheduler receives a wake-up hint');
 const old=store.config()['panel:history-anchor-scan:v1:'+a.id];
 assert.ok(Number(old)>0,'the independent scanning cursor survives process restart');
 worker.shutdown();
 const again=new PanelMetadataRecovery(store,{batchSize:2,scanDelay:99999});
 again.started=true;t.after(()=>again.shutdown());
 for(let i=0;i<4;i++)again.step();
 assert.equal(store.config()['panel:history-anchor-scan:v1:'+a.id],old);
 assert.equal(new BaileysStore(store,b.id).get('cursor',pn),undefined,'different accounts stay isolated');
});
test('scanner never creates history requests for revoked or corporate account records',t=>{
 const {store,a,b,db}=setup(t);
 store.setConfig('portal:'+a.id,'cubamax-corporate');
 store.revoke(b.id);
 const stub=message(pn,'no-access-1234',1700000100);
 db.put('chat',pn,{id:pn,lastMessage:stub});
 const worker=stepWorker(t,store);
 for(let i=0;i<4;i++)worker.step();
 assert.equal(db.get('cursor',pn),undefined);
 assert.equal(worker.allowedAccounts().length,0);
});
test('group recovery needs an actual WhatsApp message key and keeps group identity separate',t=>{
 const {store,a,db}=setup(t),{client}=clientFor(t,store,a);
 client.saveChat({id:group,subject:'Grupo',lastMessage:message(group,'group-message-1234',1700000300)});
 assert.equal(db.get('cursor',group)?.key.remoteJid,group);
 assert.equal(db.get('history-priority',group)?.peer,group);
 assert.equal(db.get('cursor',pn),undefined);
});
