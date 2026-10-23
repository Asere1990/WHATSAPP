import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Accounts } from '../src/whatsapp.js';
import { Telegram } from '../src/telegram.js';
import { countryOf, clippedHTML,webPhone,phoneParts } from '../src/identity.js';
function setup(t){
  const dir=mkdtempSync(`${tmpdir()}/wa-control-`),s=new Store(dir),a=s.invite('13215121897','Anterior').account,b=s.invite('5351234567','Segunda').account;
  s.update(a.id,'consent',1);s.update(b.id,'consent',1);
  const bot=new Telegram(s,{admins:'123,124',token:'test',panel:'-10010',storage:'-10020'}),calls=[],out=[];
  bot.api=async(method,body)=>{calls.push({method,body});return {chat:{id:body instanceof FormData?body.get('chat_id'):body.chat_id},message_id:calls.length};};
  const manager=new Accounts(s,dir,(...args)=>bot.notify(...args));bot.accounts=manager;
  const peer='12025550124@c.us',messages=[{id:{_serialized:'incoming'},type:'chat',body:'Hola <amigo>',from:peer,to:a.phone+'@c.us',fromMe:false,timestamp:1792700000}];
  const chat={id:{_serialized:peer},name:'Contacto',timestamp:1,isGroup:false,unreadCount:2,fetchMessages:async()=>messages};
  const client={info:{wid:{user:a.phone},pushname:'María & compañía'},getContactById:async()=>({pushname:'Pedro'}),getChats:async()=>[chat],getBlockedContacts:async()=>[],getProfilePicUrl:async()=>null,getChatById:async()=>chat,sendMessage:async(...args)=>{out.push(args);return {id:{_serialized:'sent'}};}};
  manager.live.set(a.id,{ready:true,client});
  manager.tools.gallery=async()=>({messages,complete:true,pages:1});
  t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});
  const message=(text,chatId=123,extra={})=>({message:{text,from:{id:123},chat:{id:chatId,type:chatId===123?'private':'supergroup'},...extra}});
  const callback=(data,actor=123,chatId=123)=>({callback_query:{id:'q',data,from:{id:actor},message:{chat:{id:chatId,type:chatId===123?'private':'supergroup'}}}});
  return {s,a,b,bot,manager,client,peer,messages,calls,out,message,callback};
}
test('private menu reports connected count, WhatsApp name, full clickable phone and country',async t=>{
  const {bot,message,calls}=setup(t);await bot.handle(message('/menu'));
  const text=calls.at(-1).body.text;assert.match(text,/Cuentas conectadas: 1/);assert.match(text,/María &amp; compañía/);assert.match(text,/https:\/\/wa.me\/13215121897/);assert.match(text,/Estados Unidos/);
});
test('menu selection opens account, chats and individual chat buttons',async t=>{
  const {bot,a,peer,message,callback,calls}=setup(t);await bot.handle(message('/menu'));
  const accountButton=calls.at(-1).body.reply_markup.inline_keyboard.find(row=>row[0].text.includes('María'))[0];
  await bot.handle(callback(accountButton.callback_data));
  assert.match(calls.at(-1).body.text,/Chats privados disponibles: 1/);
  const chatsButton=calls.at(-1).body.reply_markup.inline_keyboard[0][0];await bot.handle(callback(chatsButton.callback_data));
  assert.match(calls.at(-1).body.text,/Pedro/);await bot.handle(message('1'));
  const labels=calls.at(-1).body.reply_markup.inline_keyboard.flat().map(b=>b.text).join('|');
  assert.match(labels,/RESPONDER/);assert.match(labels,/BORRAR ÚLTIMO MENSAJE/);assert.match(labels,/FOTOS 10/);assert.match(labels,/VER MENSAJES/);
});
test('callback cannot cross administrators or chats',async t=>{
  const {bot,message,callback,calls}=setup(t);await bot.handle(message('/menu'));
  const data=calls.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data;
  await assert.rejects(bot.handle(callback(data,124)),/venció/);
  // Even an authorized administrator must use the private menu, not group controls.
  await bot.handle(callback(data,123,-10010));assert.match(calls.at(-1).body.text,/privado/);
});
test('reply routing overrides pending compose and preserves selected account for voice',async t=>{
  const {bot,a,b,manager,client,peer,out,message}=setup(t);
  manager.live.set(b.id,{ready:true,client:{...client,sendMessage:async()=>assert.fail('La respuesta salió desde la cuenta incorrecta')}});bot.store.route('-10010',91,a.id,peer);
  bot.control.composing.set('-10010:123',{id:b.id,peer:'5350000000@c.us',expires:Date.now()+10000});
  bot.download=async()=>Buffer.from('audio');
  await bot.handle(message('',-10010,{reply_to_message:{message_id:91},voice:{file_id:'voice',mime_type:'audio/ogg'}}));
  assert.equal(out.length,1);assert.equal(out[0][0],peer);assert.equal(out[0][2].sendAudioAsVoice,true);
  assert.equal(bot.control.composing.has('-10010:123'),false);
});
test('compose keeps text and following photo bound to selected contact until cancelled',async t=>{
  const {bot,a,peer,out,message}=setup(t);
  await bot.control.action(123,123,{kind:'compose',id:a.id,peer});
  bot.download=async()=>Buffer.from('jpg');
  await bot.handle(message('Respuesta'));
  await bot.handle(message('',123,{photo:[{file_id:'photo'}]}));
  assert.equal(out.length,2);assert.equal(out[0][1],'Respuesta');assert.equal(out[1][0],peer);assert.equal(out[1][1].mimetype,'image/jpeg');
  await bot.handle(message('/cancelar'));await bot.handle(message('Otra cosa'));assert.equal(out.length,2);
});
test('incoming sender and receiver have distinct clickable identities and HTML-safe body',async t=>{
  const {manager,a,peer,calls}=setup(t);
  await manager.receive(a.id,{id:{_serialized:'recv'},from:peer,body:'<>&'.repeat(3000),type:'chat'});
  const sent=calls.find(c=>c.method==='sendMessage'&&c.body.parse_mode==='HTML');
  assert.equal(sent.body.chat_id,'-10010');assert.match(sent.body.text,/Escribe:.*Pedro/);assert.match(sent.body.text,/Recibe:.*María/);assert.ok(sent.body.text.length<=4096);assert.match(sent.body.text,/&lt;&gt;&amp;/);
});
test('view received messages stores persistent reply routes',async t=>{
  const {bot,a,peer,calls,s}=setup(t);await bot.control.messages(123,123,a.id,peer);
  const row=calls.find(c=>c.body.text?.includes('Hola &lt;amigo&gt;'));
  assert.ok(row);const index=calls.indexOf(row)+1;assert.equal(s.getRoute(123,index).account,a.id);assert.equal(s.getRoute(123,index).peer,peer);
});
test('delete previews exact outgoing message; refuses expired revoke and another peer',async t=>{
  const {bot,a,peer,client,calls,manager}=setup(t);let deleted=0;
  const msg={id:{_serialized:'out-1'},fromMe:true,to:peer,type:'chat',body:'Prueba',delete:async everyone=>{assert.equal(everyone,true);deleted++;}};
  client.getChatById=async()=>({fetchMessages:async()=>[msg]});client.getMessageById=async()=>msg;client.pupPage={evaluate:async()=>false};
  await bot.control.action(123,123,{kind:'deletePreview',id:a.id,peer});assert.equal(deleted,0);
  const data=calls.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data;
  await assert.rejects(bot.control.callback(123,123,data),/no permite/);assert.equal(deleted,0);
  client.pupPage.evaluate=async()=>true;await manager.tools.deleteOutgoing(a.id,peer,'out-1');assert.equal(deleted,1);
  await assert.rejects(manager.tools.deleteOutgoing(a.id,'5350000000@c.us','out-1'),/esa conversación/);assert.equal(deleted,1);
});
test('download cap, media filters and persistent dedup prevent duplicate storage',async t=>{
  const {manager,a,peer,messages,s}=setup(t);messages.length=0;
  for(let n=0;n<15;n++)messages.push({id:{_serialized:'media-'+n},type:'image',hasMedia:true,rawData:{size:3},downloadMedia:async()=>({data:Buffer.from('abc').toString('base64'),mimetype:'image/jpeg'})});
  messages.push({id:{_serialized:'ephemeral'},type:'image',hasMedia:true,isEphemeral:true});
  let copied=0;const deliver=async()=>{copied++;};
  const one=await manager.tools.downloadRecent(a.id,peer,'photos',deliver);assert.equal(one.sent,10);
  const two=await manager.tools.downloadRecent(a.id,peer,'photos',deliver);assert.equal(two.sent,5);assert.equal(copied,15);
  const three=await manager.tools.downloadRecent(a.id,peer,'videos',deliver);assert.equal(three.sent,0);
  assert.equal(s.exportState(a.id,'ephemeral'),undefined);
});
test('uncertain export stays reviewable and is not automatically repeated',async t=>{
  const {manager,a,peer,messages,s}=setup(t);messages.splice(0,messages.length,{id:{_serialized:'uncertain'},type:'video',hasMedia:true,rawData:{size:3},downloadMedia:async()=>({data:'YWJj',mimetype:'video/mp4'})});
  await assert.rejects(manager.tools.downloadRecent(a.id,peer,'videos',async()=>{throw Error('network');}));
  assert.equal(s.exportState(a.id,'uncertain'),'review');
  const again=await manager.tools.downloadRecent(a.id,peer,'videos',async()=>assert.fail('duplicate'));assert.equal(again.sent,0);
});
test('conversation audio goes to CHATS while photos stay in ALMACEN',async t=>{
  const {bot,calls}=setup(t);
  await bot.notify(null,{data:Buffer.from('a'),name:'voice.ogg',mime:'audio/ogg',conversation:true,voice:true});
  await bot.notify(null,{data:Buffer.from('p'),name:'photo.jpg',mime:'image/jpeg'});
  assert.equal(calls[0].method,'sendVoice');assert.equal(calls[0].body.get('chat_id'),'-10010');assert.equal(calls[1].body.get('chat_id'),'-10020');
});
test('phone country comes from full numbering plan, including shared +1 prefix',()=>{
  assert.equal(countryOf('13215121897'),'Estados Unidos');assert.equal(countryOf('14165551234'),'Canadá');assert.equal(countryOf('5351234567'),'Cuba');
  const clipped=clippedHTML('<'.repeat(5000));assert.ok(clipped.length<2010);assert.doesNotMatch(clipped,/</);
});
test('account card remains available with explicit unavailable statistics when WhatsApp rejects chat reads',async t=>{
  const {bot,a,client,calls}=setup(t);client.getChats=async()=>{throw Error('r');};
  await bot.control.account(123,123,a.id);
  assert.match(calls.at(-1).body.text,/Chats privados disponibles: No disponible/);
  assert.match(calls.at(-1).body.text,/No se pudo consultar/);
  assert.match(calls.at(-1).body.reply_markup.inline_keyboard[0][0].text,/CHATS/);
});
test('partial chat reads are disclosed in both account statistics and contact list',async t=>{
  const {bot,a,client,calls}=setup(t);client.pupPage={evaluate:async()=>2};
  await bot.control.account(123,123,a.id);assert.match(calls.at(-1).body.text,/Lista parcial: 2/);
  await bot.control.chats(123,123,a.id);assert.match(calls.at(-1).body.text,/Lista parcial: 2/);
});
test('one unavailable WhatsApp file does not prevent remaining downloads and unknown size is checked after download',async t=>{
  const {manager,a,peer,messages}=setup(t);
  messages.splice(0,messages.length,
    {id:{_serialized:'good'},type:'image',hasMedia:true,rawData:{},downloadMedia:async()=>({data:'YWJj',mimetype:'image/jpeg'})},
    {id:{_serialized:'broken'},type:'image',hasMedia:true,rawData:{size:3},downloadMedia:async()=>{throw Error('t');}});
  let sent=0;const result=await manager.tools.downloadRecent(a.id,peer,'photos',async()=>{sent++;});
  assert.equal(sent,1);assert.equal(result.failed,1);assert.equal(result.sent,1);
});
test('opening design menu closes active WhatsApp recipient before editing',async t=>{
  const {bot,a,peer,message,callback,out}=setup(t);
  await bot.control.action(123,123,{kind:'compose',id:a.id,peer});
  await bot.handle(callback('design'));await bot.handle(message('texto para la página'));
  assert.equal(out.length,0);assert.equal(bot.control.composing.size,0);
});
test('gallery sync distinguishes accepted history request from unavailable history without claiming completion',async t=>{
  const {bot,a,peer,client,calls}=setup(t);let requested;
  client.syncHistory=async target=>{requested=target;return true;};
  await bot.control.action(123,123,{kind:'syncMedia',id:a.id,peer});assert.equal(requested,peer);assert.match(calls.at(-1).body.text,/aceptó la solicitud/);assert.match(calls.at(-1).body.text,/no garantiza/);
  client.syncHistory=async()=>false;
  await bot.control.action(123,123,{kind:'syncMedia',id:a.id,peer});assert.match(calls.at(-1).body.text,/no ofreció ampliar/);
});
test('history combines both participants in one message and paginates by editing it',async t=>{
  const {bot,a,peer,messages,calls,callback}=setup(t);
  messages.push({...messages[0],id:{_serialized:'out'},fromMe:true,body:'Mi respuesta',timestamp:1792700001});
  await bot.control.messages(123,123,a.id,peer);
  assert.equal(calls.length,1);assert.match(calls[0].body.text,/Hola &lt;amigo&gt;/);assert.match(calls[0].body.text,/Mi respuesta/);assert.match(calls[0].body.text,/María/);
  for(let i=0;i<40;i++)messages.push({...messages[0],body:'mucho texto '.repeat(30),timestamp:1792700010+i});
  await bot.control.messages(123,123,a.id,peer);
  const sent=calls.at(-1),previous=sent.body.reply_markup.inline_keyboard[0][0];
  await bot.handle({...callback(previous.callback_data),callback_query:{...callback(previous.callback_data).callback_query,message:{message_id:2,chat:{id:123,type:'private'}}}});
  assert.equal(calls.at(-1).method,'editMessageText');assert.equal(calls.at(-1).body.message_id,2);assert.ok(calls.at(-1).body.text.length<=4096);
});
test('history voice is playable on demand in the same private chat with reply route',async t=>{
  const {bot,a,peer,messages,calls,callback,s}=setup(t);
  messages.push({id:{_serialized:'voice'},type:'ptt',hasMedia:true,fromMe:false,timestamp:1792700001,downloadMedia:async()=>({data:'YWJj',mimetype:'audio/ogg'})});
  await bot.control.messages(123,123,a.id,peer);
  assert.doesNotMatch(calls[0].body.text,/\[ptt\]/);
  const play=calls[0].body.reply_markup.inline_keyboard.flat().find(b=>b.text.includes('ESCUCHAR'));
  await bot.handle(callback(play.callback_data));
  const voice=calls.at(-1);assert.equal(voice.method,'sendVoice');assert.equal(voice.body.get('chat_id'),'123');assert.equal(await voice.body.get('voice').text(),'abc');
  assert.equal(s.getRoute(123,calls.length).peer,peer);
});
test('account card uploads actual profile bytes, caption and keyboard together',async t=>{
  const {bot,a,client,calls}=setup(t);client.getProfilePicUrl=async()=> 'https://pps.whatsapp.net/profile.jpg';bot.profilePhoto=async()=>Buffer.from('profile');
  await bot.control.account(123,123,a.id);const card=calls.at(-1);
  assert.equal(card.method,'sendPhoto');assert.equal(await card.body.get('photo').text(),'profile');assert.match(card.body.get('caption'),/María/);assert.match(card.body.get('reply_markup'),/CHATS/);
});
test('manual photos use ALMACEN native media, validated receipts, and persistent links',async t=>{
  const {bot,manager,a,peer,messages,calls,s}=setup(t);
  messages.splice(0,messages.length,{id:{_serialized:'pic'},type:'image',hasMedia:true,rawData:{size:3},downloadMedia:async()=>({data:'YWJj',mimetype:'image/jpeg'})});
  const base=bot.api;bot.api=async(method,body)=>{if(method==='getChat')return {id:-10020};const r=await base(method,body);if(method==='sendPhoto')r.photo=[{file_id:'photo'}];return r;};
  await bot.control.action(123,123,{kind:'download',id:a.id,peer,media:'photos'});await Promise.all(bot.control.jobs);
  const file=calls.find(c=>c.method==='sendPhoto');assert.equal(file.body.get('chat_id'),'-10020');assert.equal(await file.body.get('photo').text(),'abc');
  assert.equal(s.exportState(a.id,'pic'),'done');assert.equal(s.receipt(a.id,'pic').tg_chat,'-10020');assert.match(calls.at(-1).body.text,/https:\/\/t.me\/c\/20\//);
});
test('wrong destination or missing file confirmation never counts as delivered',async t=>{
  const {bot,a,peer,messages,s,calls}=setup(t);
  messages.splice(0,messages.length,{id:{_serialized:'wrong'},type:'video',hasMedia:true,rawData:{size:3},downloadMedia:async()=>({data:'YWJj',mimetype:'video/mp4'})});
  const base=bot.api;bot.api=async(method,body)=>method==='getChat'?{id:-10020}:method==='sendVideo'?{chat:{id:-999},message_id:8,video:{file_id:'x'}}:base(method,body);
  await bot.control.action(123,123,{kind:'download',id:a.id,peer,media:'videos'});await Promise.all(bot.control.jobs);
  assert.equal(s.exportState(a.id,'wrong'),'review');assert.equal(s.receipt(a.id,'wrong'),undefined);assert.match(calls.at(-1).body.text,/TG_STORAGE_RECEIPT/);
});
test('only legacy unverified completed exports can be manually enabled again',async t=>{
  const {s,a}=setup(t);
  for(const key of ['legacy','proven','uncertain'])s.claimExport(a.id,key);
  s.finishExport(a.id,'legacy','done');s.finishExport(a.id,'proven','done');s.finishExport(a.id,'uncertain','review');s.exportReceipt(a.id,'proven',-10020,4);
  assert.equal(s.resetUnverifiedExport(a.id,'legacy'),true);assert.equal(s.resetUnverifiedExport(a.id,'proven'),false);assert.equal(s.resetUnverifiedExport(a.id,'uncertain'),false);
});
test('download progress reflects only confirmed files, has correct small-batch denominator and survives edit failures',async t=>{
  const {manager,a,peer,messages}=setup(t),progress=[];
  messages.splice(0,messages.length,...[1,2,3].map(n=>({id:{_serialized:'progress-'+n},type:'image',hasMedia:true,rawData:{size:3},downloadMedia:async()=>({data:'YWJj',mimetype:'image/jpeg'})})));
  let confirmations=0;
  const result=await manager.tools.downloadRecent(a.id,peer,'photos',async()=>{confirmations++;},async p=>{assert.equal(p.sent,confirmations);progress.push(p);if(p.sent===1)throw Error('Telegram edit unavailable');});
  assert.equal(result.sent,3);assert.deepEqual(progress.filter(p=>p.phase==='sent').map(p=>p.percent),[33,66,100]);assert.equal(progress[0].percent,0);assert.equal(progress.at(-1).target,3);
});
test('unavailable files are not reported as successful 100 percent',async t=>{
  const {manager,a,peer,messages}=setup(t),progress=[];
  messages.splice(0,messages.length,{id:{_serialized:'missing-progress'},type:'image',hasMedia:true,rawData:{size:3},downloadMedia:async()=>null});
  await manager.tools.downloadRecent(a.id,peer,'photos',async()=>assert.fail(),async p=>progress.push(p));assert.equal(progress.at(-1).phase,'finished');assert.equal(progress.at(-1).percent,0);assert.equal(progress.at(-1).skipped,1);
});

test('country selector normalizes national numbers, including trunk prefixes and shared calling codes',()=>{
 assert.equal(webPhone({country:'CU',nationalNumber:'51234567'}),'5351234567');
 assert.equal(webPhone({country:'US',nationalNumber:'3215121897'}),'13215121897');
 assert.equal(webPhone({country:'GB',nationalNumber:'02079460018'}),'442079460018');
 assert.equal(phoneParts('13215121897').country,'US');assert.equal(phoneParts('5351234567').nationalNumber,'51234567');
 assert.throws(()=>webPhone({country:'XX',nationalNumber:'12345678'}));assert.throws(()=>webPhone({country:'CU',nationalNumber:'+5351234567'}));
});
