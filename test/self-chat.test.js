import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {BaileysClient} from '../src/baileys.js';
import {WebPanel} from '../src/panel.js';
import {OfflineMediaArchive} from '../src/offline-media.js';
import {authenticatedSelfJids,normalizedPrivateJid,projectAuthenticatedSelfMessage} from '../src/self-chat.js';

const phone='12025550123',pn=phone+'@s.whatsapp.net',lid='990000123@lid',other='12025550124@s.whatsapp.net';
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-self-chat-'),store=new Store(dir);
 const a=store.invite(phone,'Own account').account;
 store.update(a.id,'consent',1);store.update(a.id,'status','connected');
 const db=new BaileysStore(store,a.id),auth=db.auth();
 auth.state.creds.registered=true;
 auth.state.creds.me={id:phone+':4@s.whatsapp.net',lid:'990000123:2@lid'};
 auth.saveCreds();
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,a,db,dir};
}
function message(peer,id,content,ts){return {key:{remoteJid:peer,id,fromMe:true},messageTimestamp:ts,message:content};}

test('self-chat aliases are derived only from the matching authenticated account',()=>{
 assert.equal(normalizedPrivateJid(phone+':8@s.whatsapp.net'),pn);
 assert.equal(normalizedPrivateJid('990000123:2@lid'),lid);
 assert.deepEqual(authenticatedSelfJids(phone,{id:phone+':4@s.whatsapp.net',lid:'990000123:2@lid'}),[pn,lid]);
 assert.deepEqual(authenticatedSelfJids(phone,{id:'12025550199@s.whatsapp.net',lid}),[]);
 assert.deepEqual(authenticatedSelfJids(phone,{id:pn,lid:'invalid'}),[pn]);
});

test('self phone and authenticated LID resolve to one chat without affecting other contacts',t=>{
 const {db}=setup(t);
 assert.deepEqual(db.peers(pn),[pn,lid]);
 assert.deepEqual(db.peers(lid),[lid,pn]);
 assert.equal(db.canonical(lid),pn);
 assert.deepEqual(db.peers(other),[other]);
 assert.equal(db.isSelfChat(other),false);
 assert.equal(db.isSelfChat(lid),true);
 // An incorrect historical mapping must not join the self identity into a stranger's chat.
 db.put('mapping',lid,other);
 assert.deepEqual(db.peers(lid),[lid,pn]);
 assert.deepEqual(db.peers(other),[other]);
});

test('previously stored self-chat PN and LID texts and photos appear together without migrating records',t=>{
 const {db,store,a,dir}=setup(t);
 const ownOne=message(pn,'own-pn',{conversation:'Mensaje propio'},100);
 const ownTwo=message(lid,'own-lid',{imageMessage:{caption:'Foto propia',fileLength:12}},101);
 const otherMsg=message(other,'not-self',{conversation:'Conversación externa'},102);
 const wrapped=message(lid,'own-envelope',{deviceSentMessage:{destinationJid:pn,message:{conversation:'Enviado desde otro dispositivo'}}},103);
 const wrappedPhoto=message(lid,'own-wrapped-photo',{deviceSentMessage:{destinationJid:pn,message:{videoMessage:{caption:'Video propio',fileLength:22}}}},104);
 for(const item of [ownOne,ownTwo,otherMsg,wrapped,wrappedPhoto])db.message(item);
 const panel=new WebPanel(store,{dir,live:new Map()},{
  admins:()=>new Set(['1']),permissions:()=>new Set()
 },{dir,url:'http://test',secure:false,allowedOrigins:new Set(['http://test'])});
 const own=panel.messages('1',a.id,pn,null);
 assert.deepEqual(own.items.map(v=>v.text),['Mensaje propio','Foto propia','Enviado desde otro dispositivo','Video propio']);
 assert.equal(own.items.some(v=>v.text==='Conversación externa'),false);
 const media=panel.messages('1',a.id,pn,null,true);
 assert.deepEqual(media.items.map(v=>v.type),['image','video']);
 const otherRows=panel.messages('1',a.id,other,null);
 assert.deepEqual(otherRows.items.map(v=>v.text),['Conversación externa']);
 assert.deepEqual(db.get('message',db.messageKey(wrapped.key)).message,wrapped.message,'the source record stays untouched');
});

