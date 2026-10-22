import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Accounts } from '../src/whatsapp.js';
import { Telegram } from '../src/telegram.js';
import { countryOf, clippedHTML } from '../src/identity.js';
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
test('compose sends once to chosen chat and does not catch later messages',async t=>{
  const {bot,a,peer,out,message}=setup(t);
  await bot.control.action(123,123,{kind:'compose',id:a.id,peer});
  await bot.handle(message('Respuesta'));await bot.handle(message('Otra cosa'));
  assert.equal(out.length,1);assert.equal(out[0][1],'Respuesta');
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
