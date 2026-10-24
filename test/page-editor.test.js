import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {pageCatalog,pageContent} from '../src/page-editor.js';
import {portalContent} from '../src/portal.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=','base64');
function setup(t){const dir=mkdtempSync(path.join(tmpdir(),'page-editor-')),store=new Store(dir),bot=new Telegram(store,{admins:'123',url:'https://example.test'}),sent=[];bot.accounts={dir};bot.api=async()=>({});bot.send=async(...args)=>sent.push(args);bot.download=async()=>png;t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {bot,store,sent,dir};}
function callback(data,actor=123){return {callback_query:{id:'cb',from:{id:actor},data,message:{chat:{id:actor,type:'private'}}}};}
test('Telegram page editor separates sites, clears drafts on back and preserves stored text across reopening',async t=>{
 const {bot,store,sent,dir}=setup(t);await bot.handle(callback('design'));assert.deepEqual(sent.at(-1)[2].inline_keyboard.flat().map(b=>b.text),['EDITAR WHATSAPP','EDITAR CUBAMAX']);
 const field=Object.keys(pageCatalog.wa).find(k=>pageCatalog.wa[k].text==='Copiar código');
 await bot.handle(callback('pg:wa:field:'+field,999));assert.equal(bot.pending.size,0);
 await bot.handle(callback('pg:wa:field:'+field));await bot.handle({message:{from:{id:123},chat:{id:123,type:'private'},text:'COPIAR AHORA'}});
 assert.equal(pageContent(store,'wa').find(f=>f.source==='Copiar código').value,'COPIAR AHORA');assert.deepEqual(pageContent(store,'cm'),[]);
 const other=new Store(dir);assert.equal(pageContent(other,'wa')[0].value,'COPIAR AHORA');other.db.close();
 await bot.handle(callback('pg:wa:field:'+field));await bot.handle(callback('design'));assert.equal(bot.pending.size,0);
 await bot.handle(callback('pg:wa:reset:'+field));assert.deepEqual(pageContent(store,'wa'),[]);
});
test('popup photos, button names, colors and service icons are independent and reject unsafe content',async t=>{
 const {bot,store}=setup(t);const before=portalContent(store);
 await bot.portalEditor.input(123,{field:'moneyPopupButton'},{text:'CONTINUAR'});
 await bot.portalEditor.input(123,{field:'moneyPopupColor'},{text:'#ff1234'});
 await assert.rejects(bot.portalEditor.input(123,{field:'moneyPopupColor'},{text:'red;display:none'}),/RRGGBB/);
 for(const mediaKey of ['moneyIcon','moneyPopupPhoto'])await bot.portalEditor.input(123,{field:'extraMedia',mediaKey},{photo:[{file_id:'test'}]});
 const saved=portalContent(store);assert.equal(saved.fields.moneyPopupButton,'CONTINUAR');assert.equal(saved.fields.comboPopupButton,before.fields.comboPopupButton);assert.equal(saved.fields.moneyPopupColor,'#ff1234');assert.equal(Object.keys(saved.extraMedia).length,2);assert.deepEqual(saved.cards,before.cards);assert.deepEqual(saved.slides,before.slides);
 bot.download=async()=>Buffer.from('<svg onload="bad()"></svg>');await assert.rejects(bot.portalEditor.input(123,{field:'extraMedia',mediaKey:'comboIcon'},{document:{file_id:'bad'}}),/imagen/);assert.equal(portalContent(store).extraMedia.comboIcon,undefined);
 await bot.portalEditor.callback(123,'123:123','cm:remove:moneyIcon');assert.equal(portalContent(store).extraMedia.moneyIcon,undefined);assert.ok(portalContent(store).extraMedia.moneyPopupPhoto);
});
test('browser overrides preserve button identity and handle later dynamic text, placeholders and pictures',async()=>{
 const text=(value)=>({nodeType:3,nodeValue:value,childNodes:[],parentElement:{closest:()=>false}});
 const title=text('Copiar código'),status=text('PASO 2 DE 5'),dynamic=text('Número que estás vinculando: +12025550123');
 const attrs={placeholder:'Tu número',src:'/cubamax-services/shein.webp'},image={nodeType:1,tagName:'IMG',childNodes:[],hasAttribute:k=>k in attrs,getAttribute:k=>attrs[k],setAttribute:(k,v)=>attrs[k]=v};
 const button={nodeType:1,childNodes:[title],hasAttribute:()=>false,onclick:()=>42};
 const document={nodeType:9,documentElement:{},childNodes:[button,status,dynamic,image]};let changed;
 const entries=[{source:'Copiar código',value:'COPIAR $&',kind:'text'},{source:'PASO {paso} DE {total}',value:'Etapa {paso}/{total}',kind:'text'},{source:'Número que estás vinculando: {numero}',value:'Cuenta: {numero}',kind:'text'},{source:'Tu número',value:'Número nuevo',kind:'text'},{source:'/cubamax-services/shein.webp',value:'/portal-media/'+'a'.repeat(64)+'.jpg',kind:'image'}];
 const context=vm.createContext({document,location:{pathname:'/cubamax'},fetch:async()=>({ok:true,json:async()=>entries}),MutationObserver:class{constructor(fn){changed=fn;}disconnect(){}observe(){}}});
 await vm.runInContext(readFileSync(new URL('../public/page-content.js',import.meta.url),'utf8'),context);
 assert.equal(title.nodeValue,'COPIAR $&');assert.equal(button.onclick(),42);assert.equal(status.nodeValue,'Etapa 2/5');assert.equal(dynamic.nodeValue,'Cuenta: +12025550123');assert.equal(attrs.placeholder,'Número nuevo');assert.match(attrs.src,/portal-media/);
 status.nodeValue='PASO 3 DE 5';changed([{type:'characterData',target:status}]);assert.equal(status.nodeValue,'Etapa 3/5');
});
