import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/alert-builder.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/alert-builder.html',import.meta.url),'utf8');
const style=readFileSync(new URL('../public/alert-builder.css',import.meta.url),'utf8');
const makePhoto=()=>'/portal-media/'+'f'.repeat(64)+'.png';

function harness({failOCR=false}={}){
 const elements=new Map(),pending=[],calls=[],painted=[],seen=[],url=makePhoto();
 const element=(id)=>{if(!elements.has(id))elements.set(id,{
  value:'',textContent:'',disabled:false,hidden:false,style:{},files:[],
  listeners:{},addEventListener(name,callback){this.listeners[name]=callback;},
  getBoundingClientRect(){return {left:10,top:20,width:430,height:643};},
  toBlob(callback){callback({size:500,type:'image/png'});}
 });return elements.get(id);};
 for(const [id,v] of Object.entries({address:'1201 Brickell Ave,\nMiami, FL 33131',ip:'186.23.45.178',date:'31 oct 2026 · 10:40 a. m.',device:'Windows · Chrome'}))element(id).value=v;
 const context2d={
  setTransform(){},clearRect(){},drawImage(){},fillRect(){},
  createLinearGradient(){return{addColorStop(){}};},
  getImageData(){return{data:[220,12,8,255]};},
  measureText(v){return{width:String(v).length*15};},
  fillText(v){painted.push(v);}
 };
 const canvas=element('image');
 canvas.getContext=()=>context2d;
 const layer={id:'ocr-0',x:.14,y:.27,w:.69,h:.06,original:'Intento de inicio de sesión detectado',
  text:'Intento de inicio de sesión detectado',color:'#ffffff',fontSize:48,weight:'700',family:'Arial'};
 const response=data=>({ok:true,json:async()=>data});
 const fetch=async (route,options={})=>{
  calls.push({route,body:options.body});
  if(route.endsWith('/me'))return response({role:'admin',csrf:'valid'});
  if(route.includes('editor/data?'))return response({fields:[{id:'welcome:photo',value:url}],base:'rev',version:4});
  if(route.endsWith('/editor/upload'))return response({asset:url});
  if(route.endsWith('/editor/ocr'))return failOCR?responseError():response({asset:url,layers:[layer]});
  if(route.endsWith('/editor/draft'))return response({ok:true});
  throw Error('Unexpected request '+route);
 };
 const responseError=()=>({ok:false,json:async()=>({error:'OCR no disponible'})});
 const Image=class{
  naturalWidth=1370;naturalHeight=2048;
  set src(v){this._src=v;queueMicrotask(()=>this.onload?.());}
  get src(){return this._src;}
 };
 const context={document:{getElementById:element},fetch,Image,
  File:class {constructor(parts,name,options){this.parts=parts;this.name=name;this.type=options.type;}},
  PopupPhotoEditor:{open:(item,onSave)=>{seen.push(item);onSave({...item,text:'Nueva frase editable'});}},
  confirm:()=>true,console};
 vm.runInNewContext(source,context,{filename:'public/alert-builder.js'});
 return {element,canvas,layer,calls,seen,painted};
}
async function complete(){
 for(let i=0;i<80;i++)await new Promise(resolve=>setImmediate(resolve));
}
test('the existing red-alert preview has double-tap controls and keeps its exact canvas size',()=>{
 assert.ok(html.includes('id="image" width="1370" height="2048"'));
 assert.ok(html.includes('id="recognize-photo"'));
 assert.ok(html.includes('src="/popup-photo-editor.js"'));
 assert.ok(html.includes('id="address"'));
 assert.ok(html.includes('id="ip"'));
 assert.ok(html.includes('id="date"'));
 assert.ok(html.includes('id="device"'));
 assert.ok(style.includes('touch-action:manipulation'));
 const original=readFileSync(new URL('../public/alert-builder.js',import.meta.url),'utf8');
 assert.ok(original.includes("api('editor/ocr'"));
 assert.ok(original.includes("canvas.addEventListener('pointerup'"));
 const visual=readFileSync(new URL('../public/editor-preview.js',import.meta.url),'utf8');
 assert.ok(visual.includes("type:'popup-ocr-edit',site:'wa'"),'the original editor preview keeps its independent double-tap workflow');
});
test('the red-alert canvas recognizes text automatically and double tap edits exactly that phrase',async()=>{
 const h=harness();await complete();
 assert.equal(h.element('locked').hidden,true);
 assert.equal(h.element('tool').hidden,false);
 assert.ok(h.calls.some(c=>c.route.endsWith('/editor/ocr')),'OCR ran on the preview image');
 const x=10+430*.4,y=20+643*.3,point={pointerId:11,clientX:x,clientY:y,preventDefault(){}};
 const first=()=>{h.canvas.listeners.pointerdown(point);h.canvas.listeners.pointerup(point);};
 first();first();
 assert.equal(h.seen.length,1);
 assert.equal(h.seen[0].original,'Intento de inicio de sesión detectado');
 assert.ok(h.painted.includes('Nueva frase editable'),'the preview redraws a derived image with the new phrase');
 assert.equal(h.element('address').value,'1201 Brickell Ave,\nMiami, FL 33131');
 assert.equal(h.element('ip').value,'186.23.45.178');
});
test('the result is saved as one derived popup photo, with no duplicated legacy OCR overlays',async()=>{
 const h=harness();await complete();
 const x=10+430*.4,y=20+643*.3,point={pointerId:12,clientX:x,clientY:y,preventDefault(){}};
 for(let i=0;i<2;i++){h.canvas.listeners.pointerdown(point);h.canvas.listeners.pointerup(point);}
 await h.element('apply').onclick();await complete();
 const saved=h.calls.find(c=>c.route.endsWith('/editor/draft'));
 assert.ok(saved,'the existing draft button still saves via the editor');
 const payload=JSON.parse(saved.body);
 assert.equal(payload.site,'wa');assert.equal(payload.version,4);
 assert.deepEqual(JSON.parse(JSON.stringify(payload.changes)),[
  {id:'welcome:photo',value:makePhoto()},{id:'welcome:layers',value:'[]'}
 ]);
 assert.equal(h.element('apply').disabled,false);
});
test('failed text recognition never disables the original fields or the image export',async()=>{
 const h=harness({failOCR:true});await complete();
 assert.equal(h.element('download').disabled,false);
 assert.equal(h.element('apply').disabled,false);
 assert.ok(h.element('status').textContent.includes('OCR')||h.element('status').textContent.includes('reconocimiento'));
 assert.equal(h.element('ip').value,'186.23.45.178');
});
