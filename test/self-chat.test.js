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

test('foreign inbound sync placeholders never fill own-chat pages or gallery',t=>{
 const {db,store,a,dir}=setup(t);
 const selfText=message(pn,'real-self-text',{conversation:'Nota propia real'},100);
 const selfPhoto=message(lid,'real-self-photo',{imageMessage:{caption:'Foto propia real',fileLength:12}},101);
 const selfMirrored={key:{remoteJid:pn,id:'self-from-device',fromMe:false},messageTimestamp:103,
  message:{conversation:'Nota propia del segundo dispositivo'}};
 const selfWrapped=message(lid,'real-wrapped',{deviceSentMessage:{
  destinationJid:phone+':3@s.whatsapp.net',message:{videoMessage:{caption:'Video propio real',fileLength:14}}
 }},102);
 const received={key:{remoteJid:other,id:'incoming-to-own',fromMe:false},messageTimestamp:200,
  message:{conversation:'Mensaje recibido de otro contacto'}};
 const foreignEnvelope=message(lid,'foreign-sync',{deviceSentMessage:{
  destinationJid:other,message:{conversation:'Una conversación diferente'}
 }},300);
 const foreignMedia=message(lid,'foreign-sync-photo',{deviceSentMessage:{
  destinationJid:other,message:{imageMessage:{caption:'Foto de conversación diferente',fileLength:18}}
 }},301);
 db.message(selfText);db.message(selfPhoto);db.message(selfWrapped);db.message(selfMirrored);
 db.message(received);db.message(foreignEnvelope);db.message(foreignMedia);
 // 120 protocol/status events newer than the genuine self-chat: fetching
 // 60 unfiltered rows first must not hide the actual saved photo and text.
 for(let i=0;i<120;i++)db.message(message(lid,'sync-event-'+i,{protocolMessage:{type:0}},400+i));
 for(let i=0;i<70;i++)db.message(message(lid,'foreign-media-'+i,{deviceSentMessage:{
  destinationJid:other,message:{imageMessage:{caption:'No pertenece al chat propio',fileLength:12}}
 }},600+i));
 const panel=new WebPanel(store,{dir,live:new Map()},{
  admins:()=>new Set(['1']),permissions:()=>new Set()
 },{dir,url:'http://test',secure:false,allowedOrigins:new Set(['http://test'])});
 const own=panel.messages('1',a.id,pn,null);
 assert.deepEqual(own.items.map(v=>v.text),['Nota propia real','Foto propia real','Video propio real','Nota propia del segundo dispositivo']);
 assert.equal(own.next,null,'non-chat system events must not consume the page or make false pagination');
 const gallery=panel.messages('1',a.id,pn,null,true);
 assert.deepEqual(gallery.items.map(v=>v.text),['Foto propia real','Video propio real']);
 assert.equal(gallery.next,null,'70 foreign photos must not crowd out the own gallery');
 const otherChat=panel.messages('1',a.id,other,null);
 assert.deepEqual(otherChat.items.map(v=>v.text),['Mensaje recibido de otro contacto']);
 // It is a view-only correction: do not erase or move any stored metadata.
 assert.deepEqual(db.get('message',db.messageKey(foreignEnvelope.key)).message,foreignEnvelope.message);
 assert.deepEqual(db.get('message',db.messageKey(foreignMedia.key)).message,foreignMedia.message);
 assert.equal(db.get('message',db.messageKey(selfMirrored.key)).message.conversation,'Nota propia del segundo dispositivo');
 assert.equal(db.get('message',db.messageKey(received.key)).message.conversation,'Mensaje recibido de otro contacto');
});

test('own-chat preview uses latest genuine message, not unrelated sync timestamps',async t=>{
 const {db,store,a,dir}=setup(t);
 db.put('chat',pn,{id:pn,name:'Cuenta propia',conversationTimestamp:500});
 db.put('chat',other,{id:other,name:'Contacto externo',conversationTimestamp:400});
 db.message(message(pn,'real-note',{conversation:'Recordatorio propio'},100));
 db.message(message(lid,'phantom',{deviceSentMessage:{
  destinationJid:other,message:{conversation:'Texto dirigido a otro'}
 }},500));
 db.message({key:{remoteJid:other,id:'incoming',fromMe:false},messageTimestamp:400,
  message:{conversation:'Mensaje del contacto'}});
 const panel=new WebPanel(store,{dir,live:new Map()},{
  admins:()=>new Set(['1']),permissions:()=>new Set()
 },{dir,url:'http://test',secure:false,allowedOrigins:new Set(['http://test'])});
 const session=panel.access.login(panel.access.token('1','login'));
 const req={method:'GET',headers:{cookie:'wa_panel='+session.secret},socket:{remoteAddress:'127.0.0.1'},
  url:'/api/panel/chats?account='+a.id};
 let status,output;
 const res={writeHead(code){status=code;},end(body){output=body;}};
 await panel.handle(req,res,'/api/panel/chats',{},async()=>({}));
 assert.equal(status,200);
 const chats=JSON.parse(output).items;
 assert.equal(chats.length,2);
 assert.equal(chats[0].peer,other,'a false self-chat update must not move it to the top');
 const self=chats.find(c=>c.peer===pn);
 assert.equal(self.preview,'Recordatorio propio');
 assert.equal(self.timestamp,100);
 assert.equal(chats.find(c=>c.peer===other).preview,'Mensaje del contacto');
});

test('self aliases are disabled on the Cubamax portal',t=>{
 const {db,store,a}=setup(t);
 store.setConfig('portal:'+a.id,'cubamax-corporate');
 assert.deepEqual(db.peers(pn),[pn]);
 assert.deepEqual(db.peers(lid),[lid]);
 assert.equal(db.isSelfChat(pn),false);
});
