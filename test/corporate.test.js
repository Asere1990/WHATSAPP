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
