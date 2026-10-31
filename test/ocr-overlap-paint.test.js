import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const sourcePhoto='/portal-media/'+'d'.repeat(64)+'.png';
const lines=[
 {id:'ocr-0',x:.12,y:.20,w:.53,h:.05,drawX:.22,drawY:.30,
  original:'LÍNEA ANTERIOR',text:'Sistema de prueba',fontSize:90,weight:'700',
  color:'#ffffff',family:'Arial',styled:true},
 {id:'ocr-1',x:.17,y:.31,w:.62,h:.047,drawX:.17,drawY:.41,
  original:'OTRA LÍNEA',text:'Otra frase nueva',fontSize:52,weight:'700',
  color:'#ffffff',family:'Arial',styled:true}
];
const graphics=()=>{
 const actions=[],gradients=[];let whiteSamples=0;
 const ctx={
  font:'',setTransform(){},clearRect(){},drawImage(){},
  fillRect(x,y,w,h){actions.push({type:'erase',x,y,w,h});},
  fillText(text,x,y){actions.push({type:'text',text,x,y,font:this.font,argumentsCount:arguments.length});},
  measureText(v){return {width:v.length*20};},
  createLinearGradient(){const stops=[];gradients.push(stops);return{addColorStop:(pos,color)=>stops.push(color)};},
  getImageData(x,y){
   // The old single-pixel edge sample could hit a white pixel from an
   // adjacent glyph, turning the restored RED background into a white bar.
   const white=([145,155].includes(Math.round(x))&&Math.round(y)%6<3);
   if(white)whiteSamples++;
   return{data:white?[250,250,250,255]:[222,12,8,255]};
  }
 };
 return {ctx,actions,gradients,get whiteSamples(){return whiteSamples;}};
};
async function flush(){for(let i=0;i<60;i++)await new Promise(resolve=>setImmediate(resolve));}

test('red ALERT preview restores overlapping OCR backgrounds BEFORE drawing moved text',async()=>{
 const graphicsState=graphics(),{ctx,actions,gradients}=graphicsState,elements=new Map();
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,hidden:false,textContent:'',style:{},events:{},files:[],
   addEventListener(k,fn){this.events[k]=fn;},
   getBoundingClientRect(){return{left:10,top:20,width:430,height:643};},
   toBlob(fn){fn({size:100,type:'image/png'});},getContext(){return ctx}
  });return elements.get(id);
 };
 const defaults={address:'1201 Brickell Ave,\nMiami, FL 33131',
  ip:'186.23.45.178',date:'31 oct 2026 · 10:40 a. m.',device:'Windows · Chrome'};
 for(const [key,value] of Object.entries(defaults))el(key).value=value;
 const success=data=>({ok:true,json:async()=>data});
 const fetch=async route=>{
  if(route.endsWith('/me'))return success({role:'admin',csrf:'csrf'});
  if(route.includes('editor/data?'))return success({fields:[{id:'welcome:photo',value:sourcePhoto}]});
  if(route.endsWith('/editor/upload'))return success({asset:sourcePhoto});
  if(route.endsWith('/editor/ocr'))return success({layers:lines});
  throw Error('Unexpected route '+route);
 };
 class Image{
  naturalWidth=1370;naturalHeight=2048;
  set src(v){this.value=v;queueMicrotask(()=>this.onload?.());}
 }
 const src=readFileSync(new URL('../public/alert-builder.js',import.meta.url),'utf8');
 runInNewContext(src,{document:{getElementById:el},Image,fetch,
  File:class{constructor(){this.name='test.png';}},
  setTimeout:()=>1,clearTimeout(){},console});
 await flush();
 const erasures=actions.filter(a=>a.type==='erase'),texts=actions.filter(a=>a.type==='text');
 assert.ok(erasures.length>0&&texts.length===2,'both edited lines render');
 assert.ok(actions.lastIndexOf(erasures.at(-1))<actions.indexOf(texts[0]),
  'every background rectangle must be cleared before any new text is drawn');
 assert.equal(texts[0].text,'Sistema de prueba');
 assert.equal(texts[0].font,'700 90px "Arial"','font size stays unchanged');
 assert.ok(Math.abs(texts[0].x-(.22*1370+2))<2,'dragged position uses original photo coordinates');
 assert.equal(texts[0].argumentsCount,3,'no canvas width parameter that compresses letters');
 assert.ok(gradients.length>0);
 assert.ok(graphicsState.whiteSamples>0,'test includes white pixels in the original image border');
 assert.ok(gradients.flat().every(c=>!c.includes('250,250,250')),
  'bright pixel sampled from another glyph must not leave a white strip');
});

test('shared WhatsApp/Cubamax initial popup painting never erases a prior replacement',()=>{
 const graphicsState=graphics(),{ctx,actions,gradients}=graphicsState,registry=new Map();
 class El{
  constructor(tag){
   this.tagName=tag.toUpperCase();this.children=[];this.events={};this.style={};this.dataset={};this.attrs={};
   this.hidden=false;this.complete=true;this.naturalWidth=1370;this.naturalHeight=2048;this.open=false;
   this.classList={toggle(){},add(){},remove(){}};
  }
  set id(v){this._id=v;registry.set(v,this);}get id(){return this._id;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){this.events[k]=fn;}
  getContext(){return ctx;}
  getBoundingClientRect(){return{width:320,height:480,left:0,top:0};}
  set src(v){this.attrs.src=v;this.onload?.();}
  get src(){return this.attrs.src;}
  showModal(){this.open=true;}close(){this.open=false;}
 }
 const context={window:{},document:{createElement:k=>new El(k),
  getElementById:k=>registry.get(k),body:{append(){}}}};
 const src=readFileSync(new URL('../public/site-initial-popup.js',import.meta.url),'utf8');
 runInNewContext(src,context);
 const popup=context.window.SiteInitialPopup.show('sample',{enabled:true,photo:sourcePhoto,layers:lines},{preview:true});
 assert.equal(popup.open,true);
 const erasures=actions.filter(a=>a.type==='erase'),texts=actions.filter(a=>a.type==='text');
 assert.ok(erasures.length>0&&texts.length===2);
 assert.ok(actions.lastIndexOf(erasures.at(-1))<actions.indexOf(texts[0]));
 assert.equal(texts[0].text,'Sistema de prueba');
 assert.equal(texts[0].font,'700 90px "Arial"');
 assert.ok(Math.abs(texts[0].x-(.22*1370+2))<2);
 assert.equal(popup.initialParts.photo.src,sourcePhoto,'the original photo is not rewritten');
 assert.ok(gradients.flat().every(s=>!s.includes('250,250,250')),
  'light-colored original glyph pixels are discarded from the background repair');
});
