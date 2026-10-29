import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {VisualEditor} from '../src/visual-editor.js';
import {publicSnapshot} from '../src/public-content.js';

function setup(t){
  const dir=mkdtempSync(path.join(tmpdir(),'wa-layout-')),store=new Store(dir),editor=new VisualEditor(store,dir);
  t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,store,editor};
}
test('both sites independently edit visible page name as text without changing their original design before publication',t=>{
  const {store,editor}=setup(t);
  for(const [site,name,token] of [['wa','Atención Segura','brand-title'],['cm','Caribe Seguro','page-name-text']]){
    const other=site==='wa'?'cm':'wa',otherBefore=publicSnapshot(store,other).revision,initial=publicSnapshot(store,site).revision;
    const d=editor.data('admin',site),fields=d.fields.map(f=>f.id);
    assert.ok(['identity:mode','identity:text','identity:photo'].every(id=>fields.includes(id)));
    const staged=editor.save('admin',{site,version:d.version,revision:d.base,changes:[{id:'identity:text',value:name},{id:'identity:mode',value:'text'}]});
    assert.equal(publicSnapshot(store,site).revision,initial);
    const html=editor.preview('admin',site,'preview');
    assert.match(html,new RegExp(name));
    assert.match(html,new RegExp(token));
    assert.match(html,/element-layout\.js\?v=preview/);
    assert.match(html,/name-layout\.css\?v=preview/);
    editor.publish('admin',{site,version:staged.version});
    assert.equal(publicSnapshot(store,site).identity.text,name);
    assert.equal(publicSnapshot(store,site).identity.mode,'text');
    assert.equal(publicSnapshot(store,other).revision,otherBefore);
  }
});
test('page name can be an uploaded picture and movement is saved as a draft independently',t=>{
  const {store,editor,dir}=setup(t);
  const filename='a'.repeat(64)+'.webp',photo='/portal-media/'+filename;
  mkdirSync(path.join(dir,'portal-media'));writeFileSync(path.join(dir,'portal-media',filename),Buffer.from('photo fixture'));
  const d=editor.data('admin','wa');
  const movement=JSON.stringify({x:8.5,y:-2.5,scale:1.35});
  const staged=editor.save('admin',{site:'wa',version:d.version,revision:d.base,changes:[
    {id:'identity:photo',value:photo},{id:'identity:mode',value:'photo'},
    {id:'placement:id:copy',value:movement},{id:'placement:child:guide:1.0',value:JSON.stringify({x:0,y:4,scale:.8})}
  ]});
  assert.ok(!publicSnapshot(store,'wa').layout['id:copy']);
  const preview=editor.preview('admin','wa','photo');
  assert.match(preview,/page-name-photo/);
  assert.match(preview,new RegExp(filename));
  assert.match(preview,/"id:copy":\{"x":8\.5,"y":-2\.5,"scale":1\.35\}/);
  editor.publish('admin',{site:'wa',version:staged.version});
  assert.equal(publicSnapshot(store,'wa').identity.photo,photo);
  assert.equal(publicSnapshot(store,'wa').layout['id:copy'].scale,1.35);
  assert.equal(publicSnapshot(store,'wa').layout['child:guide:1.0'].scale,.8);
  assert.equal(Object.keys(publicSnapshot(store,'cm').layout).length,0);
});
test('unsafe or unreasonable position and branding changes are rejected',t=>{
  const {editor}=setup(t),d=editor.data('admin','wa');
  const attempt=(id,value)=>editor.save('admin',{site:'wa',revision:d.base,version:d.version,changes:[{id,value}]});
  assert.throws(()=>attempt('identity:mode','javascript'),/Presentación/);
  assert.throws(()=>attempt('identity:photo','https://attacker.test/logo.png'),/válido/);
  assert.throws(()=>attempt('placement:__proto__',JSON.stringify({x:1,y:2,scale:1})),/editable/);
  assert.throws(()=>attempt('placement:id:logo',JSON.stringify({x:1,y:2,scale:200})),/límites/);
  assert.throws(()=>attempt('placement:id:logo',JSON.stringify({x:1,y:2,scale:1,inject:'yes'})),/límites/);
});
test('generic layout layer resolves anchored elements and preserves existing transforms',()=>{
  const source=readFileSync(new URL('../public/element-layout.js',import.meta.url),'utf8');
  const body={id:'',children:[]},anchor={id:'header',children:[],style:{},parentElement:body},child={id:'',children:[],style:{},parentElement:anchor,getAttribute:()=>null};
  body.children=[anchor];anchor.children=[child];
  const document={body,documentElement:{},getElementById:id=>id==='header'?anchor:null,querySelectorAll:()=>[]};
  const window={currentPublicContent:{layout:{'child:header:0':{x:6,y:3,scale:1.25}}},addEventListener(){}};
  const MutationObserver=class{observe(){}};
  vm.runInNewContext(source,{document,window,MutationObserver});
  const api=window.pageElementLayout,key=api.keyFor(child);
  assert.equal(key,'child:header:0');
  assert.equal(api.resolve(key),child);
  assert.equal(child.style.translate,'6vw 3vw');
  assert.equal(child.style.scale,'1.25');
  api.set(key,{x:0,y:0,scale:1});
  assert.equal(child.style.translate,'');
  assert.equal(child.style.scale,'');
});

