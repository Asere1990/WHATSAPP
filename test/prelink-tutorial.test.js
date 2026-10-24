import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/prelink-tutorial.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map();let submitted=0;
 function el(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;},pause(){},showModal(){this.open=true;},close(){this.open=false;},requestSubmit(){submitted++;}});return nodes.get(id);}
 const guideData=Object.fromEntries(['android','iphone'].map(device=>[device,Array.from({length:5},(_,i)=>({title:device+' '+i,text:'Step '+i,asset:`/guides/${device}-2026/step-${i+1}.gif`}))]));
 const context=vm.createContext({document:{getElementById:el},guideData});vm.runInContext(source,context);
 return {el,gate:input=>{context.input=input;return vm.runInContext('prelinkTutorial(input)',context);},get submitted(){return submitted;}};
}
const input={phone:'+17868876115',country:'US',service:'money',consent:true};
test('tutorial requires device and all steps before releasing exactly one code request',()=>{
 const s=setup();assert.equal(s.gate(input),false);assert.equal(s.el('prelink-tutorial').open,true);
 s.el('prelink-next').onclick();assert.equal(s.submitted,0);
 s.el('prelink-iphone').onclick();assert.equal(s.el('prelink-title').textContent,'iphone 0');
 for(let i=0;i<4;i++){assert.equal(s.el('prelink-next').textContent,'SIGUIENTE →');s.el('prelink-next').onclick();assert.equal(s.submitted,0);}
 assert.equal(s.el('prelink-next').textContent,'¿ENTENDISTE?');s.el('prelink-next').onclick();
 assert.equal(s.submitted,1);assert.equal(s.el('prelink-tutorial').open,false);assert.equal(s.gate(input),true);assert.equal(s.gate(input),false);
});
test('cancel or close never authorizes a request, device switches restart the tutorial',()=>{
 const s=setup();s.gate(input);s.el('prelink-android').onclick();s.el('prelink-next').onclick();s.el('prelink-back').onclick();assert.equal(s.el('prelink-title').textContent,'android 0');
 s.el('prelink-next').onclick();s.el('prelink-iphone').onclick();assert.equal(s.el('prelink-title').textContent,'iphone 0');
 s.el('prelink-tutorial').events.cancel();assert.equal(s.submitted,0);assert.equal(s.gate(input),false);
 s.el('prelink-close').onclick();assert.equal(s.submitted,0);assert.equal(s.el('prelink-tutorial').open,false);
});
test('acknowledgment for one number cannot authorize another number',()=>{
 const s=setup();s.gate(input);s.el('prelink-android').onclick();for(let i=0;i<5;i++)s.el('prelink-next').onclick();
 assert.equal(s.gate({...input,phone:'+13055550123'}),false);
});
