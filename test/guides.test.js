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
test('Android GIF template upgrades stock guides without overwriting custom content',t=>{
 const {store}=setup(t),fresh=guides(store,'android');
 assert.equal(new Set(fresh.map(s=>s.asset)).size,5);assert.ok(fresh.every(s=>/^\/guides\/android-2026\/step-[1-5]\.gif$/.test(s.asset)));
 const titles=['Obtén tu código','Abre WhatsApp','Vincula un dispositivo','Elige vincular con número','Introduce el código en WhatsApp'];
 const texts=['En esta página, elige el país de tu número, escribe tu número sin prefijo y acepta la autorización si estás de acuerdo. Pulsa Obtener código. No recibirás un SMS: el código aparecerá aquí.','Abre WhatsApp en tu teléfono principal. En la pantalla de chats, pulsa el menú de los tres puntos (⋮).','Entra a Dispositivos vinculados y pulsa Vincular un dispositivo. Si aparece una notificación de vinculación, también puedes abrirla para continuar.','Pulsa Vincular con número de teléfono en lugar de escanear el QR. Si WhatsApp pide desbloquear el teléfono, hazlo dentro de la aplicación.','Copia el código que aparece en esta página e introdúcelo dentro de WhatsApp. Revisa el dispositivo solicitado y confirma solo si corresponde al gestor que autorizas. Vuelve a esta página para comprobar la conexión.'];
 const old=['prepare','open','linked','number','approve'].map((id,i)=>({id,title:titles[i],text:texts[i],asset:`/guides/android-${id}.svg`}));
 store.setConfig('guide_android',JSON.stringify(old));assert.deepEqual(guides(store,'android'),fresh);
 old[1].text='Instrucciones personalizadas';store.setConfig('guide_android',JSON.stringify(old));assert.deepEqual(guides(store,'android'),old);
 saveGuide(store,'android',fresh);assert.deepEqual(guides(store,'android'),fresh);
});
