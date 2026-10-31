import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {BaileysClient} from '../src/baileys.js';
import {OfflineMediaArchive} from '../src/offline-media.js';
import {WebPanel} from '../src/panel.js';

const pn='12025550129@s.whatsapp.net',lid='987654321@lid',group='120363777777777777@g.us';
const message=(peer,id,type,ts,fromMe=false)=>({
 key:{remoteJid:peer,id,fromMe},
 messageTimestamp:ts,
 message:type==='photo'?{imageMessage:{caption:'Foto '+id,fileLength:12}}:
  type==='video'?{videoMessage:{caption:'Video '+id,fileLength:16}}:
  {conversation:'Texto '+id}
});
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-gallery-counts-'),store=new Store(dir);
 const a=store.invite('12025550123','Principal').account;
 const b=store.invite('12025550124','Otra').account;
 for(const row of [a,b]){
  store.update(row.id,'consent',1);
  store.update(row.id,'status','connected');
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(row.id);
 }
 const archive=new OfflineMediaArchive(store,dir);
 const telegram={admins:()=>new Set(['1']),permissions:()=>new Set()};
 const panel=new WebPanel(store,{dir,archive,live:new Map()},telegram,{dir,url:'http://localhost:10000',secure:false,allowedOrigins:new Set()});
 t.after(async()=>{await archive.shutdown();store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,a,b,archive,panel,db:new BaileysStore(store,a.id)};
}
function ready(store,account,db,raw){
 store.db.prepare("INSERT INTO offline_media(account,message,peer,status,bytes,created,updated) VALUES(?,?,?,'ready',12,1,1)")
  .run(account,db.messageKey(raw.key),raw.key.remoteJid);
}
function makeChat(store,account,peer,name,ts=100){
 new BaileysStore(store,account).put('chat',peer,{id:peer,name,conversationTimestamp:ts});
}

test('counts unique indexed photos/videos per chat and only finished offline archive files',t=>{
 const {store,a,b,panel,db}=setup(t);
 db.put('mapping',lid,pn);
 const p1=message(pn,'photo-1','photo',101),p1Lid=message(lid,'photo-1','photo',101);
 const p2=message(lid,'photo-2','photo',102),v1=message(lid,'video-1','video',103);
 const foreign=message('12025550999@s.whatsapp.net','foreign','photo',104);
 const groupPhoto=message(group,'group-photo','photo',105);
 for(const raw of [p1,p1Lid,p2,v1,foreign,groupPhoto])db.message(raw);
 // The same logical photo may have both PN and LID records; count it once.
 ready(store,a.id,db,p1);ready(store,a.id,db,v1);
 const otherDb=new BaileysStore(store,b.id);
 const other=message(pn,'another-account','photo',200);otherDb.message(other);
 ready(store,b.id,otherDb,other);
 const initial=panel.messages('1',a.id,pn,null,true).stats;
 assert.deepEqual(initial.detected,{photos:2,videos:1});
 assert.deepEqual(initial.downloaded,{photos:1,videos:1});
 assert.equal(initial.firstBatch,null,'old data must never be mislabeled as first delivery');
 assert.deepEqual(panel.messages('1',a.id,group,null,true).stats.detected,{photos:1,videos:0});
 assert.deepEqual(panel.messages('1',b.id,pn,null,true).stats.detected,{photos:1,videos:0});
 assert.equal(panel.messages('1',a.id,pn,null).stats,undefined,'chat message API stays unchanged');
});

test('first observed history batch is durable and never overwritten by later batches',t=>{
 const {store,a,panel,db}=setup(t);
 const client=new BaileysClient({store,id:a.id,phone:a.phone,galleryOnly:false});
 t.after(()=>client.destroy());
 const first=[message(pn,'batch-photo','photo',100),message(pn,'batch-video','video',101),
  message(pn,'batch-text','text',102),message(pn,'batch-photo','photo',100)];
 client.recordFirstMediaBatch(first);
 const saved=db.get('media-first-batch',pn);
 assert.equal(saved.photos,1);
 assert.equal(saved.videos,1);
 assert.ok(saved.recordedAt>0);
 client.recordFirstMediaBatch([message(pn,'later','photo',105)]);
 assert.deepEqual(db.get('media-first-batch',pn),saved);
 const after=panel.messages('1',a.id,pn,null,true).stats;
 assert.deepEqual(after.firstBatch,{photos:1,videos:1,recordedAt:saved.recordedAt});
 assert.deepEqual(after.detected,{photos:0,videos:0},'the first-batch metric does not claim data was saved');
});

test('only known E.164 numbers appear beneath private names; groups and unknown LIDs have no phone',async t=>{
 const {store,a,panel,db}=setup(t);
 db.put('mapping',lid,pn);
 makeChat(store,a.id,lid,'Conocido',120);
 makeChat(store,a.id,'246801357@lid','Sin número',110);
 makeChat(store,a.id,group,'Grupo',100);
 const credentials=panel.access.login(panel.access.token('1','login'));
 const req={method:'GET',headers:{cookie:'wa_panel='+credentials.secret},
  socket:{remoteAddress:'127.0.0.1'},url:'/api/panel/chats?account='+a.id};
 let status=0,body='';
 const res={writeHead(code){status=code;},end(value){body=value;}};
 await panel.handle(req,res,'/api/panel/chats',{},async()=>({}));
 assert.equal(status,200);
 const rows=JSON.parse(body).items;
 assert.equal(rows.find(c=>c.peer===pn)?.phone,'+12025550129');
 assert.equal(rows.find(c=>c.peer==='246801357@lid')?.phone,null);
 assert.equal(rows.find(c=>c.peer===group),undefined,'groups remain stored but are excluded from the WhatsApp panel');
});

test('first-batch counts across PN and LID of one private chat are combined only for the same event',t=>{
 const {store,a,panel,db}=setup(t);
 db.put('mapping',lid,pn);
 db.put('media-first-batch',pn,{photos:3,videos:2,recordedAt:1234});
 db.put('media-first-batch',lid,{photos:1,videos:1,recordedAt:1234});
 const counts=panel.messages('1',a.id,pn,null,true).stats;
 assert.deepEqual(counts.firstBatch,{photos:4,videos:3,recordedAt:1234});
 db.put('media-first-batch',lid,{photos:50,videos:50,recordedAt:1235});
 assert.deepEqual(panel.messages('1',a.id,pn,null,true).stats.firstBatch,
  {photos:3,videos:2,recordedAt:1234},'later batch must not overwrite the first delivery');
});
