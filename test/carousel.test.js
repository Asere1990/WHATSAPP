import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
async function carouselPage(){
 const elements=new Map(),timers=new Map();let seq=0;
 function element(id){if(elements.has(id))return elements.get(id);const classes=new Set(),events={};const el={events,children:[],dataset:{},attributes:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,on){on?classes.add(x):classes.delete(x);},contains:x=>classes.has(x)},set className(value){classes.clear();for(const c of value.split(' '))classes.add(c);},setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn){events[type]=fn;},append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},setPointerCapture(){},releasePointerCapture(){}};elements.set(id,el);return el;}
 const document={hidden:false,getElementById:element,querySelector:selector=>selector==='.hero-carousel'?element('carousel'):null,querySelectorAll:()=>[],createElement:type=>element(type+ ++seq),addEventListener(){}};
 const slides=['money','combo','packages','topup'].map(id=>({id,title:id,asset:`/cubamax-slides/${id}.svg`}));
 const context=vm.createContext({document,fetch:async()=>({ok:true,json:async()=>({fields:{},slides})}),setInterval(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id),matchMedia:()=>({matches:false})});
 vm.runInContext(readFileSync(new URL('../public/cubamax.js',import.meta.url),'utf8'),context);await new Promise(r=>setImmediate(r));return {context,timers,element,index:()=>vm.runInContext('carouselIndex',context)};
}
test('full image carousel advances automatically, swipes both ways, ignores vertical scroll and resumes its timer',async()=>{
 const p=await carouselPage();assert.equal(p.index(),0);assert.equal(p.timers.size,1);assert.equal([...p.timers.values()][0].ms,5000);
 [...p.timers.values()][0].fn();assert.equal(p.index(),1);
 const events=p.element('carousel').events,start=(x,y=100)=>events.pointerdown({pointerId:1,clientX:x,clientY:y,pointerType:'touch',isPrimary:true}),end=(x,y=100)=>events.pointerup({pointerId:1,clientX:x,clientY:y});
 start(200);assert.equal(p.timers.size,0);end(80);assert.equal(p.index(),2);assert.equal(p.element('cubamax-slides').classList.contains('is-reverse'),false);assert.equal(p.timers.size,1);
 start(80);end(200);assert.equal(p.index(),1);assert.equal(p.element('cubamax-slides').classList.contains('is-reverse'),true);
 start(100,100);end(150,280);assert.equal(p.index(),1);assert.equal(p.timers.size,1);
 start(200);events.pointercancel();assert.equal(p.timers.size,1);
 [...p.timers.values()][0].fn();assert.equal(p.index(),2);assert.equal(p.element('cubamax-slides').classList.contains('is-reverse'),false);
 assert.equal(p.element('cubamax-slides').children.length,4);assert.ok(p.element('cubamax-slides').children.every(slide=>slide.children.length===1&&slide.children[0].draggable===false));
 const html=readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8');assert.doesNotMatch(html,/carousel-controls|carousel-pause|carousel-dots/);
});
