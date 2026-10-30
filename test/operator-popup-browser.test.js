import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const client=readFileSync(new URL('../public/welcome-popup.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const cubamax=readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8');

async function runPopup(state,site){
 const fields={},requests=[];let shown=0;
 const dialog={
   open:false,
   classList:{toggle(){}},
   showModal(){this.open=true;shown++;},
   close(){this.open=false;},
   addEventListener(){}
 };
 const photo={hidden:true,src:'',removeAttribute(){}};
 const button={addEventListener(){}};
 const doc={
   body:{dataset:site==='cm'?{operatorPopupSite:'cm'}:{}},
   styleSheets:[],
   getElementById:id=>{
     if(id==='wa-welcome')return dialog;
     if(id==='wa-welcome-photo')return photo;
     if(id==='wa-welcome-button')return Object.assign(button,{set textContent(v){fields.button=v;}});
     return {set textContent(v){fields[id]=v}};
   }
 };
 const context={document:doc,fetch:async url=>{
   requests.push(url);
   return {ok:true,json:async()=>state};
 }};
 context.addEventListener=()=>{};
 runInNewContext(client,context);
 if(site!=='cm')await context.checkWelcomePopup();
 await new Promise(resolve=>setImmediate(resolve));
 return {shown,fields,requests,photo,dialog};
}

test('full-size operator popup appears on every operator visit including when already linked',async()=>{
 const popup={title:'Información',text:'Acceso opcional',button:'ENTENDIDO',color:'#128c7e',photo:'/portal-media/'+'a'.repeat(64)+'.webp'};
 const state={linked:true,popup,operatorPopup:true};
 const a=await runPopup(state,'wa'),b=await runPopup(state,'wa'),c=await runPopup(state,'cm');
 for(const result of [a,b,c]){
   assert.equal(result.shown,1);
   assert.equal(result.fields['wa-welcome-title'],'Información');
   assert.equal(result.fields['wa-welcome-text'],'Acceso opcional');
   assert.equal(result.fields.button,'ENTENDIDO');
   assert.equal(result.photo.hidden,false);
   assert.equal(result.photo.src,popup.photo);
 }
 assert.deepEqual(a.requests,['/api/welcome-popup-state?site=wa']);
 assert.deepEqual(c.requests,['/api/welcome-popup-state?site=cm']);
});

test('regular admin visits stay unchanged and existing associated popup retains its first-visitor response',async()=>{
 const normal=await runPopup({linked:false,popup:null,operatorPopup:false},'wa');
 assert.equal(normal.shown,0);
 const linked=await runPopup({linked:true,popup:{kind:'text',text:'Personal'},operatorPopup:false},'wa');
 assert.equal(linked.shown,0);
 const associated=await runPopup({linked:false,popup:{kind:'text',text:'Personal'},operatorPopup:false},'wa');
 assert.equal(associated.shown,1);
 assert.equal(associated.fields['wa-welcome-text'],'Personal');
});

test('operator-only Cubamax popup injection reuses WhatsApp full-cover dialog and is not built into the base Cubamax page',()=>{
 const markup=index.match(/<dialog id="wa-welcome"[\s\S]*?<\/dialog>/)?.[0];
 assert.ok(markup?.includes('id="wa-welcome-photo"'));
 assert.ok(markup?.includes('id="wa-welcome-button"'));
 assert.equal(cubamax.includes('id="wa-welcome"'),false);
 const rendered=cubamax.replace('</head>','<link rel="stylesheet" href="/welcome-popup.css"><script defer src="/welcome-popup.js"></script></head>')
  .replace(/<body\b/,'<body data-operator-popup-site="cm"')
  .replace('</body>',markup+'</body>');
 assert.ok(rendered.includes('data-operator-popup-site="cm"'));
 assert.ok(rendered.includes('id="wa-welcome-button"'));
 assert.ok(rendered.includes('welcome-popup.css'));
});