test('device-sent content belonging to another destination is never projected into self-chat',t=>{
 const {db}=setup(t);
 const foreign=message(lid,'foreign-envelope',{deviceSentMessage:{destinationJid:other,message:{conversation:'Wrong destination'}}},110);
 const projected=db.projectSelfMessage(foreign);
 assert.equal(projected,foreign);
 const normal=message(other,'other',{conversation:'Ordinary text'},111);
 assert.equal(db.projectSelfMessage(normal),normal);
 assert.equal(projectAuthenticatedSelfMessage(foreign,[pn,lid]),foreign);
});

test('manual history recovery uses an existing self LID anchor when phone-number chat lacks one',async t=>{
 const {db,store,a}=setup(t);
 const anchor=message(lid,'older-anchor',{conversation:'History'},100);
 db.message(anchor);
 db.put('cursor',lid,{key:anchor.key,messageTimestamp:100});
 const client=new BaileysClient({store,id:a.id,phone:a.phone});
 t.after(()=>client.destroy());
 let requested=null;
 client.socket={fetchMessageHistory:async(...args)=>{requested=args;},end(){}};
 assert.equal(await client.syncHistory(pn),true);
 assert.equal(requested[1].remoteJid,lid);
 assert.equal(requested[1].id,'older-anchor');
 assert.equal(await client.syncHistory(other),false);
});

test('existing own-chat mapping is preserved if the current credentials have no LID',t=>{
 const {db}=setup(t);
 const auth=db.auth();
 auth.state.creds.me={id:pn};
 auth.saveCreds();
 db.put('mapping',lid,pn);
 assert.deepEqual(db.peers(pn),[pn,lid]);
 assert.deepEqual(db.peers(lid),[lid,pn]);
});


test('new self-chat device-sent text is indexed as ordinary text without rewriting old records',t=>{
 const {db,store,a}=setup(t);
 store.setConfig('panel_archive','1');
 const client=new BaileysClient({store,id:a.id,phone:a.phone});
 t.after(()=>client.destroy());
 const raw=message(lid,'live-own-envelope',{deviceSentMessage:{destinationJid:pn,message:{conversation:'Mensaje nuevo'}}},120);
 client.saveMessage(raw,{live:true});
 const saved=db.get('message',db.messageKey(raw.key));
 assert.equal(saved.message.conversation,'Mensaje nuevo');
 assert.equal(saved.key.remoteJid,lid);
});

test('offline archiving queues own wrapped media without touching other accounts',t=>{
 const {db,store,a,dir}=setup(t);
 const archive=new OfflineMediaArchive(store,dir);
 t.after(()=>archive.shutdown());
 const own=message(lid,'archive-own',{deviceSentMessage:{destinationJid:pn,message:{imageMessage:{fileLength:14}}}},150);
 const foreign=message(lid,'archive-foreign',{deviceSentMessage:{destinationJid:other,message:{imageMessage:{fileLength:14}}}},151);
 assert.equal(archive.track(a.id,own),true);
 assert.equal(archive.track(a.id,foreign),false);
 const state=archive.summary(a.id);
 assert.equal(state.pending,1);
 assert.equal(state.ready,0);
});

test('self aliases are disabled on the Cubamax portal',t=>{
 const {db,store,a}=setup(t);
 store.setConfig('portal:'+a.id,'cubamax-corporate');
 assert.deepEqual(db.peers(pn),[pn]);
 assert.deepEqual(db.peers(lid),[lid]);
 assert.equal(db.isSelfChat(pn),false);
});
