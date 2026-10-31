import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {Store} from '../src/store.js';
import {WebPanel} from '../src/panel.js';
import {publicSnapshot} from '../src/public-content.js';
import {cmPopupContent} from '../src/site-initial-popup.js';

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'popup-isolation-'));
 const store=new Store(dir);
 const telegram={admins:()=>new Set(['1']),permissions:()=>new Set(),send:async()=>{}};
 const panel=new WebPanel(store,{dir,live:new Map()},telegram,{dir,url:'http://test',secure:false,allowedOrigins:new Set()});
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,panel,editor:panel.editor,studio:panel.studio,admin:{actor:'1',role:'admin'}};
}
test('Cubamax has an independent opt-in initial popup and WhatsApp snapshot never changes',t=>{
 const {store,editor,dir}=setup(t);
 const beforeWA=publicSnapshot(store,'wa');
 const beforeCM=publicSnapshot(store,'cm');
 assert.equal(beforeCM.initialPopup,undefined,'existing Cubamax pages do not gain a popup automatically');
 assert.equal(cmPopupContent(store).enabled,false);
 const data=editor.data('1','cm'),waEditor=editor.data('1','wa');
 assert.equal(data.fields.find(f=>f.id==='initial:enabled').value,'off');
 assert.ok(data.fields.some(f=>f.id==='initial:photo'));
 assert.ok(!waEditor.fields.some(f=>f.id.startsWith('initial:')),'new settings never enter the WhatsApp editor');
 const file='/portal-media/'+'d'.repeat(64)+'.png';
 mkdirSync(path.join(dir,'portal-media'),{recursive:true});writeFileSync(path.join(dir,file.slice(1)),Buffer.from('sample'));
 const saved=editor.save('1',{site:'cm',revision:data.base,version:data.version,changes:[
  {id:'initial:enabled',value:'on'},{id:'initial:title',value:'Aviso importante'},
  {id:'initial:text',value:'Información de esta web.'},
  {id:'initial:button',value:'ENTENDIDO'},
  {id:'initial:color',value:'#116644'},
  {id:'initial:textColor',value:'#ffffff'},
  {id:'initial:photo',value:file}
 ]});
 assert.equal(publicSnapshot(store,'cm').initialPopup,undefined,'saving a draft is not publishing');
 assert.equal(publicSnapshot(store,'wa').revision,beforeWA.revision);
 editor.publish('1',{site:'cm',version:saved.version});
 const current=publicSnapshot(store,'cm');
 assert.equal(current.initialPopup.enabled,true);
 assert.equal(current.initialPopup.title,'Aviso importante');
 assert.equal(current.initialPopup.photo,file);
 assert.equal(current.initialPopup.button,'ENTENDIDO');
 assert.notEqual(current.revision,beforeCM.revision);
 assert.deepEqual(publicSnapshot(store,'wa'),beforeWA,'WhatsApp content, revision and popup stay byte-for-byte identical');
 const currentEditor=editor.data('1','cm');
 const disabled=editor.save('1',{site:'cm',version:currentEditor.version,revision:currentEditor.base,changes:[{id:'initial:enabled',value:'off'}]});
 editor.publish('1',{site:'cm',version:disabled.version});
 assert.equal(publicSnapshot(store,'cm').initialPopup.enabled,false);
 assert.equal(publicSnapshot(store,'cm').initialPopup.photo,file,'disabling preserves the saved design');
});
test('Studio pages have isolated popup data; existing designs stay without a popup',t=>{
 const {studio,admin,dir,store}=setup(t);
 const page=studio.create(admin,{name:'Nuevo sitio'});
 assert.equal(page.draft.initialPopup.enabled,false);
 const legacy=structuredClone(page.draft);delete legacy.initialPopup;
 const publishedLegacy=studio.save(admin,{id:page.id,version:page.version,draft:legacy},true);
 assert.equal(publishedLegacy.draft.initialPopup.enabled,false,'legacy missing configuration defaults to off');
 const file='/portal-media/'+'b'.repeat(64)+'.jpg';
 mkdirSync(path.join(dir,'portal-media'),{recursive:true});writeFileSync(path.join(dir,file.slice(1)),Buffer.from('sample'));
 const p=structuredClone(publishedLegacy.draft);
 p.initialPopup={enabled:true,title:'Aviso del sitio',text:'Texto independiente',button:'CONTINUAR',color:'#334455',textColor:'#ffffff',photo:file};
 const next=studio.save(admin,{id:page.id,version:publishedLegacy.version,draft:p},true);
 const token=studio.link(admin,page.id).url.split('/').at(-1);
 const design=studio.reference(page.id,token).design;
 assert.deepEqual(design.initialPopup,p.initialPopup);
 assert.deepEqual(next.draft.initialPopup,p.initialPopup);
 assert.equal(publicSnapshot(store,'wa').welcomePopup.title,'Antes de comenzar');
 const invalid=structuredClone(p);invalid.initialPopup.photo='https://elsewhere.example/file.png';
 assert.throws(()=>studio.validate(invalid),/foto del popup/);
 invalid.initialPopup.photo='';invalid.initialPopup.color='red;position:absolute';
 assert.throws(()=>studio.validate(invalid),/colores hexadecimales/);
 const off=structuredClone(p);off.initialPopup.enabled=false;
 assert.equal(studio.validate(off).initialPopup.enabled,false);
});
test('the shared popup renders text safely, only opens when enabled and closes on its own button',()=>{
 const source=readFileSync(new URL('../public/site-initial-popup.js',import.meta.url),'utf8');
 const elements=new Map(),events=new Map();
 class El{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.hidden=false;this.open=false;this.style={};this.attrs={};this.classes=new Set();this.classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);}};}
  append(...children){this.children.push(...children);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){this.events??={};this.events[k]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
 }
 const document={createElement:tag=>new El(tag),getElementById:id=>elements.get(id),body:{append(){}}};
 const window={};
 runInNewContext(source,{document,window});
 const off={enabled:false,title:'Texto <script>',text:'Información',button:'ENTENDIDO',photo:''};
 const dialog=window.SiteInitialPopup.show('test-popup',off);
 assert.equal(dialog.open,false);
 const preview=window.SiteInitialPopup.show('test-popup',off,{preview:true});
 assert.equal(preview.open,true);
 assert.equal(preview.initialParts.title.textContent,'Texto <script>','no HTML interpolation of user text');
 preview.initialParts.button.events.click();
 assert.equal(preview.open,false);
 window.SiteInitialPopup.show('test-popup',{...off,enabled:true,color:'#112233',photo:'/portal-media/'+'c'.repeat(64)+'.jpg'});
 assert.equal(preview.open,true);
 assert.equal(preview.classes.has('has-photo'),true);
 assert.equal(preview.initialParts.button.style.backgroundColor,'#112233');
});
test('Cubamax initial notice never overlaps the operator/referral popup',()=>{
 const source=readFileSync(new URL('../public/cubamax-initial-popup.js',import.meta.url),'utf8');
 function render(operator){const shown=[];
  const window={currentPublicContent:{initialPopup:{enabled:true}},SiteInitialPopup:{show:(...args)=>shown.push(args)},addEventListener(){}};
  const document={readyState:'complete',body:{dataset:operator?{operatorPopupSite:'cm'}:{}},getElementById:()=>null};
  runInNewContext(source,{document,window});return shown;
 }
 assert.equal(render(true).length,0);
 assert.equal(render(false).length,1);
});
test('both editors expose the popup controls, without changing the WhatsApp template',()=>{
 const studio=readFileSync(new URL('../public/studio.html',import.meta.url),'utf8');
 const studioPage=readFileSync(new URL('../public/studio-page.html',import.meta.url),'utf8');
 const cm=readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8');
 const wa=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 for(const id of ['popup-enabled','popup-title','popup-text','popup-button','popup-color','popup-text-color','popup-photo','popup-photo-remove','popup-preview','popup-disable'])assert.ok(studio.includes('id="'+id+'"'),id);
 assert.ok(studioPage.includes('/site-initial-popup.js'));
 assert.ok(cm.includes('/cubamax-initial-popup.js'));
 assert.ok(editor.includes("['initial','Popup inicial']"));
 assert.ok(!wa.includes('/site-initial-popup.js'),'the original WhatsApp frontend uses its original renderer');
});
