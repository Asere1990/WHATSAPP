import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {BaileysClient,toJid,toPeer,reconnectDelay} from '../src/baileys.js';
import {Accounts} from '../src/whatsapp.js';
const tick=()=>new Promise(r=>setImmediate(r));
const raw=(id='m1',extra={})=>({key:{remoteJid:'12025550124@s.whatsapp.net',id,fromMe:false},messageTimestamp:1700000000,message:{conversation:'hola'},...extra});
function setup(t){const dir=mkdtempSync(`${tmpdir()}/wa-baileys-`),store=new Store(dir),a=store.invite('12025550123','Prueba').account;store.update(a.id,'consent',1);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {dir,store,a};}
function socketFactory(){
 const sockets=[],options=[];
 const make=config=>{options.push(config);const ev=new EventEmitter();let processor;ev.process=fn=>{processor=fn;};
 const sock={ev,authState:config.auth,user:{id:'12025550123:4@s.whatsapp.net',name:'Prueba'},codes:[],sent:[],requestPairingCode:async phone=>{sock.codes.push(phone);return 'ABCD1234';},end(){sock.ended=true;},logout:async()=>{sock.loggedOut=true;},fetchBlocklist:async()=>[],fetchMessageHistory:async(...args)=>{sock.history=args;return 'request';},sendMessage:async(jid,data)=>{sock.sent.push({jid,data});return raw('sent'+sock.sent.length,{key:{remoteJid:jid,id:'sent'+sock.sent.length,fromMe:true},message:{conversation:data.text||data.caption||''}});},async batch(events){if(events['creds.update'])ev.emit('creds.update',events['creds.update']);await processor(events);}};sockets.push(sock);return sock;
 };return {make,sockets,options};
}
test('Baileys auth persists binary Signal keys and credentials separately for each account',async t=>{
 const {store,a}=setup(t),b=store.invite('12025550125','Otro').account,one=new BaileysStore(store,a.id),two=new BaileysStore(store,b.id),auth=one.auth();
 auth.state.creds.registered=true;auth.state.creds.me={id:a.phone+'@s.whatsapp.net'};auth.saveCreds();
 await auth.state.keys.set({'session':{contact:{key:Buffer.from([1,2,3])}}});
 const restored=new BaileysStore(store,a.id).auth();assert.equal(one.registered(),true);assert.equal(two.registered(),false);
 assert.deepEqual((await restored.state.keys.get('session',['contact'])).contact.key,Buffer.from([1,2,3]));
 assert.equal((await two.auth().state.keys.get('session',['contact'])).contact,undefined);
 await restored.state.keys.set({session:{contact:null}});assert.equal((await restored.state.keys.get('session',['contact'])).contact,undefined);
});
test('pairing waits for QR readiness, uses digits-only phone, and closes without logging out',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());
 let code,ready=0;client.on('code',v=>code=v);client.on('ready',()=>ready++);await client.initialize();const sock=fake.sockets[0];
 assert.equal(sock.codes.length,0);await client.onConnection({qr:'secret'},client.generation);assert.equal(code,'ABCD1234');assert.deepEqual(sock.codes,[a.phone]);
 await client.onConnection({qr:'secret'},client.generation);assert.equal(sock.codes.length,1);
 await sock.batch({'creds.update':{registered:true,me:{id:a.phone+'@s.whatsapp.net'}}});
 await client.onConnection({connection:'open'},client.generation);assert.equal(client.info.wid.user,a.phone);assert.equal(ready,1);
 assert.equal(fake.options[0].syncFullHistory,true);assert.deepEqual(fake.options[0].browser,['Ubuntu','Chrome','22.04.4']);assert.equal('puppeteer' in fake.options[0],false);
 await client.destroy();assert.equal(sock.ended,true);assert.equal(sock.loggedOut,undefined);assert.equal(client.store.registered(),true);
});
test('history survives adapter restart and never replays into Telegram; only live private notifications emit',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());const live=[];client.on('message',m=>live.push(m));await client.initialize();
 await fake.sockets[0].batch({'messaging-history.set':{chats:[{id:'12025550124@s.whatsapp.net',name:'Contacto'}],contacts:[{id:'12025550124@s.whatsapp.net',name:'Contacto'}],messages:[raw()]}});
 await fake.sockets[0].batch({'messages.upsert':{type:'append',messages:[raw('old')]}});assert.equal(live.length,0);
 await fake.sockets[0].batch({'messages.upsert':{type:'notify',messages:[raw('new'),raw('group',{key:{remoteJid:'123@g.us',id:'g'}}),raw('self',{key:{remoteJid:'12025550124@s.whatsapp.net',id:'self',fromMe:true}})]}});assert.equal(live.length,1);assert.equal(live[0].from,'12025550124@c.us');
 const next=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,socketFactory:fake.make});t.after(()=>next.destroy());
 const messages=await(await next.getChatById('12025550124@c.us')).fetchMessages({limit:500});assert.equal(messages.length,4);
 assert.equal((await next.getChats())[0].id._serialized,'12025550124@c.us');assert.equal((await next.getContactById('12025550124@c.us')).name,'Contacto');
});
test('media download preserves caption and MIME and refuses view-once and oversized files',async t=>{
 const {store,a}=setup(t),fake=socketFactory();let downloads=0;
 const client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make,mediaDownloader:async()=>{downloads++;return Readable.from([Buffer.from('photo')]);}});t.after(()=>client.destroy());await client.initialize();
 const photo=raw('photo',{message:{imageMessage:{caption:'Texto',mimetype:'image/jpeg',fileLength:5}}});const msg=client.wrap(photo);assert.equal(msg.type,'image');assert.equal(msg.body,'Texto');assert.equal(msg.rawData.size,5);
 const media=await msg.downloadMedia();assert.equal(media.mimetype,'image/jpeg');assert.equal(Buffer.from(media.data,'base64').toString(),'photo');
 const once=client.wrap(raw('once',{message:{viewOnceMessage:{message:photo.message}}}));assert.equal(await once.downloadMedia(),null);
 const huge=client.wrap(raw('huge',{message:{imageMessage:{fileLength:100*1024*1024}}}));await assert.rejects(huge.downloadMedia(),/grande/);assert.equal(downloads,1);
});
test('outgoing text, media, voice and delete keep the selected chat; failed sends are not retried',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();const sock=fake.sockets[0],peer='12025550124@c.us';
 const sent=await client.sendMessage(peer,'respuesta');assert.equal(sent.fromMe,true);assert.equal(sent.to,peer);assert.equal(sock.sent[0].jid,'12025550124@s.whatsapp.net');
 await client.sendMessage(peer,{data:Buffer.from('p').toString('base64'),mimetype:'image/jpeg'},{caption:'caption'});assert.equal(sock.sent[1].data.caption,'caption');
 await client.sendMessage(peer,{data:Buffer.from('a').toString('base64'),mimetype:'audio/ogg'},{sendAudioAsVoice:true});assert.equal(sock.sent[2].data.ptt,true);
 await sent.delete(true);assert.equal(sock.sent[3].data.delete.fromMe,true);
 let attempts=0;sock.sendMessage=async()=>{attempts++;throw Error('uncertain');};await assert.rejects(client.sendMessage(peer,'no retry'));assert.equal(attempts,1);
});
test('LID contact mapping persists the real phone and does not confuse device IDs',async t=>{
 const {store,a}=setup(t),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone});t.after(()=>client.destroy());
 client.saveContact({id:'888@lid',phoneNumber:'12025550124@s.whatsapp.net',name:'Persona'});
 assert.equal((await client.getContactLidAndPhone(['888@lid']))[0].pn,'12025550124@c.us');
 assert.equal(toPeer('12025550124:3@s.whatsapp.net'),'12025550124@c.us');assert.equal(toJid('12025550124@c.us'),'12025550124@s.whatsapp.net');
});
test('Baileys accounts use existing Telegram routing and dedup without Chromium',async t=>{
 const {dir,store,a}=setup(t),notices=[],manager=new Accounts(store,dir,async text=>{notices.push(text);return {chat:{id:1},message_id:notices.length};}),fake=socketFactory();
 t.after(()=>manager.close(a.id));
 const entry=await manager.startBaileys(a.id,true,options=>new BaileysClient({galleryOnly:false,...options,socketFactory:fake.make}));await entry.initializing;
 await entry.client.onConnection({connection:'open'},entry.client.generation);await tick();assert.equal(entry.ready,true);assert.equal(store.account(a.id).confirmed,1);
 await fake.sockets[0].batch({'messages.upsert':{type:'notify',messages:[raw('unique'),raw('unique')]}});await entry.chain;
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE account=?').get(a.id).n,1);
 assert.equal(store.getRoute(1,notices.length).account,a.id);
 store.update(a.id,'paused',1);await assert.rejects(manager.send(a.id,'12025550124@c.us','blocked'));
});

