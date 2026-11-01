import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const redCode=readFileSync(new URL('../public/alert-builder.js',import.meta.url),'utf8');
const sharedCode=readFileSync(new URL('../public/site-initial-popup.js',import.meta.url),'utf8');
const image='/portal-media/'+'a'.repeat(64)+'.png';

async function flush(){for(let i=0;i<50;i++)await new Promise(resolve=>setImmediate(resolve));}

function redPreview(){
 const elements=new Map(),drawn=[],requests=[],timers=new Map();
 let nextTimer=1;
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',textContent:'',disabled:false,hidden:false,style:{},files:[],listeners:{},
   addEventListener(k,cb){this.listeners[k]=cb;},
   getBoundingClientRect(){return {left:10,top:20,width:430,height:643};},
   setPointerCapture(){},releasePointerCapture(){},
   toBlob(cb){cb({size:100,type:'image/png'});}
  });
  return elements.get(id);
 };
 const defaults={address:'1201 Brickell Ave,\nMiami, FL 33131',ip:'186.23.45.178',
  date:'31 oct 2026 · 10:40 a. m.',device:'Windows · Chrome'};
 for(const [k,v]of Object.entries(defaults))el(k).value=v;
 const ctx={
  font:'',setTransform(){},clearRect(){},drawImage(){},fillRect(){},
  createLinearGradient(){return{addColorStop(){}};},
  getImageData(){return{data:[200,11,8,255]};},
  measureText(s){return {width:String(s).length*12};},
  fillText(s,x,y){drawn.push({s,x,y,font:this.font,argc:arguments.length});}
 };
 el('image').getContext=()=>ctx;
 const line={id:'ocr-0',x:.14,y:.27,w:.70,h:.06,original:'Sistema de prueba',
  text:'Sistema de prueba',fontSize:50,color:'#ffffff',weight:'700',family:'Arial'};
 const response=data=>({ok:true,json:async()=>data});
 const fetch=async(route,options)=>{
  requests.push({route,body:options?.body});
  if(route.endsWith('/me'))return response({role:'admin',csrf:'csrf'});
  if(route.includes('/editor/data?'))return response({fields:[{id:'welcome:photo',value:image}],base:'v1',version:0});
  if(route.endsWith('/editor/upload'))return response({asset:image});
  if(route.endsWith('/editor/ocr'))return response({layers:[line]});
  if(route.endsWith('/editor/draft'))return response({ok:true});
  throw Error('Unexpected URL '+route);
 };
 class Image {
  naturalWidth=1370;naturalHeight=2048;
  set src(url){this.url=url;queueMicrotask(()=>this.onload?.());}
 }
 const context={document:{getElementById:el},fetch,Image,
  File:class {constructor(parts,name,options){this.parts=parts;this.name=name;this.type=options.type;}},
  setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},
  clearTimeout:id=>timers.delete(id),confirm:()=>true,console};
 vm.runInNewContext(redCode,context);
 return {el,canvas:el('image'),drawn,requests,
  hold(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
}

test('two fingers on alert phrase enlarge and shrink in original-photo pixels; export keeps the exact font size',async()=>{
 const h=redPreview();await flush();
 const canvas=h.canvas;
 const a=(id,nx,ny)=>({pointerId:id,clientX:10+430*nx,clientY:20+643*ny,preventDefault(){}});
 canvas.listeners.pointerdown(a(1,.3,.3));
 canvas.listeners.pointerdown(a(2,.5,.3));
 canvas.listeners.pointermove(a(2,.7,.3)); // twice initial spacing => double font
 assert.ok(h.drawn.some(row=>row.font.includes('100px')),'two-finger opening must increase the actual canvas font size');
 canvas.listeners.pointerup(a(2,.7,.3));
 canvas.listeners.pointerup(a(1,.3,.3));
 const big=h.drawn.at(-1);
 assert.ok(big.font.includes('100px'));
 await h.el('apply').onclick();
 const afterSave=h.drawn.at(-1);
 assert.equal(afterSave.font,big.font,'the PNG export uses exactly the same font size as the preview');
 assert.equal(afterSave.x,big.x);
 assert.equal(afterSave.y,big.y);
 assert.equal(afterSave.argc,3,'do not use fillText maxWidth to auto-shrink the phrase');
 // Second gesture moves the fingers closer, shrinking the currently selected font.
 canvas.listeners.pointerdown(a(3,.3,.3));
 canvas.listeners.pointerdown(a(4,.5,.3));
 canvas.listeners.pointermove(a(4,.4,.3));
 assert.ok(h.drawn.at(-1).font.includes('50px'),'closing fingers reduces the current 100px font to 50px');
 canvas.listeners.pointerup(a(4,.4,.3));
 canvas.listeners.pointerup(a(3,.3,.3));
});

test('shared image popup lets two fingers resize and move a line; one-finger drag remains functional',()=>{
 const found=new Map(),drawn=[],timers=new Map(),saved=[];
 let clock=1;
 const ctx={
  font:'',clearRect(){},drawImage(){},fillRect(){},
  createLinearGradient(){return{addColorStop(){}};},
  getImageData(){return{data:[180,20,14,255]};},
  measureText(v){return{width:String(v).length*12};},
  fillText(v,x,y){drawn.push({v,x,y,font:this.font,argc:arguments.length});}
 };
 class Node{
  constructor(tag){
   this.tagName=tag.toUpperCase();this.children=[];this.events={};this.style={};this.dataset={};this.attrs={};
   this.hidden=false;this.open=false;this.complete=true;this.naturalWidth=1370;this.naturalHeight=2048;
   this.classList={add(){},remove(){},toggle(){}};
  }
  set id(v){this._id=v;found.set(v,this);}get id(){return this._id;}
  append(...kids){this.children.push(...kids);}replaceChildren(...kids){this.children=kids;}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,cb){this.events[k]=cb;}
  getBoundingClientRect(){return{left:0,top:0,width:320,height:480};}
  getContext(){return ctx;}
  showModal(){this.open=true;}close(){this.open=false;}
  setPointerCapture(){}releasePointerCapture(){}
  set src(v){this.attrs.src=v;this.onload?.();}get src(){return this.attrs.src;}
 }
 const context={window:{},document:{createElement:k=>new Node(k),getElementById:k=>found.get(k),body:{append(){}}},
  setTimeout:fn=>{const id=clock++;timers.set(id,fn);return id;},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(sharedCode,context);
 const phrase={id:'ocr-0',x:.10,y:.25,w:.60,h:.055,original:'Aviso de seguridad',
  text:'Sistema de prueba',fontSize:80,color:'#ffffff',weight:'700',family:'Arial'};
 const dialog=context.window.SiteInitialPopup.show('demo',{enabled:true,photo:image,layers:[phrase]},{
  preview:true,onTextDoubleTap(){},
  onTextDragEnd:(index,pos)=>saved.push({type:'drag',index,...pos}),
  onTextPinchEnd:(index,pos)=>saved.push({type:'pinch',index,...pos})
 });
 const target=dialog.initialParts.targets.children[0];
 const e=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,button:0,preventDefault(){},target});
 target.events.pointerdown(e(1,90,150));
 target.events.pointerdown(e(2,150,150));
 target.events.pointermove(e(2,210,150)); // 2× zoom
 assert.ok(drawn.some(v=>v.font.includes('160px')),'shared popup canvas uses the true scaled font');
 target.events.pointerup(e(2,210,150));
 target.events.pointerup(e(1,90,150));
 assert.equal(saved.length,1);
 assert.equal(saved[0].type,'pinch');
 assert.equal(saved[0].fontSize,160);
 assert.equal(saved[0].styled,true);
 assert.equal(drawn.at(-1).argc,3);
 // Reopen in a new draft with the saved font, then move with a single finger.
 const updated={...phrase,fontSize:saved[0].fontSize,drawX:saved[0].drawX,drawY:saved[0].drawY,styled:true};
 const next=context.window.SiteInitialPopup.show('demo',{enabled:true,photo:image,layers:[updated]},{
  preview:true,onTextDoubleTap(){},onTextPinchEnd(){},
  onTextDragEnd:(index,pos)=>saved.push({type:'drag',index,...pos})
 });
 const button=next.initialParts.targets.children[0];
 button.events.pointerdown(e(3,90,160));
 for(const [id,fn]of [...timers]){timers.delete(id);fn();}
 button.events.pointermove(e(3,110,190));
 button.events.pointerup(e(3,110,190));
 assert.equal(saved.at(-1).type,'drag','one-finger hold/drag remains available');
 assert.equal(updated.fontSize,160,'the underlying saved size is not overwritten by drag');
});

