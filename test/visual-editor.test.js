import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {Store} from '../src/store.js';import {VisualEditor} from '../src/visual-editor.js';import {publicSnapshot} from '../src/public-content.js';
function setup(t){const dir=mkdtempSync(tmpdir()+'/wa-visual-'),store=new Store(dir),editor=new VisualEditor(store,dir);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {store,editor,dir};}
test('drafts persist privately and publish atomically without changing other site settings',t=>{const {store,editor,dir}=setup(t),before=publicSnapshot(store,'cm'),data=editor.data('1','cm');const saved=editor.save('1',{site:'cm',version:data.version,revision:data.base,changes:[{id:'portal:serviceHeading',value:'SERVICIOS DE PRUEBA'},{id:'portal:moneyPopupTitle',value:'Popup de prueba'}]});assert.equal(saved.version,1);assert.equal(publicSnapshot(store,'cm').revision,before.revision);assert.equal(editor.data('2','cm').dirty,false);assert.equal(editor.data('1','wa').dirty,false);const other=new Store(dir);assert.equal(new VisualEditor(other,dir).data('1','cm').dirty,true);other.db.close();const html=editor.preview('1','cm','qa');assert.match(html,/SERVICIOS DE PRUEBA/);assert.doesNotMatch(html,/src="\/app.js/);assert.match(html,/data-visual-preview/);editor.publish('1',{site:'cm',version:1});assert.equal(publicSnapshot(store,'cm').portal.fields.serviceHeading,'SERVICIOS DE PRUEBA');assert.equal(editor.data('1','cm').dirty,false);assert.equal(store.config().panel_archive,undefined);});
test('another administrator or Telegram cannot be overwritten by a stale draft',t=>{const {store,editor}=setup(t),data=editor.data('1','cm');editor.save('1',{site:'cm',revision:data.base,version:0,changes:[{id:'portal:cta',value:'Nuevo botón'}]});assert.throws(()=>editor.save('1',{site:'cm',revision:data.base,version:0,changes:[]}),/pestaña/);store.setConfig('cubamax_content',JSON.stringify({cta:'Cambio desde Telegram'}));assert.equal(editor.data('1','cm').conflict,true);assert.throws(()=>editor.publish('1',{site:'cm',version:1}),/web cambió/);assert.equal(publicSnapshot(store,'cm').portal.fields.cta,'Cambio desde Telegram');editor.discard('1','cm',1);assert.equal(editor.data('1','cm').dirty,false);});
test('editor rejects arbitrary settings, external assets, invalid colors and missing files',t=>{const {editor}=setup(t),d=editor.data('1','cm'),save=(id,value)=>editor.save('1',{site:'cm',version:0,revision:d.base,changes:[{id,value}]});assert.throws(()=>save('TOKEN','x'),/editable/);assert.throws(()=>save('portal:moneyPopupColor','url(javascript:x)'),/color/);assert.throws(()=>save('logo','https://evil.test/x.svg'),/válido/);assert.throws(()=>save('extra:moneyPopupPhoto','/portal-media/'+'a'.repeat(64)+'.jpg'),/disponible/);assert.throws(()=>editor.data('1','unknown'),/Página/);});
test('images, popup layout and guide videos publish through existing content storage',t=>{const {editor,store,dir}=setup(t),name='a'.repeat(64)+'.mp4',guide='/guide-media/'+name;mkdirSync(dir+'/guide-media');writeFileSync(dir+guide,Buffer.from('video fixture'));const d=editor.data('1','cm');editor.save('1',{site:'cm',version:0,revision:d.base,changes:[{id:'guide:iphone:open:asset',value:guide},{id:'layout:money',value:'full'}]});editor.publish('1',{site:'cm',version:1});assert.equal(publicSnapshot(store,'cm').guides.iphone[0].asset,guide);assert.equal(publicSnapshot(store,'cm').portal.popupLayouts.money,'full');});
test('uploads validate actual image bytes, use immutable local paths and reject SVG scripts',async t=>{const {editor}=setup(t),{Readable}=await import('node:stream'),{default:sharp}=await import('sharp');const jpeg=await sharp({create:{width:10,height:10,channels:3,background:'#0a8066'}}).jpeg().toBuffer(),request=Readable.from([jpeg]);request.url='/api/panel/editor/upload';const result=await editor.upload(request);assert.match(result.asset,/^\/portal-media\/[a-f0-9]{64}\.jpg$/);const svg=Readable.from([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]);svg.url='/api/panel/editor/upload';await assert.rejects(editor.upload(svg),/Formato|Envía/);});

test('authorization screen and copied-code popup are editable in both websites',t=>{const {editor}=setup(t);for(const site of ['wa','cm']){const data=editor.data('1',site);for(const text of ['Autoriza en WhatsApp','Copiar código','Código copiado','ENTENDIDO','Número que estás vinculando: {numero}'])assert.ok(data.fields.some(f=>f.source===text),site+': '+text);}});

test('pairing instructions edit as one complete sentence independently on both sites',t=>{
 const {store,editor}=setup(t),original='Introduce este código dentro de WhatsApp para vincular nuestro gestor.',replacement='Escribe este código dentro de WhatsApp y confirma la vinculación.';
 for(const site of ['cm','wa']){
  const data=editor.data('1',site),field=data.fields.find(f=>f.id==='pairing:instructions');
  assert.equal(field.value,original);
  assert.equal(data.fields.filter(f=>['Introduce este código','dentro de WhatsApp','para vincular nuestro gestor.'].includes(f.source)).length,0);
  const prior=publicSnapshot(store,site).revision,other=site==='cm'?'wa':'cm',otherBefore=publicSnapshot(store,other).revision;
  const edited=editor.save('1',{site,version:data.version,revision:data.base,changes:[{id:field.id,value:replacement}]});
  assert.equal(editor.data('1',site).fields.find(f=>f.id===field.id).value,replacement);
  assert.equal(publicSnapshot(store,site).revision,prior);
  const preview=editor.preview('1',site,'unit-test');
  assert.match(preview,/Escribe este código <strong>dentro de WhatsApp<\/strong> y confirma la vinculación\./);
  assert.match(preview,/<p data-whole-pairing-instruction="">/);
  editor.publish('1',{site,version:edited.version});
  assert.equal(publicSnapshot(store,site).pairingInstruction,replacement);
  assert.equal(publicSnapshot(store,other).revision,otherBefore);
  assert.match(editor.preview('1',site,'unit-test'),/Escribe este código <strong>dentro de WhatsApp<\/strong> y confirma la vinculación\./);
 }
});

test('WhatsApp can reconcile an older saved draft without losing it or overwriting unrelated published fields',t=>{
 const {store,editor}=setup(t),otherBefore=publicSnapshot(store,'cm').revision;
 const start=editor.data('1','wa');
 const draft=editor.save('1',{site:'wa',version:start.version,revision:start.base,changes:[{id:'brand:subtitle',value:'Nuevo subtítulo desde borrador'}]});
 assert.equal(draft.dirty,true);
 store.setConfig('wa_brand_badge','hidden');
 const current=publicSnapshot(store,'wa');
 assert.equal(editor.data('1','wa').conflict,true);
 assert.throws(()=>editor.publish('1',{site:'wa',version:draft.version}),/web cambió/);
 const merged=editor.rebase('1',{site:'wa',version:draft.version});
 assert.equal(merged.conflict,false);
 assert.equal(merged.dirty,true,'the saved draft must not disappear');
 assert.equal(merged.version,draft.version+1);
 assert.equal(publicSnapshot(store,'wa').revision,current.revision,'rebasing never publishes by itself');
 assert.equal(editor.draft('1','wa').base,current.revision);
 editor.publish('1',{site:'wa',version:merged.version});
 const published=publicSnapshot(store,'wa');
 assert.equal(published.header.subtitle,'Nuevo subtítulo desde borrador');
 assert.equal(published.header.badge,'hidden');
 assert.equal(editor.data('1','wa').dirty,false);
 assert.equal(publicSnapshot(store,'cm').revision,otherBefore);
});

test('WhatsApp conflict reconciliation respects draft ownership and version, and Cubamax remains protected',t=>{
 const {store,editor}=setup(t),original=editor.data('1','wa');
 const draft=editor.save('1',{site:'wa',version:original.version,revision:original.base,changes:[{id:'brand:subtitle',value:'Texto nuevo aprobado'}]});
 store.setConfig('title','Otro cambio publicado');
 const current=publicSnapshot(store,'wa').revision;
 assert.throws(()=>editor.rebase('1',{site:'wa',version:0}),/cambió/);
 assert.throws(()=>editor.rebase('2',{site:'wa',version:draft.version}),/cambió/);
 assert.throws(()=>editor.rebase('1',{site:'cm',version:draft.version}),/Solo disponible/);
 assert.equal(editor.data('1','wa').conflict,true);
 assert.equal(editor.draft('1','wa').base,original.revision);
 const rebased=editor.rebase('1',{site:'wa',version:draft.version});
 assert.equal(rebased.base,current);
 assert.equal(rebased.fields.find(f=>f.id==='brand:subtitle').value,'Texto nuevo aprobado');
 assert.throws(()=>editor.publish('1',{site:'wa',version:draft.version}),/Recarga el borrador/);
 const again=editor.rebase('1',{site:'wa',version:rebased.version});
 assert.equal(again.version,rebased.version);
 assert.equal(again.dirty,true);
});

test('WhatsApp rebase cannot publish invalid or missing image assets',t=>{
 const {store,editor}=setup(t),data=editor.data('1','wa');
 const draft=editor.save('1',{site:'wa',version:data.version,revision:data.base,changes:[{id:'brand:title',value:'Cambio válido'}]});
 store.db.prepare('UPDATE web_drafts SET changes=? WHERE actor=? AND site=?').run(JSON.stringify({'brand:logo':'/portal-media/'+'f'.repeat(64)+'.jpg'}),'1','wa');
 store.setConfig('description','Cambio externo');
 assert.throws(()=>editor.rebase('1',{site:'wa',version:draft.version}),/no está disponible/);
 assert.equal(editor.data('1','wa').conflict,true);
 assert.equal(publicSnapshot(store,'wa').branding.title,data.fields.find(f=>f.id==='brand:title').value);
});
