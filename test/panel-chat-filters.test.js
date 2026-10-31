import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {PanelChatList} from '../src/panel-chat-list.js';

const cu='5356185207@s.whatsapp.net',es='34612345678@s.whatsapp.net';
const us='12025550129@s.whatsapp.net',group='123456789@g.us';
function make(t){
 const dir=mkdtempSync(tmpdir()+'/wa-filters-'),store=new Store(dir);
 const a=store.invite('12025550123','Prueba').account,db=new BaileysStore(store,a.id);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const chat=(peer,name,timestamp,flags={})=>db.put('chat',peer,{id:peer,name,conversationTimestamp:timestamp,...flags},{timestamp});
 const media=(peer,id,kind)=>db.message({key:{remoteJid:peer,id,fromMe:false},messageTimestamp:101,
    message:kind==='photo'?{imageMessage:{mimetype:'image/jpeg'}}:{videoMessage:{mimetype:'video/mp4'}}});
 const profiles={name:(_account,peer)=>db.get('chat',peer)?.name||peer,url:()=>null};
 return {store,a,db,chat,media,list:new PanelChatList(store,profiles,{privateOnly:()=>true})};
}
test('inbox, archives, and country filter use received metadata and leave existing rows unchanged',t=>{
 const f=make(t);
 f.chat(cu,'Cuba',100);f.chat(es,'España',90,{archived:true});
 f.chat(us,'EE.UU.',80,{locked:true});f.chat(group,'Grupo anterior',110);
 const inbox=f.list.page(f.a.id,f.db);
 assert.deepEqual(inbox.items.map(c=>c.peer),[cu,us],'ordinary private chats remain available in the existing list');
 assert.equal(inbox.counts.archived,1);
 const archived=f.list.page(f.a.id,f.db,{folder:'archived'});
 assert.deepEqual(archived.items.map(c=>c.peer),[es]);
 assert.deepEqual(f.list.page(f.a.id,f.db,{country:'Cuba'}).items.map(c=>c.peer),[cu]);
 assert.deepEqual(f.list.page(f.a.id,f.db,{country:'México'}).items,[]);
 assert.deepEqual(f.list.page(f.a.id,f.db,{folder:'restricted'}).items.map(c=>c.peer),[cu,us],'the removed folder is never exposed');
 assert.equal(f.db.get('chat',group).name,'Grupo anterior','historic rows are retained');
});
test('media sorts rank indexed photos or videos without loading message content for every chat',t=>{
 const f=make(t);
 f.chat(cu,'Cuba',100);f.chat(es,'España',90);f.chat(us,'EE.UU.',80);
 f.media(cu,'p1','photo');f.media(cu,'p2','photo');f.media(es,'p3','photo');
 f.media(es,'v1','video');f.media(es,'v2','video');f.media(es,'v3','video');
 const recent=f.list.page(f.a.id,f.db);
 assert.deepEqual(recent.items.map(c=>c.peer),[cu,es,us]);
 assert.equal(recent.items[0].photos,undefined,'default list performs no ranking query');
 const photos=f.list.page(f.a.id,f.db,{sort:'photos'});
 assert.deepEqual(photos.items.map(c=>c.peer),[cu,es,us]);
 assert.equal(photos.items[0].photos,2);
 const videos=f.list.page(f.a.id,f.db,{sort:'videos'});
 assert.deepEqual(videos.items.map(c=>c.peer),[es,cu,us]);
 assert.equal(videos.items[0].videos,3);
 const combined=f.list.page(f.a.id,f.db,{sort:'media'});
 assert.deepEqual(combined.items.map(c=>c.peer),[es,cu,us],'combined sort adds indexed photos and videos per chat');
 assert.equal(combined.items[0].photos+combined.items[0].videos,4);
 assert.equal(combined.items[1].photos+combined.items[1].videos,2);
 assert.deepEqual(f.list.page(f.a.id,f.db,{country:'España',sort:'videos'}).items.map(c=>c.peer),[es]);
});

test('media sorting does not double-count a photo repeated through phone and LID aliases',t=>{
 const f=make(t),lid='34567890@lid';
 f.db.put('mapping',lid,cu);
 f.chat(cu,'Cuba',100);f.chat(lid,'Cuba temporal',95);
 f.media(cu,'same-photo','photo');f.media(lid,'same-photo','photo');
 f.media(cu,'different-photo','photo');
 const ranked=f.list.page(f.a.id,f.db,{sort:'photos'});
 assert.equal(ranked.items.length,1);
 assert.equal(ranked.items[0].photos,2,'duplicate logical media is counted once');
});

test('combined media sort sums both formats, preserves recent ties and never duplicates LID photos',t=>{
 const f=make(t),lid='34567890@lid';
 f.db.put('mapping',lid,cu);
 f.chat(cu,'Cuba',150);f.chat(lid,'Alias Cuba',145);
 f.chat(es,'España',120);f.chat(us,'Estados Unidos',100);
 // Cuba: 1 distinct photo + 2 videos (three), the LID copy is not extra.
 f.media(cu,'p1','photo');f.media(lid,'p1','photo');
 f.media(cu,'v1','video');f.media(cu,'v2','video');
 // Spain: 3 photos, no video; it ties with Cuba, so Cuba stays first by timestamp.
 f.media(es,'p2','photo');f.media(es,'p3','photo');f.media(es,'p4','photo');
 // US: 1 video, less than the first two chats.
 f.media(us,'v3','video');
 const result=f.list.page(f.a.id,f.db,{sort:'media'});
 assert.deepEqual(result.items.map(c=>c.peer),[cu,es,us]);
 assert.equal(result.items[0].photos,1);
 assert.equal(result.items[0].videos,2);
 assert.deepEqual(result.items.map(c=>c.photos+c.videos),[3,3,1]);
 assert.deepEqual(f.list.page(f.a.id,f.db,{sort:'videos'}).items.map(c=>c.peer),[cu,us,es]);
 assert.deepEqual(f.list.page(f.a.id,f.db,{sort:'photos'}).items.map(c=>c.peer),[es,cu,us]);
});
