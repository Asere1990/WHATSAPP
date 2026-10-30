import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {PanelAccess} from '../src/panel-access.js';
import {WebPanel} from '../src/panel.js';
import {Telegram} from '../src/telegram.js';
import {operatorPopupDefaults,operatorPopupContent,updateOperatorPopup,operatorPopupForReferral} from '../src/operator-referral-popup.js';

const setup=t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'wa-operator-popup-')),store=new Store(dir);
  t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
  const role=id=>id==='10000'?'admin':id==='20000'?'operator':null;
  return {dir,store,role};
};

test('operator referral popup has separate defaults and validates editable title text photo button and color',t=>{
 const {store}=setup(t);
 assert.deepEqual(operatorPopupContent(store),operatorPopupDefaults);
 updateOperatorPopup(store,'title','Información del equipo');
 updateOperatorPopup(store,'text','El acceso es opcional y puede revocarse en WhatsApp.');
 updateOperatorPopup(store,'button','ACEPTAR');
 updateOperatorPopup(store,'color','#2244AA');
 updateOperatorPopup(store,'photo','/portal-media/'+'a'.repeat(64)+'.webp');
 const fresh=operatorPopupContent(store);
 assert.equal(fresh.title,'Información del equipo');
 assert.equal(fresh.text,'El acceso es opcional y puede revocarse en WhatsApp.');
 assert.equal(fresh.button,'ACEPTAR');
 assert.equal(fresh.color,'#2244AA');
 assert.equal(fresh.photo,'/portal-media/'+'a'.repeat(64)+'.webp');
 for(const [field,value] of [['color','red'],['title','x'.repeat(101)],['text',''],['button','x'.repeat(66)],['photo','https://example.com/other.png'],['wrong','some']])
  assert.throws(()=>updateOperatorPopup(store,field,value),undefined,field);
 assert.deepEqual(operatorPopupContent(store),fresh);
 updateOperatorPopup(store,'photo','');
 assert.equal(operatorPopupContent(store).photo,'');
 assert.equal(operatorPopupContent(store).button,'ACEPTAR','removing photo never removes button');
 assert.equal(store.config().wa_associated_generic_popup,undefined,'existing admin generic popup unchanged');
 assert.equal(store.config().wa_welcome_popup,undefined,'existing admin welcome popup unchanged');
});

test('only valid operator referral links on the matching site use the persistent popup on every lookup',t=>{
 const {store,role}=setup(t),access=new PanelAccess(store,role);
 const operator=access.token('20000','referral',{site:'wa'}),operatorCm=access.token('20000','referral',{site:'cm'}),admin=access.token('10000','referral',{site:'wa'});
 const links=[
  access.referral(operator),access.referral(operatorCm),access.referral(admin)
 ];
 assert.ok(operatorPopupForReferral(store,links[0],role(links[0].actor),'wa'));
 assert.ok(operatorPopupForReferral(store,links[0],role(links[0].actor),'wa'),'second visitor sees it too');
 assert.ok(operatorPopupForReferral(store,links[1],role(links[1].actor),'cm'));
 assert.equal(operatorPopupForReferral(store,links[1],role(links[1].actor),'wa'),null);
 assert.equal(operatorPopupForReferral(store,links[2],role(links[2].actor),'wa'),null);
 assert.equal(operatorPopupForReferral(store,null,'operator','wa'),null);
 assert.equal(operatorPopupForReferral(store,links[0],null,'wa'),null);
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM wa_associated_first_browser").get()?.n??0,0,'operator popup must not record first viewer');
});

test('permisos.txt menu contains exactly the two requested buttons; admins menu keeps its existing actions',async t=>{
 const {store,dir}=setup(t),sent=[];
 const telegram={admins:()=>new Set(['10000']),permissions:()=>new Set(['20000']),send:async(...args)=>sent.push(args)};
 const web=new WebPanel(store,{dir,live:new Map()},telegram,{dir,url:'https://securitywhat.app',allowedOrigins:new Set()});
 await web.telegramMenu(20000,20000);
 const operatorButtons=sent.at(-1)[2].inline_keyboard.flat().map(x=>x.text);
 assert.deepEqual(operatorButtons,['🔗 GENERAR ENLACE WEB','🖥 ABRIR PANEL WEB']);
 const bot=new Telegram(store,{admins:'10000',panel:'-100551',dataDir:dir});
 const adminButtons=bot.menu().inline_keyboard.flat().map(x=>x.text);
 assert.ok(adminButtons.includes('🖼 POPUP PERMISOS.TXT'));
 assert.ok(adminButtons.includes('🖼 POPUP GENÉRICO'));
 assert.ok(adminButtons.includes('permisos.txt'));
});

test('only admins can configure the popup through Telegram callbacks and only its own configuration changes',async t=>{
 const {store,dir}=setup(t),messages=[];
 const bot=new Telegram(store,{admins:'10000',panel:'-100551',dataDir:dir});
 bot.api=async(method,body)=>{messages.push({method,body});return {message_id:1};};
 bot.webPanel={access:{remember(){}},telegramAction:async()=>{}};
 const callback=id=>({callback_query:{id:'cb',data:'operator-popup:edit:text',from:{id},
  message:{chat:{id,type:'private'}}}});
 await bot.handle(callback(10000));
 assert.match(messages.at(-1).body.text,/TEXTO del popup/);
 await bot.handle({message:{from:{id:10000},chat:{id:10000,type:'private'},
   text:'Este enlace permite al equipo autorizado gestionar conversaciones.'}});
 assert.equal(operatorPopupContent(store).text,'Este enlace permite al equipo autorizado gestionar conversaciones.');
 const saved=operatorPopupContent(store);
 await bot.handle(callback(20000));
 assert.deepEqual(operatorPopupContent(store),saved,'operator cannot enter editor');
 assert.equal(bot.pending.has('20000:20000'),false,'operator cannot enter editing state');
 assert.equal(store.config().wa_welcome_popup,undefined,'admin welcome popup was not changed');
});
