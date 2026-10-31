import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {PanelMetadataRecovery} from '../src/panel-metadata-recovery.js';
import {WebPanel} from '../src/panel.js';
import {normalizedPhone,normalizedLid,receivedContactMetadata,acceptedContactMapping} from '../src/received-contact-metadata.js';

const pn='12025550129@s.whatsapp.net',lid='887766554433@lid',otherPn='12025550130@s.whatsapp.net';
const group='120363777777777777@g.us';
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-received-contact-'),store=new Store(dir);
 const a=store.invite('12025550123','Cuenta A').account,b=store.invite('12025550124','Cuenta B').account;
 for(const item of [a,b]){
  store.update(item.id,'consent',1);store.update(item.id,'status','connected');
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(item.id);
  store.setConfig('engine:'+item.id,'baileys');
 }
 const db=new BaileysStore(store,a.id),worker=new PanelMetadataRecovery(store,{batchSize:120});
 worker.started=true;
 const panel=new WebPanel(store,{live:new Map()},{admins:()=>new Set(['1']),permissions:()=>new Set(['2'])},{url:'http://test',secure:false,allowedOrigins:new Set()});
 t.after(()=>{worker.shutdown();store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,a,b,db,worker,panel};
}
function drain(worker,n=8){for(let i=0;i<n;i++)worker.step();}

test('phone fields accept only explicit phone data, never an anonymous LID',()=>{
 assert.equal(normalizedPhone(lid),null);
 assert.equal(normalizedPhone('887766554433'),null);
 assert.equal(normalizedPhone('+12025550129',true),pn);
 assert.equal(normalizedPhone('12025550129:8@c.us'),pn);
 assert.equal(normalizedPhone('12025550129:8@s.whatsapp.net'),pn);
 assert.equal(normalizedPhone('bad@example.com',true),null);
 assert.equal(normalizedPhone('12025550129@lid',true),null);
 assert.equal(normalizedPhone('123',true),null);
 assert.equal(normalizedLid('887766554433:4@lid'),lid);
 assert.equal(normalizedLid('887766554433',true),lid);
 assert.equal(normalizedLid(pn),null);
});

test('chat/contact display names and labelled phone/LID fields are interpreted without guessing',()=>{
 const c=receivedContactMetadata('chat',lid,{displayName:'Clara',phoneNumber:'+12025550129',conversationTimestamp:100});
 assert.deepEqual(c.mapping,{lid,pn});
 assert.deepEqual(c.name,{peer:lid,name:'Clara',timestamp:100});
 const d=receivedContactMetadata('contact',pn,{accountLid:'887766554433',name:'Clara agenda'});
 assert.deepEqual(d.mapping,{lid,pn});
 assert.equal(d.name.name,'Clara agenda');
 assert.equal(receivedContactMetadata('contact',lid,{name:'887766554433'}).name,null);
 assert.equal(receivedContactMetadata('contact',lid,{name:'Clara'}).mapping,null);
 assert.equal(receivedContactMetadata('chat',group,{subject:'Familia',phoneNumber:'+12025550129',lid}).mapping,null);
 assert.equal(receivedContactMetadata('message',lid,{pushName:'Not a contact record'}).name,null);
 assert.deepEqual(receivedContactMetadata('mapping',lid,'+12025550129').mapping,{lid,pn});
});

test('conflicting and own-account associations cannot merge unrelated people',()=>{
 assert.equal(acceptedContactMapping({lid,pn},null),true);
 assert.equal(acceptedContactMapping({lid,pn},pn),true);
 assert.equal(acceptedContactMapping({lid,pn},otherPn),false);
 assert.equal(acceptedContactMapping({lid,pn},null,[pn,'123123@lid']),false);
 assert.equal(acceptedContactMapping({lid,pn},null,[lid,otherPn]),false);
 assert.equal(acceptedContactMapping({lid,pn},null,[lid,pn]),true);
 assert.equal(acceptedContactMapping({lid,pn:lid},null),false);
});

test('background recovery joins already received identities and existing gallery messages without downloads',t=>{
 const {store,a,b,db,worker,panel}=setup(t);
 db.put('chat',lid,{id:lid,displayName:'Clara entregada',phoneNumber:'+12025550129',conversationTimestamp:100},{timestamp:100});
 const photo={key:{remoteJid:pn,id:'photo-1',fromMe:false},messageTimestamp:100,message:{imageMessage:{caption:'Foto guardada',fileLength:12}}};
 db.message(photo);
 assert.equal(panel.messages('1',a.id,lid,null,true).items.length,0);
 drain(worker);
 assert.equal(db.get('mapping',lid),pn);
 assert.equal(panel.profiles.name(a.id,lid),'Clara entregada');
 assert.equal(panel.messages('1',a.id,lid,null,true).items.length,1);
 assert.equal(panel.messages('1',a.id,lid,null,true).items[0].text,'Foto guardada');
 assert.equal(panel.messages('1',b.id,lid,null,true).items.length,0);
 const item=panel.chatList.page(a.id,db).items[0];
 assert.equal(item.peer,pn);assert.equal(item.phone,'+12025550129');
 assert.ok(item.aliases.includes(lid));
 assert.ok(Number(store.config()['panel:contact-scan:v1:'+a.id])>0);
 assert.deepEqual(db.get('message',db.messageKey(photo.key)).message,photo.message);
 assert.throws(()=>panel.messages('2',a.id,lid,null,true),{status:404});
});

test('contact scan resumes on the persistent database and consumes later contact updates',t=>{
 const {store,a,db,worker,panel}=setup(t);
 db.put('contact',lid,{id:lid,displayName:'Nombre recibido'});
 drain(worker);
 const before=store.config()['panel:contact-scan:v1:'+a.id];
 worker.shutdown();
 db.put('contact',lid,{id:lid,displayName:'Nombre nuevo',pnJid:pn});
 const next=new PanelMetadataRecovery(store);next.started=true;t.after(()=>next.shutdown());
 drain(next);
 assert.equal(db.get('mapping',lid),pn);
 assert.equal(panel.profiles.name(a.id,lid),'Nombre nuevo');
 assert.ok(Number(store.config()['panel:contact-scan:v1:'+a.id])>Number(before));
});

test('recovery preserves valid existing associations and does not invent a missing number',t=>{
 const {db,worker,panel,a}=setup(t);
 db.put('mapping',lid,otherPn);
 db.put('contact',lid,{id:lid,name:'Contacto',phoneNumber:'+12025550129'});
 const unknown='999888777@lid';
 db.put('chat',unknown,{id:unknown,displayName:'Sin teléfono',conversationTimestamp:200});
 drain(worker);
 assert.equal(db.get('mapping',lid),otherPn);
 assert.equal(db.get('mapping',unknown),undefined);
 const row=panel.chatList.page(a.id,db).items.find(item=>item.peer===unknown);
 assert.equal(row.phone,null);assert.equal(row.name,'Sin teléfono');
});

test('corporate and revoked accounts remain excluded from received-contact recovery',t=>{
 const {store,a,b,db,worker}=setup(t);
 store.setConfig('portal:'+a.id,'cubamax-corporate');store.revoke(b.id);
 db.put('chat',lid,{id:lid,name:'Not processed',phoneNumber:'+12025550129'});
 drain(worker);
 assert.equal(db.get('mapping',lid),undefined);
 assert.equal(store.config()['panel:contact-scan:v1:'+a.id],undefined);
});