test('restoring saved Baileys credentials opens without requesting another pairing code',async t=>{
 const {store,a}=setup(t),saved=new BaileysStore(store,a.id).auth();saved.state.creds.me={id:a.phone+'@s.whatsapp.net'};saved.saveCreds();
 const fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();
 assert.equal(fake.sockets.length,1);await client.onConnection({connection:'open'},client.generation);assert.equal(fake.sockets[0].codes.length,0);assert.equal(client.info.wid.user,a.phone);
});
test('history sync requests are scoped to the selected chat and never claim a full gallery',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();
 client.saveMessage(raw('photo',{message:{imageMessage:{fileLength:5}}}));client.saveMessage(raw('other',{key:{remoteJid:'12025550125@s.whatsapp.net',id:'other',fromMe:false},message:{videoMessage:{fileLength:7}}}));
 const gallery=await client.gallery('12025550124@c.us');assert.equal(gallery.messages.length,1);assert.equal(gallery.complete,false);
 assert.equal(await client.syncHistory('12025550124@c.us'),true);assert.equal(fake.sockets[0].history[1].remoteJid,'12025550124@s.whatsapp.net');
 assert.equal(await client.syncHistory('12025550126@c.us'),false);
});
test('a revoked Baileys session clears only its own credentials',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make}),b=store.invite('12025550125','Otro').account;
 t.after(()=>client.destroy());const other=new BaileysStore(store,b.id).auth();other.state.creds.registered=true;other.saveCreds();
 await client.initialize();await fake.sockets[0].batch({'creds.update':{registered:true}});let reason;client.on('disconnected',r=>reason=r);
 await client.onConnection({connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}},client.generation);
 assert.equal(reason,'LOGOUT');assert.equal(client.store.registered(),false);assert.equal(new BaileysStore(store,b.id).registered(),true);
});
test('protocol and reaction notifications are not mirrored as private messages',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:false,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();let count=0;client.on('message',()=>count++);
 await fake.sockets[0].batch({'messages.upsert':{type:'notify',messages:[raw('reaction',{message:{reactionMessage:{text:'x'}}}),raw('protocol',{message:{protocolMessage:{type:0}}})]}});assert.equal(count,0);
});

