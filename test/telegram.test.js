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
