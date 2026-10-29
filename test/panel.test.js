import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Store} from '../src/store.js';
import {PanelAccess} from '../src/panel-access.js';
import {Telegram} from '../src/telegram.js';
import {WebPanel} from '../src/panel.js';
import {BaileysClient,toJid} from '../src/baileys.js';
import {BaileysStore} from '../src/baileys-store.js';
function setup(t){const dir=mkdtempSync(tmpdir()+'/wa-panel-'),store=new Store(dir),roles=new Map([['1','admin'],['2','operator'],['3','operator']]),access=new PanelAccess(store,id=>roles.get(id));t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});const a=store.invite('12025550123','Uno').account,b=store.invite('12025550124','Dos').account;for(const row of [a,b]){store.update(row.id,'consent',1);store.update(row.id,'status','connected');}return {dir,store,roles,access,a,b};}
test('referrals bind each account once, persist across reopening and never grant another tenant access',t=>{
 const {store,dir,roles,access,a,b}=setup(t);access.attach(a.id,access.token('2','referral'));access.attach(b.id,access.token('3','referral'));
 assert.equal(access.allowed('2',a.id),true);assert.equal(access.allowed('2',b.id),false);assert.equal(access.allowed('1',b.id),true);assert.throws(()=>access.attach(a.id,access.token('3','referral')),/asignada/);
 const other=new Store(dir),again=new PanelAccess(other,id=>roles.get(id));assert.equal(again.owner(a.id),'2');other.db.close();
 const old=access.token('2','referral');access.token('2','referral');assert.ok(access.referral(old));roles.delete('2');assert.equal(access.allowed('2',a.id),false);
});
test('login is single use and sessions immediately lose access after permission removal',t=>{
 const {access,roles}=setup(t),token=access.token('2','login'),session=access.login(token);assert.ok(session);assert.equal(access.login(token),null);assert.equal(access.session(session.secret).actor,'2');roles.delete('2');assert.equal(access.session(session.secret),null);assert.throws(()=>access.token('4','login'),/autorizado/);
});
test('archive keeps texts/audio and gallery independently, omits protected content and resumes older backfill',async t=>{
 const {store,a}=setup(t),saved=new BaileysStore(store,a.id),peer='12025550129@s.whatsapp.net';
 const raw=(id,ts,message)=>({key:{id,remoteJid:peer,fromMe:false},messageTimestamp:ts,message});saved.message(raw('photo',200,{imageMessage:{caption:'Foto',fileLength:4}}));saved.put('cursor',peer,{key:raw('old',100,{}).key,messageTimestamp:100});
 const client=new BaileysClient({store,id:a.id,phone:a.phone});t.after(()=>client.destroy());let requested;client.socket={fetchMessageHistory:async(...args)=>requested=args,end(){}};
 client.saveMessage(raw('text',180,{conversation:'Texto conservado'}));client.saveMessage(raw('audio',160,{audioMessage:{mimetype:'audio/ogg',fileLength:6}}));client.saveMessage(raw('once',150,{viewOnceMessage:{message:{imageMessage:{fileLength:7}}}}));
 assert.equal(saved.messages(peer).length,3);assert.equal(saved.galleryCounts(peer).photos,1);await client.syncHistory(peer);assert.equal(requested[1].id,'once');assert.equal(requested[2],150000);
 client.saveMessage(raw('boundary',90,{conversation:'Más antiguo'}));assert.equal(saved.get('archive-backfill',peer).active,false);assert.equal(saved.messages(peer).length,4);
});
test('panel API rejects foreign accounts/media, bad origins, missing CSRF and repeated sends',async t=>{
 const {store,a,b}=setup(t),admins=new Set(['1']),operators=new Set(['2','3']),telegram={admins:()=>admins,permissions:()=>operators},accounts={live:new Map(),send:async()=>{accounts.sent=(accounts.sent||0)+1;}},panel=new WebPanel(store,accounts,telegram,{url:'http://test',secure:false,allowedOrigins:new Set(['http://test'])});panel.access.attach(a.id,panel.access.token('2','referral'));panel.access.attach(b.id,panel.access.token('3','referral'));
 const db=new BaileysStore(store,a.id),peer='12025550129@s.whatsapp.net',raw={key:{id:'one',remoteJid:peer,fromMe:false},messageTimestamp:100,message:{conversation:'Solo propietario'}};db.message(raw);db.put('chat',peer,{id:peer});
 const server=createServer((req,res)=>panel.handle(req,res,new URL(req.url,'http://local').pathname,{'Cache-Control':'no-store'},async r=>{let s='';for await(const chunk of r)s+=chunk;return JSON.parse(s||'{}');}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port;
 let response=await fetch(url+'/vincular/'+panel.access.token('2','referral'),{redirect:'manual'});assert.equal(response.status,302);assert.match(response.headers.get('set-cookie'),/SameSite=Lax/);
 response=await fetch(url+'/api/panel/accounts');assert.equal(response.status,401);
 response=await fetch(url+'/api/panel/login',{method:'POST',headers:{Origin:'http://evil'},body:JSON.stringify({token:panel.access.token('2','login')})});assert.equal(response.status,403);
 const login=panel.access.login(panel.access.token('2','login')),headers={Cookie:'wa_panel='+login.secret,Origin:'http://test','X-Panel-CSRF':login.csrf};
 response=await fetch(url+'/api/panel/editor/data?site=cm',{headers});assert.equal(response.status,403);
 response=await fetch(url+'/api/panel/editor/publish',{method:'POST',headers,body:JSON.stringify({site:'cm',version:0})});assert.equal(response.status,403);
 response=await fetch(url+'/api/panel/accounts',{headers});assert.deepEqual((await response.json()).items.map(row=>row.id),[a.id]);
 response=await fetch(url+'/api/panel/messages?account='+b.id+'&peer='+peer,{headers});assert.equal(response.status,404);
 response=await fetch(url+'/api/panel/avatar?account='+b.id,{headers});assert.equal(response.status,404);
 response=await fetch(url+'/api/panel/avatar?account='+a.id+'&peer=12025550999@s.whatsapp.net',{headers});assert.equal(response.status,404);
 response=await fetch(url+'/api/panel/media?account='+b.id+'&message='+Buffer.from(db.messageKey(raw.key)).toString('base64url'),{headers});assert.equal(response.status,404);
 response=await fetch(url+'/api/panel/messages?account='+a.id+'&peer='+peer,{headers});assert.equal((await response.json()).items[0].text,'Solo propietario');
 const message={account:a.id,peer,text:'Hola',request:'a'.repeat(32)};
 response=await fetch(url+'/api/panel/send',{method:'POST',headers:{...headers,'X-Panel-CSRF':''},body:JSON.stringify(message)});assert.equal(response.status,403);
 response=await fetch(url+'/api/panel/send',{method:'POST',headers,body:JSON.stringify(message)});assert.equal(response.status,200);response=await fetch(url+'/api/panel/send',{method:'POST',headers,body:JSON.stringify(message)});assert.equal(response.status,409);assert.equal(accounts.sent,1);
 const {default:sharp}=await import('sharp'),jpeg=await sharp({create:{width:4,height:4,channels:3,background:'#00aa88'}}).jpeg().toBuffer(),photo={key:{id:'preview',remoteJid:peer,fromMe:false},messageTimestamp:101,message:{imageMessage:{jpegThumbnail:jpeg.toString('base64'),fileLength:20}}};db.message(photo);response=await fetch(url+'/api/panel/thumb?account='+a.id+'&message='+Buffer.from(db.messageKey(photo.key)).toString('base64url'),{headers});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
 operators.delete('2');response=await fetch(url+'/api/panel/accounts',{headers});assert.equal(response.status,401);
});
test('enrollment attribution uses the displayed link, not a referral cookie changed in another tab',t=>{
 const {store,a}=setup(t),telegram={admins:()=>new Set(['1']),permissions:()=>new Set(['2','3'])},panel=new WebPanel(store,{live:new Map()},telegram,{url:'http://test',secure:false,allowedOrigins:new Set()});const left=panel.access.token('2','referral'),right=panel.access.token('3','referral');panel.consent(a.id,{headers:{cookie:'wa_referral='+right}},left);assert.equal(panel.access.owner(a.id),'2');assert.throws(()=>panel.consent(a.id,{headers:{}},right),/asignada/);
});

test('limited Telegram users get their menu and cannot invoke admin callbacks or commands',async t=>{
 const {store}=setup(t),bot=new Telegram(store,{}),calls=[];bot.admins=()=>new Set(['1']);bot.permissions=()=>new Set(['2']);bot.api=async()=>{};bot.webPanel={access:{remember(){}},telegramMenu:async(...args)=>calls.push(['menu',...args]),telegramAction:async(...args)=>calls.push(['action',...args])};
 const message={chat:{id:2,type:'private'},from:{id:2,first_name:'Equipo'},text:'/menu'};await bot.handle({message});assert.deepEqual(calls,[['menu',2,2]]);
 await bot.handle({message:{...message,text:'/desconectar abc'}});await bot.handle({callback_query:{id:'x',from:message.from,message,data:'design'}});assert.equal(calls.length,1);
 await bot.handle({message:{...message,text:'/panel'}});assert.deepEqual(calls.at(-1),['action',2,2,'panel']);
 await bot.handle({message:{...message,chat:{id:-100,type:'group'}}});await bot.handle({message:{...message,from:{id:3}}});assert.equal(calls.length,2);
});
test('permanent personal links work repeatedly after years and restart, and can revoke all sessions',t=>{
 const {store,dir,roles,access}=setup(t),link=access.permanent('2'),first=access.login(link),second=access.login(link);assert.ok(first&&second);assert.equal(access.permanent('2'),link);
 const actualNow=Date.now;try{Date.now=()=>actualNow()+20*365*86400000;assert.ok(access.login(link));assert.ok(access.session(first.secret));assert.equal(access.permanent('2'),link);}finally{Date.now=actualNow;}
 const reopened=new Store(dir),again=new PanelAccess(reopened,id=>roles.get(id));assert.equal(again.permanent('2'),link);assert.ok(again.login(link));again.revoke('2');assert.equal(again.login(link),null);assert.equal(again.session(first.secret),null);assert.equal(again.session(second.secret),null);const replacement=again.permanent('2');assert.notEqual(replacement,link);reopened.db.close();roles.delete('2');assert.equal(access.login(replacement),null);
});
test('number and LID references share ordinary text, audio and gallery without crossing accounts',t=>{
 const {store,a,b}=setup(t),telegram={admins:()=>new Set(['1']),permissions:()=>new Set(['2'])},panel=new WebPanel(store,{live:new Map()},telegram,{dir:store.dir,url:'http://test',allowedOrigins:new Set()}),client=new BaileysClient({store,id:a.id,phone:a.phone});t.after(()=>client.destroy());const pn='12025550129@s.whatsapp.net',lid='999000111@lid';
 client.saveChat({id:pn,name:'Contacto de prueba',conversationTimestamp:100,messages:[{message:{key:{id:'embedded',remoteJid:pn,fromMe:false},messageTimestamp:100,message:{conversation:'Texto de historial del chat'}}}]});
 client.saveMessage({key:{id:'text',remoteJid:lid,remoteJidAlt:pn,fromMe:true},messageTimestamp:101,message:{extendedTextMessage:{text:'Respuesta normal'}}});client.saveMessage({key:{id:'audio',remoteJid:lid,fromMe:false},messageTimestamp:102,message:{audioMessage:{ptt:true,seconds:12,mimetype:'audio/ogg; codecs=opus',waveform:Buffer.from([2,20,60,100])}}});client.saveMessage({key:{id:'photo',remoteJid:pn,fromMe:false},messageTimestamp:103,message:{imageMessage:{fileLength:20}}});
 const result=panel.messages('1',a.id,pn,null);assert.deepEqual(result.items.map(m=>m.type),['chat','chat','ptt','image']);assert.equal(result.items[0].text,'Texto de historial del chat');assert.deepEqual(result.items[2].waveform,[2,20,60,100]);assert.equal(panel.messages('1',a.id,pn,null,true).items.length,1);assert.deepEqual(panel.messages('1',b.id,pn,null).items,[]);assert.deepEqual(new BaileysStore(store,b.id).peers(pn),[pn]);assert.equal(new BaileysStore(store,a.id).canonical(lid),pn);
});
test('first new ordinary message reopens the gap skipped by the old gallery filter without resetting each live message',t=>{
 const {store,a}=setup(t),peer='12025550129@s.whatsapp.net',client=new BaileysClient({store,id:a.id,phone:a.phone});t.after(()=>client.destroy());const saved=new BaileysStore(store,a.id),m=(id,ts)=>({key:{id,remoteJid:peer,fromMe:false},messageTimestamp:ts,message:{conversation:id}});client.saveMessage(m('old-gallery-anchor',100));saved.put('history-sync',peer,{next:Date.now()+3600000});client.saveMessage(m('new-live',300),{live:true});assert.equal(saved.get('archive-backfill',peer).cursor.key.id,'new-live');assert.equal(saved.get('archive-backfill',peer).boundary,100);assert.equal(saved.get('history-sync',peer),undefined);client.saveMessage(m('recovered-text',250));client.saveMessage(m('another-live',400),{live:true});assert.equal(saved.get('archive-backfill',peer).cursor.key.id,'recovered-text');assert.equal(saved.messages(peer).length,4);
});
test('referral chooser keeps WhatsApp and Cubamax links separate and ownership survives either page',async t=>{
 const {store,a,b}=setup(t),sent=[],telegram={admins:()=>new Set(['1']),permissions:()=>new Set(['2']),send:async(...args)=>sent.push(args)},panel=new WebPanel(store,{live:new Map()},telegram,{url:'http://test',allowedOrigins:new Set()});await panel.telegramAction(2,2,'referral');assert.deepEqual(sent[0][2].inline_keyboard.slice(0,2).map(row=>row[0].callback_data),['op:referral:wa','op:referral:cm']);
 const cm=panel.access.token('2','referral',{site:'cm'}),wa=panel.access.token('2','referral',{site:'wa'});assert.equal(panel.access.referral(cm).site,'cm');assert.equal(panel.access.referral(wa).site,'wa');panel.access.attach(a.id,cm);panel.access.attach(b.id,wa);assert.equal(panel.access.owner(a.id),'2');assert.equal(panel.access.owner(b.id),'2');const wa2=panel.access.token('2','referral',{site:'wa'});assert.ok(panel.access.referral(wa));assert.ok(panel.access.referral(cm));assert.ok(panel.access.referral(wa2));const short=panel.access.short(cm),waShort=panel.access.short(wa2);assert.equal(short,'00001');assert.equal(waShort,'00002');assert.equal(panel.access.referral(short).site,'cm');assert.equal(panel.access.referral(waShort).site,'wa');assert.equal(panel.access.referral('99999'),null);
 const req={method:'GET',headers:{},url:'/vincular/'+wa2},res={writeHead(status,headers){this.status=status;this.headers=headers;},end(){}};await panel.handle(req,res,req.url,{},()=>{});assert.equal(res.status,302);assert.equal(res.headers.Location,'/whatsapp');const shortReq={method:'GET',headers:{},url:'/00001'},shortRes={writeHead(status,headers){this.status=status;this.headers=headers;},end(){}};await panel.handle(shortReq,shortRes,shortReq.url,{},()=>{});assert.equal(shortRes.status,302);assert.equal(shortRes.headers.Location,'/cubamax');assert.match(shortRes.headers['Set-Cookie'],/wa_referral=00001/);assert.throws(()=>panel.access.token('2','referral',{site:'unknown'}),/Página/);
});

test('Telegram issues distinct URLs on each verified domain without revoking previous links',async t=>{const {store}=setup(t),sent=[],telegram={admins:()=>new Set(['1']),permissions:()=>new Set(['2']),send:async(...args)=>sent.push(args)},panel=new WebPanel(store,{live:new Map()},telegram,{url:'https://securitywhat.app',allowedOrigins:new Set()});await panel.telegramAction(2,2,'referral:cm');await panel.telegramAction(2,2,'referral:wa');await panel.telegramAction(2,2,'referral:cm');await panel.telegramAction(2,2,'referral:wa');const expected=['https://cubamaxcom.online/00001','https://securitywhat.app/000002','https://cubamaxcom.online/00003','https://securitywhat.app/000004'];for(let i=0;i<sent.length;i++)assert.ok(sent[i][1].includes(expected[i]),'Expected '+expected[i]);assert.deepEqual(expected.map(link=>panel.access.referral(link.split('/').at(-1)).site),['cm','wa','cm','wa']);assert.equal(sent.some(row=>row[1].includes('onrender.com')),false);});
