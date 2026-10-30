import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const editorSource=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');

function mockElement(tag='div'){
 const el={
  tagName:tag.toUpperCase(),children:[],value:'',textContent:'',disabled:false,hidden:false,
  attributes:{},classList:{add(){},remove(){},toggle(){}},
  append(...items){this.children.push(...items);},prepend(...items){this.children.unshift(...items);},
  replaceChildren(...items){this.children=[...items];},removeAttribute(name){delete this.attributes[name];},
  setAttribute(name,value){this.attributes[name]=value;},close(){this.open=false;},showModal(){this.open=true;},
  querySelector(){return null;},addEventListener(){},
 };
 return el;
}

async function editor(site='wa',{conflict=false,dirty=false}={}){
 const elements=new Map(),listeners={},calls=[],confirmations=[];
 const $=id=>{if(!elements.has(id))elements.set(id,mockElement());return elements.get(id);};
 const pageWindow={postMessage(){}};
 $('page').contentWindow=pageWindow;
 $('site').value=site;
 const field={id:'brand:description',kind:'text',label:'Descripción principal',group:'branding',value:'Descripción original'};
 const draft={site,version:dirty?4:0,base:'revision',revision:'revision',dirty,conflict,fields:[field]};
 const copy=v=>JSON.parse(JSON.stringify(v));
 const fetch=async(url,options={})=>{
  const route=url.replace('/api/panel/',''),payload=options.body?JSON.parse(options.body):null;
  calls.push({route,payload});
  if(route==='me')return {ok:true,json:async()=>({role:'admin',csrf:'csrf'})};
  if(route.startsWith('editor/data?site='))return {ok:true,json:async()=>copy(draft)};
  if(route==='editor/rebase'){
   assert.equal(payload.site,'wa');
   assert.equal(payload.version,draft.version);
   assert.equal(draft.dirty,true);
   draft.base=draft.revision;
   draft.conflict=false;
   draft.version++;
   return {ok:true,json:async()=>copy(draft)};
  }
  if(route==='editor/draft'){
   assert.equal(payload.site,site);
   assert.equal(payload.version,draft.version);
   assert.equal(payload.revision,draft.base);
   assert.equal(payload.changes[0].id,'brand:description');
   draft.version++;
   draft.dirty=true;
   draft.fields[0].value=payload.changes[0].value;
   return {ok:true,json:async()=>copy(draft)};
  }
  if(route==='editor/publish'){
   assert.equal(payload.site,site);
   assert.equal(payload.version,draft.version);
   assert.equal(draft.dirty,true,'never publish without a stored draft');
   draft.version=0;
   draft.dirty=false;
   return {ok:true,json:async()=>copy(draft)};
  }
  throw Error('Unexpected endpoint: '+route);
 };
 const doc={body:{dataset:{},classList:{add(){},remove(){},toggle(){}}},getElementById:$,createElement:tag=>mockElement(tag)};
 const context={
  window:{addEventListener:(type,fn)=>{listeners[type]=fn;}},
  document:doc,location:{hash:'',search:'?site='+site,pathname:'/editor',origin:'https://securitywhat.app'},
  history:{replaceState(){}},URLSearchParams,fetch,
  confirm:text=>{confirmations.push(text);return true;},console,
 };
 vm.runInNewContext(editorSource,context,{filename:'public/editor.js'});
 for(let i=0;i<15&&!$('page').src;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match($('page').src||'',new RegExp('site='+site));
 return {
  get:id=>$(id),calls,confirmations,
  select(){
   listeners.message({origin:context.location.origin,source:pageWindow,data:{type:'selection',id:'brand:description'}});
   return $('selection').children.find(x=>x.tagName==='TEXTAREA');
  }
 };
}

test('WhatsApp keeps Publicar accessible and explains that no draft exists yet',async()=>{
 const e=await editor();
 assert.equal(e.get('publish').disabled,false);
 assert.equal(e.get('save').textContent,'Guardar cambios');
 await e.get('publish').onclick();
 assert.match(e.get('status').textContent,/No hay cambios pendientes/);
 assert.equal(e.calls.filter(x=>x.route==='editor/publish').length,0);
});
test('WhatsApp Publicar saves the edited field first, then publishes without a second click',async()=>{
 const e=await editor(),input=e.select();
 assert.equal(e.get('save').disabled,false);
 assert.equal(e.get('publish').disabled,false);
 input.value='Descripción cambiada';
 input.oninput();
 await e.get('publish').onclick();
 assert.deepEqual(e.calls.filter(x=>x.route.startsWith('editor/')&&!x.route.startsWith('editor/data')).map(x=>x.route),['editor/draft','editor/publish']);
 assert.match(e.get('status').textContent,/Publicado/);
 assert.equal(e.get('publish').disabled,false);
});
test('Guardar cambios stores the draft, then Publicar applies it',async()=>{
 const e=await editor(),input=e.select();
 await e.get('save').onclick();
 assert.match(e.get('status').textContent,/ya está guardado/);
 assert.equal(e.calls.filter(x=>x.route==='editor/draft').length,0);
 input.value='Contenido nuevo';input.oninput();
 await e.get('save').onclick();
 assert.equal(e.calls.filter(x=>x.route==='editor/draft').length,1);
 assert.equal(e.get('publish').disabled,false);
 await e.get('publish').onclick();
 assert.equal(e.calls.filter(x=>x.route==='editor/publish').length,1);
});
test('WhatsApp publish explicitly confirms an old draft, updates its base and then publishes',async()=>{
 const e=await editor('wa',{conflict:true,dirty:true});
 assert.equal(e.get('publish').disabled,false);
 await e.get('publish').onclick();
 assert.match(e.confirmations[0],/borrador corresponde a una versión anterior/);
 assert.deepEqual(e.calls.filter(x=>['editor/rebase','editor/draft','editor/publish'].includes(x.route)).map(x=>x.route),['editor/rebase','editor/publish']);
 assert.match(e.get('status').textContent,/Publicado/);
});

test('WhatsApp conflict with uncommitted field first rebases then saves the field and publishes',async()=>{
 const e=await editor('wa',{conflict:true,dirty:true}),input=e.select();
 input.value='Texto actual que debe publicarse';input.oninput();
 await e.get('publish').onclick();
 assert.deepEqual(e.calls.filter(x=>['editor/rebase','editor/draft','editor/publish'].includes(x.route)).map(x=>x.route),['editor/rebase','editor/draft','editor/publish']);
 assert.equal(e.calls.find(x=>x.route==='editor/draft').payload.changes[0].value,'Texto actual que debe publicarse');
 assert.match(e.get('status').textContent,/Publicado/);
});

test('Cubamax conflict continues to block publishing and never uses the WhatsApp rebase',async()=>{
 const e=await editor('cm',{conflict:true,dirty:true});
 assert.equal(e.get('publish').disabled,true);
 await e.get('publish').onclick();
 assert.match(e.get('status').textContent,/conflicto/);
 assert.equal(e.calls.filter(x=>x.route==='editor/rebase'||x.route==='editor/publish').length,0);
});
test('Cubamax editor retains its existing disabled-button and draft-first behavior',async()=>{
 const e=await editor('cm');
 assert.equal(e.get('publish').disabled,true);
 assert.equal(e.get('save').textContent,'Guardar borrador');
 const input=e.select();
 assert.equal(e.get('save').disabled,true);
 input.value='Cambio';input.oninput();
 assert.equal(e.get('save').disabled,false);
 assert.equal(e.get('publish').disabled,true);
 await e.get('save').onclick();
 assert.equal(e.get('publish').disabled,false);
 await e.get('publish').onclick();
 assert.equal(e.calls.filter(x=>x.route==='editor/publish').length,1);
});