test('numeric font size edit remains available alongside pinch and is stored in original-photo pixels',async()=>{
 const code=readFileSync(new URL('../public/popup-photo-editor.js',import.meta.url),'utf8');
 const elements=new Map();
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.value='';this.textContent='';this.open=false;}
  set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
  append(...children){this.children.push(...children);}
  showModal(){this.open=true;}close(){this.open=false;}focus(){}
 }
 const ctx={window:{},document:{getElementById:id=>elements.get(id),
  createElement:tag=>new Node(tag),body:{append(element){elements.set(element.id,element);}}}};
 vm.runInNewContext(code,ctx);
 const line={original:'Sistema de prueba',text:'Sistema de prueba',
  x:.2,y:.2,w:.5,h:.05,fontSize:50,color:'#ffffff',weight:'700',family:'Arial'};
 let result;
 ctx.window.PopupPhotoEditor.open(line,updated=>{result=updated;});
 const panel=elements.get('popup-photo-text-editor'),actions=panel.children.at(-1);
 elements.get('ocr-edit-size').value='235';
 await actions.children.at(-1).onclick();
 assert.equal(result.fontSize,235);
 assert.equal(result.styled,true);
 assert.equal(result.text,line.text);
 assert.equal(panel.open,false);
});

test('WhatsApp, Cubamax and independent page previews persist pinch fontSize as an editable layer',()=>{
 const wa=readFileSync(new URL('../public/wa-popup-photo-layers.js',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../public/editor-preview.js',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 const studio=readFileSync(new URL('../public/studio.js',import.meta.url),'utf8');
 assert.ok(wa.includes('onTextPinchEnd:inEditor()?onTextPinchEnd:null'));
 assert.ok(preview.includes("type:'popup-ocr-move',site:'wa'"));
 assert.ok(preview.includes("type:'popup-ocr-move',site:'cm'"));
 assert.ok(editor.includes('fontSize:Math.round(size*10)/10,styled:true'));
 assert.ok(studio.includes('onTextPinchEnd:(index,position)=>'));
});