test('default manager starts no browser and requests a new link instead of reusing incompatible credentials',async t=>{
 const {dir,store,a}=setup(t),manager=new Accounts(store,dir,async()=>{});manager.createClient=()=>{assert.fail('Chromium must not launch');};t.after(()=>manager.close(a.id));
 assert.equal(manager.engine(a.id),'baileys');const entry=await manager.start(a.id);await entry.initializing;
 assert.equal(entry.client.kind,'baileys');assert.equal(store.account(a.id).status,'needs_pairing');assert.equal(manager.live.has(a.id),false);
});
test('Baileys readiness never accepts a different phone number',async t=>{
 const {dir,store,a}=setup(t),manager=new Accounts(store,dir,async()=>{}),fake=socketFactory();t.after(()=>manager.close(a.id));
 const entry=await manager.startBaileys(a.id,true,options=>new BaileysClient({galleryOnly:false,...options,socketFactory:fake.make}));await entry.initializing;entry.client.info={wid:{user:'12025550199'}};
 await manager.connected(a.id,entry);assert.equal(entry.ready,false);assert.equal(store.account(a.id).consent,0);assert.equal(store.account(a.id).status,'revoked');
});

test('gallery-only discards text, keeps captions, paginates media and advances past text history',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();const sock=fake.sockets[0],peer='12025550124@c.us';let emitted=0;client.on('message',()=>emitted++);
 const text=raw('text',{messageTimestamp:100});await sock.batch({'messages.upsert':{type:'notify',messages:[text]}});assert.equal(emitted,0);assert.equal(client.store.get('message',client.store.messageKey(text.key)),undefined);
 for(let i=0;i<205;i++)client.saveMessage(raw('photo'+i,{messageTimestamp:200+i,message:{imageMessage:{caption:'caption',fileLength:5}}}));
 const first=await client.gallery(peer),second=await client.gallery(peer,first.nextOffset);assert.equal(first.messages.length,100);assert.equal(second.messages.length,100);assert.equal(first.counts.photos,205);assert.equal(first.messages[0].body,'caption');await sock.batch({'messages.upsert':{type:'notify',messages:[raw('livePhoto',{message:{imageMessage:{caption:'new',fileLength:5}}})]}});assert.equal(emitted,0);assert.notEqual(first.messages[0].id._serialized,second.messages[0].id._serialized);
 await client.syncHistory(peer);assert.equal(sock.history[1].id,'text');assert.equal(sock.history[0],50);
 const other=new BaileysStore(store,'other');assert.equal(other.galleryCounts(toJid(peer)).photos,0);
});
test('gallery-only mirrors new system-account replies without replaying history or enabling other accounts',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({galleryOnly:true,store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make}),received=[];
 t.after(()=>client.destroy());client.on('message',m=>received.push(m));await client.initialize();const sock=fake.sockets[0];
 await sock.batch({'messages.upsert':{type:'notify',messages:[raw('gallery-only')]}});assert.equal(received.length,0);
 store.setConfig('system_phone',a.phone);
 await sock.batch({'messages.upsert':{type:'append',messages:[raw('old')]}});assert.equal(received.length,0);
 await sock.batch({'messages.upsert':{type:'notify',messages:[raw('new'),raw('mine',{key:{remoteJid:'12025550124@s.whatsapp.net',id:'mine',fromMe:true}})]}});assert.equal(received.length,1);assert.equal(received[0].body,'hola');
 store.setConfig('system_phone','12025550199');await sock.batch({'messages.upsert':{type:'notify',messages:[raw('after-change')]}});assert.equal(received.length,1);
});
test('own WhatsApp display name is recovered from auth when socket user has no name',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),auth=new BaileysStore(store,a.id).auth();auth.state.creds.me={id:a.phone+'@s.whatsapp.net',name:'Mi empresa en WhatsApp'};auth.saveCreds();
 const client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();fake.sockets[0].user.name=undefined;
 const contact=await client.getContactById(a.phone+'@c.us');assert.equal(contact.pushname,'Mi empresa en WhatsApp');assert.equal(client.info.pushname,'Mi empresa en WhatsApp');
});

