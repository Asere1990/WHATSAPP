import test from 'node:test';
import assert from 'node:assert/strict';
import { Telegram } from '../src/telegram.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('unauthorized actor cannot invoke account actions even from configured panel',async()=>{
  let calls=0;const bot=new Telegram({config:()=>({})},{admins:'123',panel:'-456'});bot.api=async()=>{calls++};bot.accounts={disconnect:async()=>{calls++}};
  await bot.handle({callback_query:{id:'q',from:{id:999},data:'disconnect:any',message:{chat:{id:-456,type:'group'}}}});assert.equal(calls,0);
});
test('admin commands outside private chat or designated panel are ignored',async()=>{
  let calls=0;const bot=new Telegram({config:()=>({})},{admins:'123',panel:'-456'});bot.api=async()=>{calls++};
  await bot.handle({message:{text:'/menu',from:{id:123},chat:{id:-789,type:'group'}}});assert.equal(calls,0);
});
test('branding rejects arbitrary CSS and unsupported keys',()=>{
  const bot=new Telegram({config:()=>({}),setConfig:()=>{}},{});assert.throws(()=>bot.edit('color','red; display:none'));assert.throws(()=>bot.edit('consent','false'));bot.edit('color','#25D366');
});
test('downloaded files go to ALMACEN while text goes to internal panel',async()=>{
  const bot=new Telegram({config:()=>({})},{token:'test',panel:'123',storage:'-1003634940510'}),calls=[];
  bot.api=async(method,body)=>{calls.push({method,body});return {chat:{id:123},message_id:1};};
  await bot.notify('Mensaje privado');await bot.notify(null,{data:Buffer.from('file'),name:'test.txt',mime:'text/plain',caption:'Texto original'});
  assert.equal(calls[0].body.chat_id,'123');assert.equal(calls[1].body.get('chat_id'),'-1003634940510');assert.equal(calls[1].body.get('caption'),'Texto original');
});

test('permisos.txt button is admin-only, accepts Telegram IDs and survives a new bot instance',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'wa-telegram-operator-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'base.txt');
  const store={config:()=>({})},bot=new Telegram(store,{admins:'123',panel:'-100555',dataDir:dir});
  bot.permissionFile.source=source;
  const sent=[];
  bot.api=async(method,body)=>{sent.push({method,body});return true;};
  bot.webPanel={access:{remember(){}},telegramAction:async()=>{throw Error('unexpected operator admin action')}};
  assert.ok(bot.menu().inline_keyboard.flat().some(x=>x.text==='permisos.txt'&&x.callback_data==='permissions-file'));
  const callback=(id,chatId=id,data='permissions-file')=>({callback_query:{id:'cb',from:{id},data,message:{chat:{id:chatId,type:'private'}}}});
  await bot.handle(callback(123));
  assert.match(sent.at(-1).body.text,/Envía uno o varios telegram_id/);
  await bot.handle({message:{text:'345678, 456789',from:{id:123},chat:{id:123,type:'private'}}});
  assert.ok(bot.permissions().has('345678'));
  assert.ok(bot.permissions().has('456789'));
  assert.match(sent.at(-1).body.text,/permisos.txt actualizado/);
  const reopened=new Telegram(store,{admins:'123',panel:'-100555',dataDir:dir});
  reopened.permissionFile.source=source;
  assert.ok(reopened.permissions().has('345678'),'new operator survives bot restart');
  assert.equal(reopened.admins().has('345678'),false,'operator does not become admin');
  const before=bot.permissions().size;
  await bot.handle(callback(456789,456789));
  assert.equal(bot.permissions().size,before,'operator cannot access the admin-only button');
  await bot.handle({message:{text:'567890',from:{id:456789},chat:{id:456789,type:'private'}}});
  assert.equal(bot.permissions().has('567890'),false,'operator cannot grant new privileges');
  await bot.handle(callback(123));
  await bot.handle({message:{text:'/cancelar',from:{id:123},chat:{id:123,type:'private'}}});
  await bot.handle({message:{text:'678901',from:{id:123},chat:{id:123,type:'private'}}});
  assert.equal(bot.permissions().has('678901'),false,'cancel must not grant privileges');
});

test('link notices go to the assigned operator DM and the existing group, not unrelated operators',async()=>{
  const sent=[];
  const store={config:()=>({})},bot=new Telegram(store,{admins:'123',panel:'-100555',storage:'-100666'});
  bot.webPanel={role:actor=>actor==='345678'?'operator':null,access:{owner:account=>account==='owned'?'345678':null}};
  bot.notifyAdmin=async(text)=>{sent.push({destination:'group',text});return {message_id:5};};
  bot.api=async(method,body)=>{sent.push({destination:String(body.chat_id),text:body.text});return {message_id:6};};
  await bot.notifyLinkEvent('Intento de vinculación',{kind:'attempt',account:'owned'});
  await bot.notifyLinkEvent('Cuenta vinculada',{kind:'connected',account:'owned'});
  assert.deepEqual(sent.map(x=>x.destination).sort(),['345678','345678','group','group'].sort());
  await bot.notifyLinkEvent('Otra cuenta',{kind:'attempt',account:'unassigned'});
  assert.deepEqual(sent.map(x=>x.destination).sort(),['345678','345678','group','group','group'].sort());
});
