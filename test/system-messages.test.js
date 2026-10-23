import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-system-'),store=new Store(dir),account=store.invite('12025550123','Sistema').account;
 store.update(account.id,'consent',1);const bot=new Telegram(store,{admins:'123,124',token:'test',panel:'-1001',storage:'-1002'}),calls=[],delivered=[];
 bot.api=async(method,body)=>{calls.push({method,body});return true;};bot.accounts={live:new Map([[account.id,{ready:true}]]),tools:{client(id){if(!store.account(id)?.consent)throw Error('No autorizado');return {};}}};
 bot.deliver=async(m,id,peer)=>{delivered.push({m,id,peer});};
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const message=m=>({message:{from:{id:123},chat:{id:123,type:'private'},...m}}),callback=(data,actor=123)=>({callback_query:{id:'cb',from:{id:actor},data,message:{chat:{id:actor,type:'private'}}}});
 return {store,account,bot,calls,delivered,message,callback};
}
async function draft(f,m){await f.bot.handle(f.callback('system-message'));await f.bot.handle(f.message({text:'+12025550126'}));await f.bot.handle(f.message(m));return f.calls.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data;}
test('system button uses its saved sender and supports text, photo, video, audio and voice with single-use confirmation',async t=>{
 const f=setup(t);assert.match(f.bot.menu().inline_keyboard.flat().map(b=>b.text).join('|'),/MENSAJE DE SISTEMA PARA/);
 for(const m of [{text:'Hola <persona>'},{photo:[{file_id:'photo',file_size:10}],caption:'Foto'},{video:{file_id:'video',file_size:10}},{audio:{file_id:'audio',file_size:10}},{voice:{file_id:'voice',file_size:10}}]){
  const before=f.delivered.length,token=await draft(f,m);assert.equal(f.delivered.length,before);
  await assert.rejects(f.bot.handle(f.callback(token,124)),/venció/);assert.equal(f.delivered.length,before);
  await f.bot.handle(f.callback(token));assert.equal(f.delivered.length,before+1);assert.equal(f.delivered.at(-1).id,f.account.id);assert.equal(f.delivered.at(-1).peer,'12025550126@c.us');
  for(const key of Object.keys(m))assert.deepEqual(f.delivered.at(-1).m[key],m[key]);
  await assert.rejects(f.bot.handle(f.callback(token)),/venció/);
 }
});
test('cancel, invalid phone, large file, albums and changed sender prevent system send',async t=>{
 const f=setup(t);await f.bot.handle(f.callback('system-message'));await assert.rejects(f.bot.handle(f.message({text:'2025550126'})),/inválido/);
 await f.bot.handle(f.message({text:'+12025550126'}));await assert.rejects(f.bot.handle(f.message({photo:[{file_id:'x',file_size:21*1024*1024}]})),/20 MB/);
 await assert.rejects(f.bot.handle(f.message({photo:[{file_id:'x'}],media_group_id:'album'})),/álbumes/);
 const token=await draft(f,{text:'Cancelar'});await f.bot.handle(f.message({text:'/cancelar'}));await assert.rejects(f.bot.handle(f.callback(token)),/venció/);
 const changed=await draft(f,{text:'Otro'});f.store.setConfig('system_account','other');await assert.rejects(f.bot.handle(f.callback(changed)),/Cambió/);assert.equal(f.delivered.length,0);
});
test('only authorized private admins configure the system sender; ambiguous names never pick an arbitrary account',async t=>{
 const f=setup(t);await f.bot.handle(f.callback('system-message',999));assert.equal(f.bot.pending.size,0);assert.equal(f.store.config().system_account,undefined);
 const other=f.store.invite('12025550127','Sistema').account;f.store.update(other.id,'consent',1);assert.equal(f.bot.systemMessages.resolve(),null);
 await f.bot.handle(f.callback('sys:select:'+f.account.id));assert.equal(f.store.config().system_account,f.account.id);assert.equal(f.bot.pending.get('123:123').stage,'number');
});
test('system inbound photos, videos and audio go to CHATS, other gallery files still go to ALMACEN',async t=>{
 const f=setup(t);for(const mime of ['image/jpeg','video/mp4','audio/ogg']){
  await f.bot.notify(null,{systemReply:true,data:Buffer.from('x'),name:'media',mime});assert.equal(f.calls.at(-1).body.get('chat_id'),'-1001');
 }
 await f.bot.notify(null,{data:Buffer.from('x'),name:'photo.jpg',mime:'image/jpeg'});assert.equal(f.calls.at(-1).body.get('chat_id'),'-1002');
});
