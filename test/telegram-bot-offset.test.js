import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureTelegramBotOffset} from '../src/telegram-bot-offset.js';

function storeWith(config){
  const data={...config},writes=[];
  return {data,writes,config:()=>({...data}),setConfig:(key,value)=>{writes.push(key);data[key]=value;}};
}

test('new bot starts at zero without changing WhatsApp accounts, web or settings',()=>{
  const db=storeWith({telegram_offset:'5000',wa_public_sender_list:'["123"]',site_home:'intact',linked_account:'intact'});
  assert.deepEqual(ensureTelegramBotOffset(db,'123456789'),{offset:0,changed:false});
  assert.deepEqual(db.writes,['telegram_offset','telegram_bot_id']);
  assert.equal(db.data.telegram_offset,'0');
  assert.equal(db.data.telegram_bot_id,'123456789');
  assert.equal(db.data.wa_public_sender_list,'["123"]');
  assert.equal(db.data.site_home,'intact');
  assert.equal(db.data.linked_account,'intact');
});

test('same bot or regenerated TOKEN keeps its Telegram update offset',()=>{
  const db=storeWith({telegram_bot_id:'123456789',telegram_offset:'5200'});
  assert.deepEqual(ensureTelegramBotOffset(db,'123456789'),{offset:5200,changed:false});
  assert.deepEqual(db.writes,[]);
});

test('bot swap and subsequent switch back always start at zero',()=>{
  const db=storeWith({telegram_bot_id:'123456789',telegram_offset:'5200',custom:'unchanged'});
  assert.deepEqual(ensureTelegramBotOffset(db,'987654321'),{offset:0,changed:true});
  assert.equal(db.data.custom,'unchanged');
  db.setConfig('telegram_offset','22');
  assert.deepEqual(ensureTelegramBotOffset(db,'123456789'),{offset:0,changed:true});
  assert.equal(db.data.custom,'unchanged');
});

test('bad bot identity cannot change stored state',()=>{
  const db=storeWith({telegram_bot_id:'123456789',telegram_offset:'23'});
  for(const id of ['',undefined,'not-a-bot','0','1:secret'])
    assert.throws(()=>ensureTelegramBotOffset(db,id),/Identidad del bot/);
  assert.deepEqual(db.writes,[]);
});

test('reset-first ordering prevents a crash from preserving a stale offset',()=>{
  const db=storeWith({telegram_bot_id:'123456789',telegram_offset:'99999'});
  const original=db.setConfig;
  db.setConfig=(key,value)=>{if(key==='telegram_bot_id')throw Error('interrupted');original(key,value);};
  assert.throws(()=>ensureTelegramBotOffset(db,'987654321'),/interrupted/);
  assert.equal(db.data.telegram_offset,'0');
  assert.equal(db.data.telegram_bot_id,'123456789');
});
