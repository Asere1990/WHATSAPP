import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/editor-preview.js',import.meta.url),'utf8');
async function setup(site='cm'){
 const handlers={},messages=[],body={classList:{contains:()=>site==='cm'},dataset:{}};
 const fields=[{id:'portal:moneyPopupTitle',kind:'text',value:'Título'},{id:'portal:moneyTitle',kind:'text',value:'Dinero'},{id:'page:notice',kind:'text',source:'Qué acceso autorizas',value:'Permisos actuales'},{id:'portal:moneyPopupDescription',kind:'text',value:'Descripción'},{id:'portal:moneyPopupButton',kind:'text',value:'Continuar'}];
 const document={body,addEventListener:(k,f)=>handlers[k]=f,getElementById:()=>null};
 const window={addEventListener:()=>{}};
 const parent={postMessage:m=>messages.push(m)};
 vm.runInNewContext(script,{document,window,parent,location:{origin:'http://local'},corporateService:'money',scrollY:0,fetch:async()=>({ok:true,json:async()=>({fields})}),setTimeout,clearTimeout});
 await new Promise(resolve=>setImmediate(resolve));
 function el(text,selector='') {const e={childNodes:[{nodeType:3,textContent:text}],parentElement:body,getAttribute:()=>null,setAttribute(){},removeAttribute(){},closest(s){if(s==='*'||s===selector)return e;if(s==='#service-dialog'&&site==='cm')return {};return null;}};return e;}
 function click(target){handlers.click({target,preventDefault(){},stopImmediatePropagation(){}});}
 return {click,el,messages,handlers};
}
test('Cubamax selects popup notice itself only after double tap, including edited text',async()=>{
 const p=await setup(),notice=p.el('Permisos actuales');p.click(notice);assert.equal(p.messages.filter(m=>m.type==='selection').length,0);p.click(notice);assert.equal(p.messages.at(-1).id,'page:notice');
});
test('each service popup element maps to its own field',async()=>{
 for(const [selector,id]of [['#service-dialog-title','portal:moneyPopupTitle'],['#service-dialog-description','portal:moneyPopupDescription'],['#service-continue','portal:moneyPopupButton'],['#selected-service-name','portal:moneyTitle']]){
  const p=await setup(),e=p.el('text',selector);p.click(e);p.click(e);assert.equal(p.messages.at(-1).id,id);
 }
});
test('different text targets and cancelled gestures do not trigger editing',async()=>{
 const p=await setup(),a=p.el('Permisos actuales'),b=p.el('Permisos actuales');p.click(a);p.click(b);assert.equal(p.messages.filter(m=>m.type==='selection').length,0);p.handlers.pointercancel();p.click(b);assert.equal(p.messages.filter(m=>m.type==='selection').length,0);
});
test('WhatsApp editor also requires double-tap text selection',async()=>{
 const p=await setup('wa'),e=p.el('Permisos actuales');p.click(e);assert.equal(p.messages.filter(m=>m.type==='selection').length,0);p.click(e);assert.equal(p.messages.at(-1).id,'page:notice');
});
