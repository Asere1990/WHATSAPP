import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {VisualEditor} from '../src/visual-editor.js';
import {welcomeContent,welcomeDefaults} from '../src/welcome-popup.js';
import {publicSnapshot} from '../src/public-content.js';
import {validatePopupLayers} from '../src/popup-ocr.js';

const photo='/portal-media/'+'a'.repeat(64)+'.png';
const otherPhoto='/portal-media/'+'b'.repeat(64)+'.png';
const line={id:'ocr-0',x:0.15,y:0.30,w:0.55,h:0.045,original:'MENSAJE ORIGINAL',
 text:'NUEVA FRASE',color:'#ffffff',fontSize:51,weight:'700',family:'Arial',source:photo};
function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-welcome-ocr-'));
 const store=new Store(dir);
 mkdirSync(path.join(dir,'portal-media'),{recursive:true});
 writeFileSync(path.join(dir,photo.slice(1)),Buffer.from('mock-image'));
 writeFileSync(path.join(dir,otherPhoto.slice(1)),Buffer.from('mock-image'));
 const editor=new VisualEditor(store,dir);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,editor,dir};
}

test('WhatsApp welcome behavior and revision remain exactly the same until OCR is configured',t=>{
 const {store,editor}=setup(t);
 const original=publicSnapshot(store,'wa');
 assert.deepEqual(welcomeContent(store),welcomeDefaults);
 assert.equal(Object.hasOwn(original.welcomePopup,'layers'),false);
 const settings=editor.data('1','wa');
 assert.ok(settings.fields.some(f=>f.id==='welcome:layers'&&f.kind==='layers'));
 assert.equal(publicSnapshot(store,'wa').revision,original.revision);
 const staged=editor.save('1',{site:'wa',revision:settings.base,version:settings.version,
  changes:[{id:'welcome:photo',value:photo},{id:'welcome:layers',value:JSON.stringify([line])}]});
 assert.deepEqual(publicSnapshot(store,'wa'),original,'save only stages a draft');
 const preview=editor.preview('1','wa','unit-test-build');
 assert.ok(preview.includes('/wa-popup-photo-layers.js?v=unit-test-build'));
 assert.ok(preview.includes('id="wa-welcome-button"'));
 editor.publish('1',{site:'wa',version:staged.version});
 const published=publicSnapshot(store,'wa');
 assert.equal(published.welcomePopup.photo,photo);
 assert.deepEqual(published.welcomePopup.layers,[line]);
 assert.notEqual(published.revision,original.revision);
 assert.equal(published.branding.button,original.branding.button);
 assert.equal(published.linkPreview.name,original.linkPreview.name);
 assert.ok(!editor.data('1','cm').fields.some(f=>f.id.startsWith('welcome:')));
});

test('separate WhatsApp alert builder photo changes cannot inherit previous OCR text layers',t=>{
 const {store,editor}=setup(t);
 const original=editor.data('1','wa');
 const staged=editor.save('1',{site:'wa',revision:original.base,version:original.version,
  changes:[{id:'welcome:photo',value:photo},{id:'welcome:layers',value:JSON.stringify([line])}]});
 editor.publish('1',{site:'wa',version:staged.version});
 const old=JSON.parse(store.config().wa_welcome_popup||'{}');
 assert.equal(welcomeContent(store).layers.length,1);
 store.setConfig('wa_welcome_popup',JSON.stringify({...old,photo:otherPhoto}));
 assert.deepEqual(welcomeContent(store).layers,[]);
 assert.equal(welcomeContent(store).photo,otherPhoto);
 assert.deepEqual(validatePopupLayers([line]),[line]);
 assert.throws(()=>validatePopupLayers([{...line,source:'https://external.example/photo.png'}]));
 assert.deepEqual(welcomeContent({config:()=>({})}),welcomeDefaults);
});

test('photo OCR only paints matching global WhatsApp photo, never a personalized link popup',()=>{
 const code=readFileSync(new URL('../public/wa-popup-photo-layers.js',import.meta.url),'utf8');
 const drawings=[];
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.attrs={};this.hidden=false;
   this.complete=true;this.naturalWidth=1370;this.naturalHeight=2048;
   this.parentElement=null;this.nextSibling=null;this.children=[];this.classes=new Set();
   this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),
    toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  insertBefore(v){this.children.push(v);}
  replaceChildren(){this.children=[];}
  set src(v){this.attrs.src=v;}
  get src(){return this.attrs.src;}
 }
 const modal=new Node('dialog'),image=new Node('img'),wrap=new Node('div');
 image.parentElement=wrap;image.src=photo;
 const original={photo,layers:[line]};
 const context={document:{body:{dataset:{visualPreview:'true'}},
  getElementById:id=>({'wa-welcome':modal,'wa-welcome-photo':image})[id],
  createElement:tag=>new Node(tag)},
  currentPublicContent:{welcomePopup:original},
  SiteInitialPopup:{paintInto:(parts,layers,options)=>{drawings.push({layers,options});parts.paint.hidden=false;}}};
 vm.runInNewContext(code,context);
 assert.equal(drawings.length,1);
 assert.equal(drawings[0].layers[0].text,'NUEVA FRASE');
 const callback=()=>{};
 context.WelcomePhotoOCR.enableEditing(callback);
 assert.equal(drawings.at(-1).options.onTextDoubleTap,callback);
 context.WelcomePhotoOCR.render({...original,photo:otherPhoto},false);
 assert.equal(modal.classes.has('has-ocr-paint'),false);
 assert.equal(drawings.length,2);
 context.WelcomePhotoOCR.render({photo:otherPhoto,layers:[line]},true);
 assert.equal(drawings.length,2);
 context.WelcomePhotoOCR.render(original,true);
 assert.equal(drawings.length,3);
});

test('original WhatsApp link and button flows remain available with the new editor',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/welcome-popup.js',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 assert.ok(html.includes('id="wa-welcome-button"'));
 assert.ok(html.includes('src="/wa-popup-photo-layers.js"'));
 assert.ok(script.includes('state.operatorPopup===true'));
 assert.ok(script.includes('globalThis.checkWelcomePopup'));
 assert.ok(script.includes('WelcomePhotoOCR?.render(content,!associated)'));
 assert.ok(editor.includes("id==='welcome:photo'"));
 assert.ok(editor.includes("id:'welcome:layers'"));
 assert.ok(editor.includes('CREAR POPUP ALERTA'));
});