test('automatic gallery history resumes, advances past text-only batches, backs off and isolates errors',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();const sock=fake.sockets[0];
 await client.onConnection({connection:'open'},client.generation);assert.ok(client.historyTimer);
 client.saveMessage(raw('seed',{message:{imageMessage:{fileLength:5}}}));
 let calls=0;const fetch=sock.fetchMessageHistory;sock.fetchMessageHistory=async(...args)=>{calls++;return fetch(...args);};
 const now=Date.now();await client.pumpHistory(now);assert.equal(calls,1);assert.equal(sock.history[2],1700000000000);
 await client.pumpHistory(now+1000);assert.equal(calls,1);
 await sock.batch({'messaging-history.set':{messages:[raw('older-text',{messageTimestamp:1699999000})]}});
 await client.pumpHistory(now+60001);assert.equal(calls,2);assert.equal(sock.history[1].id,'older-text');assert.equal((await client.gallery('12025550124@c.us')).messages.length,1);
 await client.pumpHistory(now+120002);assert.equal(calls,3);
 const state=client.store.get('history-sync','12025550124@s.whatsapp.net');assert.equal(state.stalls,1);assert.ok(state.next>now+180002);
 sock.fetchMessageHistory=async()=>{throw Error('phone unavailable');};await client.pumpHistory(state.next+1);assert.equal(client.historyOnline,true);assert.ok(client.historyTimer);
 const next=client.store.get('history-sync','12025550124@s.whatsapp.net').next;assert.ok(next>state.next);
 await client.onConnection({connection:'close',lastDisconnect:{error:{output:{statusCode:440}}}},client.generation);assert.equal(client.historyOnline,false);assert.equal(client.historyTimer,null);
});
test('new photos and videos update gallery automatically without storing private texts or replaying history',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});t.after(()=>client.destroy());await client.initialize();let notifications=0;client.on('message',()=>notifications++);
 await fake.sockets[0].batch({'messages.upsert':{type:'notify',messages:[raw('photo',{message:{imageMessage:{fileLength:5}}}),raw('video',{message:{videoMessage:{fileLength:5}}}),raw('private-text')]}});
 const gallery=await client.gallery('12025550124@c.us');assert.equal(gallery.counts.photos,1);assert.equal(gallery.counts.videos,1);assert.equal(client.store.messages('12025550124@s.whatsapp.net').length,2);assert.equal(notifications,0);
});

