import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {Store} from '../src/store.js';
import {WebPanel} from '../src/panel.js';
import {publicSnapshot} from '../src/public-content.js';

const photo='/portal-media/'+'e'.repeat(64)+'.jpg';
const layer={id:'ocr-0',x:0.12,y:0.34,w:0.62,h:0.052,original:'ANTES DE COMENZAR',text:'COMIENZA AHORA',
 color:'#ffffff',fontSize:48,weight:'700',family:'Arial'};
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'ocr-regression-')),store=new Store(dir);
 const telegram={admins:()=>new Set(['1']),permissions:()=>new Set(),send:async()=>{}};
 const panel=new WebPanel(store,{dir,live:new Map()},telegram,{dir,url:'http://localhost',secure:false,allowedOrigins:new Set(['http://localhost'])});
 mkdirSync(path.join(dir,'portal-media'));writeFileSync(path.join(dir,photo.slice(1)),Buffer.from('test-photo'));
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,panel,dir};
}
test('standalone Studio text replacements persist without modifying the original image or WhatsApp',t=>{
 const {store,panel}=fixture(t),studio=panel.studio,admin={role:'admin',actor:'1'};
 const waBefore=publicSnapshot(store,'wa');
 const p=studio.create(admin,{name:'Web independiente'});
 p.draft.initialPopup={enabled:true,title:'Aviso',text:'Información',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo,layers:[layer]};
 const published=studio.save(admin,{id:p.id,version:p.version,draft:p.draft},true);
 const link=studio.link(admin,p.id).url.split('/').at(-1);
 const design=studio.reference(p.id,link).design;
 assert.equal(design.initialPopup.layers[0].text,'COMIENZA AHORA');
 assert.equal(design.initialPopup.photo,photo);
 assert.deepEqual(publicSnapshot(store,'wa'),waBefore);
 const now=structuredClone(published.draft);
 now.initialPopup.layers[0].text='CAMBIA EL TEXTO';
 studio.save(admin,{id:p.id,version:published.version,draft:now},true);
 assert.equal(studio.reference(p.id,link).design.initialPopup.layers[0].text,'CAMBIA EL TEXTO');
 assert.equal(studio.reference(p.id,link).design.initialPopup.photo,photo);
});
test('Cubamax draft can save text-layer JSON, publish separately and undo a changed phrase',t=>{
 const {store,panel}=fixture(t),waBefore=publicSnapshot(store,'wa'),editor=panel.editor;
 const cm=editor.data('1','cm');
 const draft=editor.save('1',{site:'cm',revision:cm.base,version:cm.version,changes:[
  {id:'initial:photo',value:photo},{id:'initial:layers',value:JSON.stringify([layer])},
  {id:'initial:enabled',value:'on'}
 ]});
 assert.equal(publicSnapshot(store,'cm').initialPopup,undefined);
 editor.publish('1',{site:'cm',version:draft.version});
 assert.equal(publicSnapshot(store,'cm').initialPopup.layers[0].text,'COMIENZA AHORA');
 assert.equal(publicSnapshot(store,'cm').initialPopup.photo,photo);
 const recent=editor.data('1','cm');
 const restored=[{...layer,text:layer.original}];
 const pending=editor.save('1',{site:'cm',revision:recent.base,version:recent.version,changes:[
  {id:'initial:layers',value:JSON.stringify(restored)}
 ]});
 editor.publish('1',{site:'cm',version:pending.version});
 assert.equal(publicSnapshot(store,'cm').initialPopup.layers[0].text,layer.original);
 assert.deepEqual(publicSnapshot(store,'wa'),waBefore);
 assert.ok(!editor.data('1','wa').fields.some(x=>x.id.startsWith('initial:')));
});
test('photo popup preview detects two taps and keeps the original intact',()=>{
 const source=readFileSync(new URL('../public/site-initial-popup.js',import.meta.url),'utf8');
 const items=new Map(),edits=[];
 class El{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.hidden=false;this.open=false;this.complete=false;this.events={};this.attributes={};this.set={};this.classes=new Set();this.classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);}};}
  set id(v){this._id=v;items.set(v,this);}get id(){return this._id;}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
  append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}
  addEventListener(type,fn){this.events[type]=fn;}
  showModal(){this.open=true;}close(){this.open=false;}
  getAttribute(k){return this.attributes[k];}
 }
 const doc={createElement:tag=>new El(tag),getElementById:id=>items.get(id),body:{append(){}}};
 const win={};
 runInNewContext(source,{window:win,document:doc});
 const popup=win.SiteInitialPopup.show('original-popup',{enabled:true,photo,layers:[layer]},{
  preview:true,onTextDoubleTap:i=>edits.push(i)});
 assert.equal(popup.open,true);
 assert.equal(popup.initialParts.targets.children.length,1);
 const target=popup.initialParts.targets.children[0],click={preventDefault(){}};
 target.events.click(click);target.events.click(click);
 assert.deepEqual(edits,[0]);
 assert.equal(popup.initialParts.photo.src,photo);
 win.SiteInitialPopup.render(popup,{enabled:true,photo,layers:[{...layer,text:'CORREGIDO'}]});
 assert.equal(popup.initialParts.photo.src,photo,'non-destructive rendering preserves uploaded image URL');
});
test('WhatsApp image and popup files were not replaced by the Studio/Cubamax OCR implementation',()=>{
 const wa=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const original=readFileSync(new URL('../public/welcome-popup.js',import.meta.url),'utf8');
 const studio=readFileSync(new URL('../public/studio.js',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 assert.ok(wa.includes('id="wa-welcome"'));
 assert.ok(original.includes('globalThis.checkWelcomePopup'));
 assert.ok(studio.includes("api('editor/ocr'"));
 assert.ok(editor.includes("chosen==='initial:photo'&&data.site==='cm'"));
 assert.ok(editor.includes("m?.type==='popup-ocr-edit'"));
});
