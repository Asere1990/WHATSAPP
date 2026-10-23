import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {portalContent} from '../src/portal.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=','base64');
function setup(t){const dir=mkdtempSync(path.join(tmpdir(),'cubamax-editor-')),store=new Store(dir),bot=new Telegram(store,{admins:'123',url:'https://example.test',panel:'123'}),sent=[];bot.accounts={dir};bot.send=async(...args)=>{sent.push(args);};bot.download=async()=>png;bot.api=async()=>({});t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {dir,store,bot,sent};}
test('Cubamax text is persistent, independent from main site branding and excludes private config',async t=>{
 const {store,bot}=setup(t);store.setConfig('title','WhatsApp title');store.setConfig('telegram_offset','secret');await bot.portalEditor.input(123,{field:'headline'},{text:'Nuestro equipo'});
 assert.equal(portalContent(store).fields.headline,'Nuestro equipo');assert.equal(store.config().title,'WhatsApp title');assert.equal(JSON.stringify(portalContent(store)).includes('secret'),false);
 await assert.rejects(bot.portalEditor.input(123,{field:'headline'},{text:'x'.repeat(601)}),/600/);
});
test('slider upload persists validated image and caption, reorders and removes without affecting WhatsApp',async t=>{
 const {store,bot,dir}=setup(t);await bot.portalEditor.input(123,{field:'image',slide:'packages'},{photo:[{file_id:'photo',file_size:png.length}],caption:'Nuestros envíos'});
 const slides=portalContent(store).slides,s=slides.find(s=>s.id==='packages');assert.equal(s.title,'Nuestros envíos');assert.match(s.asset,/^\/portal-media\/[a-f0-9]{64}\.png$/);assert.deepEqual(readFileSync(path.join(dir,s.asset)),png);
 await bot.portalEditor.callback(123,'123:123','cm:slide:packages:right');assert.equal(portalContent(store).slides[1].id,'packages');
 await bot.portalEditor.callback(123,'123:123','cm:slide:packages:delete');assert.equal(portalContent(store).slides.some(s=>s.id==='packages'),false);
 await bot.portalEditor.input(123,{field:'logo'},{document:{file_id:'logo'}});assert.match(portalContent(store).logo,/portal-media/);assert.equal(store.config().logo,undefined);store.setConfig('cubamax_slides','[]');assert.equal(portalContent(store).slides.find(s=>s.id==='packages').asset,'/cubamax-promos/bicicleta.webp');
});
test('adding and cancelling does not leave a placeholder slide; invalid files never replace the current photo',async t=>{
 const {bot,store}=setup(t);await bot.portalEditor.callback(123,'123:123','cm:add');const pending=bot.pending.get('123:123');assert.equal(portalContent(store).slides.length,4);
 await bot.handle({message:{from:{id:123},chat:{id:123,type:'private'},text:'/cancelar'}});assert.equal(portalContent(store).slides.length,4);
 bot.download=async()=>Buffer.from('<svg onload="bad()"></svg>');await assert.rejects(bot.portalEditor.input(123,pending,{photo:[{file_id:'bad'}]}),/imagen/);assert.equal(portalContent(store).slides.length,4);
 bot.download=async()=>png;await bot.portalEditor.input(123,pending,{photo:[{file_id:'ok'}],caption:'Nueva foto'});assert.equal(portalContent(store).slides.length,5);
});
test('only an authorized admin in private can open or edit Cubamax',async t=>{
 const {bot,sent,store}=setup(t);const callback=(actor,chat)=>({callback_query:{id:'cb',from:{id:actor},data:'cm:field:headline',message:{chat}}});
 await bot.handle(callback(999,{id:999,type:'private'}));assert.equal(sent.length,0);assert.equal(bot.pending.size,0);
 await bot.handle(callback(123,{id:123,type:'private'}));assert.equal(bot.pending.get('123:123').field,'headline');
 await bot.handle({message:{from:{id:123},chat:{id:123,type:'private'},text:'Nuevo título'}});assert.equal(portalContent(store).fields.headline,'Nuevo título');assert.equal(bot.pending.size,0);
});
test('invalid external carousel sources are never exposed by the public content endpoint',t=>{
 const {store}=setup(t);store.setConfig('cubamax_slides',JSON.stringify([{id:'external',title:'Bad',asset:'https://example.test/a.svg'}]));store.setConfig('cubamax_logo','javascript:bad()');assert.equal(portalContent(store).slides.length,4);assert.equal(portalContent(store).logo,'/cubamax-logo.svg');
});
test('each service popup edits independently through the admin menu and survives reload',async t=>{
 const {bot,store,sent}=setup(t);const before=portalContent(store);
 await bot.portalEditor.callback(123,'123:123','cm:popups');assert.equal(sent.at(-1)[2].inline_keyboard.length,5);
 for(const service of ['money','combo','packages','topup']){
  await bot.handle({callback_query:{id:'popup',from:{id:123},data:'cm:field:'+service+'PopupTitle',message:{chat:{id:123,type:'private'}}}});
  await bot.handle({message:{from:{id:123},chat:{id:123,type:'private'},text:'Título '+service}});
  await bot.portalEditor.input(123,{field:service+'PopupDescription'},{text:'Descripción '+service});
 }
 const content=portalContent(store);for(const service of ['money','combo','packages','topup']){assert.equal(content.fields[service+'PopupTitle'],'Título '+service);assert.equal(content.fields[service+'PopupDescription'],'Descripción '+service);assert.equal(content.fields[service+'Title'],before.fields[service+'Title']);}
 assert.deepEqual(content.slides,before.slides);assert.equal(content.logo,before.logo);
});
test('four button photos persist independently, remove restores one default and unsafe URLs are rejected',async t=>{
 const {store,bot}=setup(t);const before=portalContent(store);
 for(const service of ['money','combo','packages','topup'])await bot.portalEditor.input(123,{field:'serviceImage',service},{photo:[{file_id:'photo'}]});
 const cards=portalContent(store).cards;assert.deepEqual(Object.keys(cards),['money','combo','packages','topup']);assert.ok(Object.values(cards).every(a=>/^\/portal-media\//.test(a)));
 await bot.portalEditor.callback(123,'123:123','cm:card:money:delete');assert.equal(portalContent(store).cards.money,undefined);assert.equal(portalContent(store).cards.combo,cards.combo);
 assert.deepEqual(portalContent(store).slides,before.slides);assert.equal(portalContent(store).logo,before.logo);assert.deepEqual(portalContent(store).fields,before.fields);
 store.setConfig('cubamax_cards',JSON.stringify({money:'https://evil.test/x.png',combo:'javascript:bad'}));assert.deepEqual(portalContent(store).cards,{});
});

test('second slider uses requested order, migrates only original illustrations, and preserves uploaded customization',t=>{
 const {store}=setup(t);const original=['money','combo','packages','topup'].map(id=>({id,title:id,asset:`/cubamax-slides/${id}.svg`}));store.setConfig('cubamax_slides',JSON.stringify(original));
 const slides=portalContent(store).slides;assert.deepEqual(slides.map(s=>s.asset),['/cubamax-promos/bicicleta.webp','/cubamax-promos/moto.webp','/cubamax-promos/remesas.webp','/cubamax-promos/carga.webp']);
 assert.deepEqual(JSON.parse(store.config().cubamax_slides),slides);slides[0].asset='/portal-media/'+'a'.repeat(64)+'.png';store.setConfig('cubamax_slides',JSON.stringify(slides));assert.equal(portalContent(store).slides[0].asset,slides[0].asset);
});

test('swapping the four service slides migrates the previous configured set once',t=>{
 const {store}=setup(t);store.setConfig('cubamax_slides',JSON.stringify(['shein','remesas','recargas','supercombo'].map((id,i)=>({id:['packages','money','topup','combo'][i],title:id,asset:`/cubamax-services/${id}.webp`}))));
 assert.deepEqual(portalContent(store).slides.map(s=>s.asset),['/cubamax-promos/bicicleta.webp','/cubamax-promos/moto.webp','/cubamax-promos/remesas.webp','/cubamax-promos/carga.webp']);
});
