import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('corporate services show permission popup and success appears only after confirmed pairing',()=>{
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',events:{},showModal(){this.open=true;},close(){this.open=false;},addEventListener(type,fn){this.events[type]=fn;},click(){this.clicks=(this.clicks||0)+1;},scrollIntoView(){this.scrolled=true;}});return elements.get(id);};
 const cards=['money','combo','packages','topup'].map(service=>({dataset:{service},addEventListener(type,fn){this.click=fn;}}));
 const context=vm.createContext({document:{getElementById:get,querySelectorAll:()=>cards}});
 vm.runInContext(readFileSync(new URL('../public/cubamax.js',import.meta.url),'utf8'),context);
 const names=['Recibir dinero','Recibir combo','Recibir paquetes','Recarga móvil'];
 for(const [i,card] of cards.entries()){card.click();assert.equal(get('service-dialog').open,true);assert.equal(get('selected-service-name').textContent,names[i]);assert.match(get('service-dialog-title').textContent,/Acceso de trabajo para/);assert.ok(get('service-dialog-description').textContent.includes(['dinero','combos','paquetes','recargas'][i]));get('service-close').onclick();assert.equal(get('service-dialog').open,false);}
 cards[2].click();assert.equal(vm.runInContext('corporateSelection()',context),'packages');
 get('service-continue').onclick();assert.equal(get('access-panel').hidden,false);assert.equal(get('begin').clicks,1);assert.equal(get('service-dialog').open,false);
 vm.runInContext("corporateConnected('+12025550123',false)",context);assert.notEqual(get('corporate-success').open,true);
 vm.runInContext("corporateConnected('+12025550123',true)",context);assert.equal(get('corporate-success').open,true);
 get('corporate-success-close').onclick();vm.runInContext("corporateConnected('+12025550123',true)",context);assert.equal(get('corporate-success').open,false);
});

test('saved popup content renders as literal text and updates an already open service',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(){},showModal(){this.open=true;},close(){}});return elements.get(id);};
 const cards=['money','combo','packages','topup'].map(service=>({dataset:{service},addEventListener(type,fn){this.click=fn;}}));
 let release;const response=new Promise(resolve=>release=resolve);
 const context=vm.createContext({document:{getElementById:get,querySelectorAll:selector=>selector==='[data-service]'?cards:[]},fetch:()=>response});
 vm.runInContext(readFileSync(new URL('../public/cubamax.js',import.meta.url),'utf8'),context);
 cards[0].click();release({ok:true,json:async()=>({fields:{moneyPopupTitle:'<b>Dinero</b>',moneyPopupDescription:'Solo dinero',comboPopupTitle:'Combos separados'}})});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('service-dialog-title').textContent,'<b>Dinero</b>');assert.equal(get('service-dialog-description').textContent,'Solo dinero');cards[1].click();assert.equal(get('service-dialog-title').textContent,'Combos separados');assert.notEqual(get('service-dialog-description').textContent,'Solo dinero');
});
test('service card photo covers only its selected button and preserves service popup handling',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(){},showModal(){this.open=true;},close(){}});return elements.get(id);};
 const cards=['money','combo','packages','topup'].map(service=>({dataset:{service},children:[],classList:{values:[],add(v){this.values.push(v);}},prepend(image){this.children.unshift(image);},addEventListener(type,fn){this.click=fn;}}));
 const asset='/portal-media/'+'a'.repeat(64)+'.jpg';
 const context=vm.createContext({document:{getElementById:get,querySelectorAll:selector=>selector==='[data-service]'?cards:[],querySelector:selector=>cards.find(c=>selector==='[data-service="'+c.dataset.service+'"]'),createElement:()=>({})},fetch:async()=>({ok:true,json:async()=>({fields:{},cards:{money:asset,combo:'https://evil.test/image.jpg'}})})});
 vm.runInContext(readFileSync(new URL('../public/cubamax.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards[0].children[0].src,asset);assert.deepEqual(cards[0].classList.values,['has-image']);assert.equal(cards[1].children.length,0);assert.equal(cards[2].children.length,0);
 cards[0].click();assert.equal(get('service-dialog').open,true);assert.equal(get('selected-service-name').textContent,'Recibir dinero');
});