test('a viewed account prioritizes its open chat while keeping other gallery history available',async t=>{
 const {store,a}=setup(t),fake=socketFactory();
 const client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});
 t.after(()=>client.destroy());await client.initialize();
 await client.onConnection({connection:'open'},client.generation);
 const first='12025550124@s.whatsapp.net',selected='12025550127@s.whatsapp.net';
 client.saveMessage(raw('first',{key:{remoteJid:first,id:'first',fromMe:false},messageTimestamp:1700000000,message:{imageMessage:{fileLength:5}}}));
 client.saveMessage(raw('selected',{key:{remoteJid:selected,id:'selected',fromMe:false},messageTimestamp:1700000000,message:{videoMessage:{fileLength:5}}}));
 const now=Date.now();
 client.setPanelFocus(selected,true,now);
 assert.equal(client.panelFocusPeer,selected);
 assert.ok(client.historyDue>now&&client.historyDue<now+12000,'viewed account gets an earlier sync timer');
 await client.pumpHistory(now);
 assert.equal(fake.sockets[0].history[1].remoteJid,selected,'the selected chat is checked before background chats');
 assert.equal(client.store.get('history-sync',selected).next>now,true,'cooldown remains enforced');
 await client.pumpHistory(now+1000);
 assert.equal(fake.sockets[0].history[1].remoteJid,first,'other chats continue receiving updates');
 client.setPanelFocus(null,false,now+2000);
 assert.equal(client.panelFocusUntil,0);
});

test('automatic gallery synchronization does not overlap requests for the same account',async t=>{
 const {store,a}=setup(t),fake=socketFactory(),client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});
 t.after(()=>client.destroy());await client.initialize();
 await client.onConnection({connection:'open'},client.generation);
 client.saveMessage(raw('seed',{message:{imageMessage:{fileLength:5}}}));
 let release,calls=0;
 fake.sockets[0].fetchMessageHistory=async()=>{calls++;return new Promise(resolve=>release=resolve);};
 const now=Date.now(),pending=client.pumpHistory(now);
 await tick();
 await client.pumpHistory(now+2500);
 assert.equal(calls,1);
 assert.equal(client.historyPumpActive,true);
 release('ok');await pending;
 assert.equal(client.historyPumpActive,false);
 assert.ok(client.historyTimer);
});

test('reconnect delays are stable per account and spread transient reconnect storms',async t=>{
 const {store,a}=setup(t),other=store.invite('12025550125','Otra').account;
 const initial=reconnectDelay(a.id,0,408),repeat=reconnectDelay(a.id,0,408);
 assert.equal(initial,repeat);
 assert.ok(initial>=2000&&initial<=3900);
 assert.ok(reconnectDelay(a.id,3,428)>initial);
 assert.ok(reconnectDelay(a.id,7,428)<=120000);
 assert.notEqual(reconnectDelay(a.id,2,408),reconnectDelay(other.id,2,408));
 const fake=socketFactory(),client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});
 t.after(()=>client.destroy());await client.initialize();
 const old=fake.sockets[0];
 await client.connect();
 assert.equal(old.ended,true,'previous transport is cleaned before restoring a new socket');
 assert.equal(fake.sockets.length,2);
});

test('a group gallery receives history priority only while that group is being viewed',async t=>{
 const {store,a}=setup(t),fake=socketFactory();
 const client=new BaileysClient({store,id:a.id,phone:a.phone,pair:true,socketFactory:fake.make});
 t.after(()=>client.destroy());await client.initialize();
 await client.onConnection({connection:'open'},client.generation);
 const group='123456789@g.us';
 client.saveMessage(raw('group-media',{key:{remoteJid:group,id:'group-media',fromMe:false},messageTimestamp:1700000200,message:{imageMessage:{fileLength:5}}}));
 await client.pumpHistory(Date.now());
 assert.equal(fake.sockets[0].history,undefined,'inactive groups are not newly scanned in gallery-only mode');
 const now=Date.now();
 client.setPanelFocus(group,true,now);
 await client.pumpHistory(now+1000);
 assert.equal(fake.sockets[0].history[1].remoteJid,group,'the selected group can request its already-indexed older photos');
 client.setPanelFocus(null,false,now+2000);
});
