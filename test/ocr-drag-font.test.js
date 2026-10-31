import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {VisualEditor} from '../src/visual-editor.js';
import {validatePopupLayers} from '../src/popup-ocr.js';
import {publicSnapshot} from '../src/public-content.js';

const source=readFileSync(new URL('../public/site-initial-popup.js',import.meta.url),'utf8');
const photo='/portal-media/'+'a'.repeat(64)+'.png';
const layer={id:'ocr-0',x:.12,y:.30,w:.25,h:.05,original:'VIEJO TEXTO',
 text:'NUEVO TEXTO MAS LARGO',color:'#ffffff',fontSize:140,weight:'700',family:'Arial',source:photo};

test('validated popup phrases store the original erase box independently of drag position and style',()=>{
 const updated={...layer,drawX:.39,drawY:.48,styled:true};
 assert.deepEqual(validatePopupLayers([updated]),[updated]);
 assert.throws(()=>validatePopupLayers([{...updated,drawX:0.9}]),/ubicación/);
 assert.throws(()=>validatePopupLayers([{...updated,drawY:1.05}]),/ubicación/);
 assert.throws(()=>validatePopupLayers([{...updated,styled:'on'}]),/letra/);
 assert.deepEqual(validatePopupLayers([layer]),[layer],'existing OCR rows remain backward compatible');
});

test('shared OCR painter respects manual pixels and touch-drag positions exactly, never shrinking fonts',()=>{
 const objects=new Map(),timers=new Map(),draws=[],erased=[];
 let id=1;
 const clock={setTimeout(fn){const key=id++;timers.set(key,fn);return key;},clearTimeout(key){timers.delete(key);}};
 const ctx={font:'',drawImage(){},clearRect(){},fillRect(x,y,w,h){erased.push({x,y,w,h});},
  createLinearGradient(){return {addColorStop(){}};},
  getImageData(){return {data:[130,0,0,255]};},
  measureText(v){return{width:String(v).length*35};},
  fillText(v,x,y,maxWidth){draws.push({v,x,y,font:this.font,argc:arguments.length,maxWidth});}};
 class El {
  constructor(tag){
   this.tagName=tag.toUpperCase();this.children=[];this.events={};this.attrs={};this.style={};this.dataset={};
   this.hidden=false;this.open=false;this.complete=true;this.naturalWidth=1370;this.naturalHeight=2048;
   this.classList={toggle(){},add(){},remove(){}};
  }
  get id(){return this._id;}set id(v){this._id=v;objects.set(v,this);}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}
  removeAttribute(k){delete this.attrs[k];}
  append(...a){this.children.push(...a);}replaceChildren(...a){this.children=a;}
  addEventListener(t,f){this.events[t]=f;}
  getContext(){return ctx;}
  showModal(){this.open=true;}close(){this.open=false;}
  getBoundingClientRect(){return{width:320,height:480,left:0,top:0};}
  setPointerCapture(){}releasePointerCapture(){}
  set src(v){this.attrs.src=v;this.onload?.();}get src(){return this.attrs.src;}
 }
 const document={createElement:tag=>new El(tag),getElementById:id=>objects.get(id),body:{append(){}}};
 const context={window:{},document,...clock,Date,Math};
 vm.runInNewContext(source,context);
 const moved=[];
 const dialog=context.window.SiteInitialPopup.show('preview',{enabled:true,photo,layers:[layer]},{
  preview:true,onTextDoubleTap:()=>{},onTextDragEnd:(index,pos)=>moved.push({index,pos})});
 const button=dialog.initialParts.targets.children[0];
 assert.ok(draws.length>0,'styled edited phrase is painted into the photo canvas');
 assert.ok(draws.at(-1).font.includes('140px'),'manual 140px remains 140px even if OCR box is narrow');
 assert.equal(draws.at(-1).argc,3,'fillText never receives maxWidth auto-shrink');
 const originalX=draws.at(-1).x;
 const start={pointerId:7,clientX:100,clientY:140,button:0,preventDefault(){}};
 button.events.pointerdown(start);
 for(const [key,cb]of [...timers]){timers.delete(key);cb();}
 const movedFinger={...start,clientX:180,clientY:188};
 button.events.pointermove(movedFinger);
 button.events.pointerup(movedFinger);
 assert.equal(moved.length,1);
 const newX=moved[0].pos.drawX,newY=moved[0].pos.drawY;
 assert.ok(Math.abs(newX-(.12+.25))<0.0002,'drag x equals 80/320 of the real photo');
 assert.ok(Math.abs(newY-(.30+.1))<0.0002,'drag y equals 48/480 of the real photo');
 assert.ok(Math.abs(draws.at(-1).x-(newX*1370+2))<2);
 assert.ok(draws.at(-1).x>originalX,'phrase visibly moves in the live canvas');
 assert.equal(draws.at(-1).argc,3);
 assert.ok(erased.some(x=>x.x===Math.round(.12*1370)||x.x===Math.floor(.12*1370)),
  'the ORIGINAL OCR rectangle is erased even after text has moved elsewhere');
});

test('WhatsApp admin draft preserves exact normalized draw offsets without publishing automatically',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ocr-offset-')),store=new Store(dir),editor=new VisualEditor(store,dir);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 mkdirSync(path.join(dir,'portal-media'));writeFileSync(path.join(dir,photo.slice(1)),Buffer.from('image placeholder'));
 const start=editor.data('1','wa'),before=publicSnapshot(store,'wa');
 const next=editor.save('1',{site:'wa',version:start.version,revision:start.base,changes:[
  {id:'welcome:photo',value:photo},
  {id:'welcome:layers',value:JSON.stringify([{...layer,drawX:.39,drawY:.48,styled:true}])}
 ]});
 assert.deepEqual(publicSnapshot(store,'wa'),before,'saving draft must never touch the published page');
 editor.publish('1',{site:'wa',version:next.version});
 const published=publicSnapshot(store,'wa').welcomePopup.layers[0];
 assert.equal(published.drawX,.39);assert.equal(published.drawY,.48);
 assert.equal(published.fontSize,140);assert.equal(published.styled,true);
 assert.equal(published.x,.12);assert.equal(published.y,.30,'original erase area stays unchanged');
});
