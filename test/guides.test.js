import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Telegram } from '../src/telegram.js';
import { guides,saveGuide,detectMedia } from '../src/guides.js';
function setup(t){
  const dir=mkdtempSync(`${tmpdir()}/wa-guides-`),store=new Store(dir),bot=new Telegram(store,{admins:'123',url:'https://example.com',panel:'-456'});
  const calls=[];bot.accounts={dir};bot.api=async(method,body)=>{calls.push({method,body});return {};};
  t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
  const cb=(data,actor=123)=>({callback_query:{id:'q',data,from:{id:actor},message:{chat:{id:123,type:'private'}}}});
  const message=extra=>({message:{from:{id:123},chat:{id:123,type:'private'},...extra}});
  return {dir,store,bot,calls,cb,message};
}
test('Android and iPhone guides have different entry instructions and independent edits',t=>{
  const {store}=setup(t),android=guides(store,'android'),iphone=guides(store,'iphone');
  assert.match(android[1].text,/tres puntos/);assert.match(iphone[1].text,/Configuración/);
  android[1].text='Nuevo menú Android';saveGuide(store,'android',android);
  assert.equal(guides(store,'android')[1].text,'Nuevo menú Android');assert.match(guides(store,'iphone')[1].text,/Configuración/);
});
test('guide editor accepts text changes only through authorized private callbacks',async t=>{
  const {bot,store,cb,message}=setup(t);await bot.handle(cb('guide:android:open:text',999));assert.equal(bot.pending.size,0);
  await bot.handle(cb('guide:android:open:text'));assert.equal(bot.pending.size,1);
  await bot.handle(message({text:'Abre el nuevo menú.'}));assert.equal(guides(store,'android')[1].text,'Abre el nuevo menú.');assert.equal(bot.pending.size,0);
});
test('editing guide media stores bytes on persistent disk and survives store reopen',async t=>{
  const {bot,store,dir,cb,message}=setup(t),gif=Buffer.from('GIF89a'+'sample');bot.download=async()=>gif;
  await bot.handle(cb('guide:iphone:open:asset'));await bot.handle(message({animation:{file_id:'f',file_size:gif.length}}));
  const asset=guides(store,'iphone')[0].asset;assert.match(asset,/^\/guide-media\/[a-f0-9]{64}\.gif$/);assert.deepEqual(readFileSync(dir+asset),gif);
  const reopened=new Store(dir);assert.equal(guides(reopened,'iphone')[0].asset,asset);reopened.db.close();
});
test('GIF conversions to MP4 are supported; SVG and HTML uploads are rejected',()=>{
  assert.equal(detectMedia(Buffer.from('0000ftypisom')).ext,'mp4');
  assert.throws(()=>detectMedia(Buffer.from('<svg onload="bad()"></svg>')));assert.throws(()=>detectMedia(Buffer.from('<html>bad</html>')));
});
test('adding, reordering and deleting steps use stable IDs and preserve the other guide',async t=>{
  const {bot,store,cb}=setup(t);await bot.handle(cb('guide:android:new:add'));
  let steps=guides(store,'android');assert.equal(steps.length,6);const id=steps.at(-1).id;
  await bot.handle(cb(`guide:android:${id}:up`));assert.equal(guides(store,'android')[4].id,id);
  await bot.handle(cb(`guide:android:${id}:delete`));assert.equal(guides(store,'android').length,5);assert.equal(guides(store,'iphone').length,5);
});
test('validation rejects arbitrary asset URLs and oversized instructions',t=>{
  const {store}=setup(t),steps=guides(store,'android');steps[0].asset='https://attacker.example/a.svg';assert.throws(()=>saveGuide(store,'android',steps));
  steps[0].asset=null;steps[0].text='x'.repeat(1001);assert.throws(()=>saveGuide(store,'android',steps));
});
