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

test('WhatsApp uses exactly the same popup markup and tutorial file as Cubamax',()=>{
 const whatsapp=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const cubamax=readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8');
 const popup=page=>page.match(/<dialog id="prelink-tutorial"[\s\S]*?<\/dialog>/)?.[0];
 assert.ok(popup(whatsapp),'the WhatsApp page includes the tutorial');
 assert.equal(popup(whatsapp),popup(cubamax),'the existing Cubamax popup is reused verbatim');
 assert.match(whatsapp,/<script src="\/prelink-tutorial\.js" defer><\/script>/);
 assert.match(cubamax,/<script src="\/prelink-tutorial\.js" defer><\/script>/);
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/if\(typeof prelinkTutorial==='function'\)\{if\(!guideData\)guideData=await api\('guides'\);if\(!prelinkTutorial\(input\)\)return;\}/);
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/body:not\(\.corporate-portal\) #prelink-tutorial\{/);
});
test('WhatsApp form without Cubamax service also runs one tutorial then one form resubmit',()=>{
 const s=setup(),whatsappInput={phone:'+12025550123',country:'US',consent:true};
 assert.equal(s.gate(whatsappInput),false);
 assert.equal(s.el('prelink-tutorial').open,true);
 s.el('prelink-iphone').onclick();
 for(let i=0;i<4;i++){s.el('prelink-next').onclick();assert.equal(s.submitted,0);}
 assert.equal(s.el('prelink-next').textContent,'¿ENTENDISTE?');
 s.el('prelink-next').onclick();
 assert.equal(s.submitted,1);
 assert.equal(s.el('prelink-tutorial').open,false);
 assert.equal(s.gate(whatsappInput),true);
 assert.equal(s.gate(whatsappInput),false,'a fresh attempt requires the tutorial again');
});