test('WhatsApp header items remain four independently editable and positionable elements',t=>{
  const {store,editor}=setup(t),base=editor.data('admin','wa'),fields=new Map(base.fields.map(f=>[f.id,f]));
  assert.equal(fields.get('brand:logo').group,'identity');
  assert.equal(fields.get('identity:text').group,'identity');
  assert.equal(fields.get('brand:subtitle').group,'identity');
  assert.equal(fields.get('brand:verified').group,'identity');
  const original=editor.preview('admin','wa','header');
  for(const id of ['wa-brand-logo','wa-brand-name','wa-brand-description','wa-verified-badge'])assert.match(original,new RegExp('id="'+id+'"'));
  assert.match(original,/<span id="wa-brand-name">WhatsApp<\/span>/);
  assert.match(original,/<svg id="wa-verified-badge" class="verified-badge"/);
  const cmBefore=publicSnapshot(store,'cm').revision,waBefore=publicSnapshot(store,'wa').revision;
  const changed=editor.save('admin',{site:'wa',version:base.version,revision:base.base,changes:[
    {id:'identity:text',value:'Mi marca'},
    {id:'identity:mode',value:'text'},
    {id:'brand:subtitle',value:'Una descripción independiente'},
    {id:'brand:verified',value:'hidden'},
    {id:'placement:id:wa-brand-logo',value:JSON.stringify({x:0,y:0,scale:.8})},
    {id:'placement:id:wa-brand-name',value:JSON.stringify({x:5,y:0,scale:1.2})},
    {id:'placement:id:wa-brand-description',value:JSON.stringify({x:0,y:3,scale:1})},
    {id:'placement:id:wa-verified-badge',value:JSON.stringify({x:-2,y:0,scale:1.5})}
  ]});
  assert.equal(publicSnapshot(store,'wa').revision,waBefore);
  const preview=editor.preview('admin','wa','header');
  assert.match(preview,/<span id="wa-brand-name">Mi marca<\/span>/);
  assert.match(preview,/<span id="wa-brand-description" class="brand-sub">Una descripción independiente<\/span>/);
  assert.match(preview,/<svg id="wa-verified-badge" class="verified-badge" hidden/);
  assert.match(preview,/"id:wa-brand-name":\{"x":5,"y":0,"scale":1.2\}/);
  assert.match(preview,/"id:wa-verified-badge":\{"x":-2,"y":0,"scale":1.5\}/);
  editor.publish('admin',{site:'wa',version:changed.version});
  const snapshot=publicSnapshot(store,'wa');
  assert.equal(snapshot.header.badge,'hidden');
  assert.equal(snapshot.header.subtitle,'Una descripción independiente');
  assert.equal(snapshot.layout['id:wa-brand-logo'].scale,.8);
  assert.equal(snapshot.layout['id:wa-brand-name'].scale,1.2);
  assert.equal(snapshot.layout['id:wa-brand-description'].y,3);
  assert.equal(snapshot.layout['id:wa-verified-badge'].scale,1.5);
  assert.equal(publicSnapshot(store,'cm').revision,cmBefore);
});
test('WhatsApp header rejects invalid icon settings',t=>{
  const {editor}=setup(t),d=editor.data('admin','wa');
  assert.throws(()=>editor.save('admin',{site:'wa',version:d.version,revision:d.base,changes:[{id:'brand:verified',value:'anything'}]}),/Visibilidad/);
});
