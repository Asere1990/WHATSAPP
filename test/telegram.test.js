import test from 'node:test';
import assert from 'node:assert/strict';
import { Telegram } from '../src/telegram.js';
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
