import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {Store} from '../src/store.js';
import {PublicWhatsAppLinks} from '../src/public-wa-links.js';
import {PublicCubamaxLinks} from '../src/public-cubamax-links.js';
import {createAdminMiniAppBridge} from '../src/miniapp-admin-bridge.js';
import {userMiniappOverrides} from '../src/miniapp-user-editor.js';

const token='888888:ADMIN_MINIAPP_TEST',origin='https://whatsapp-cubamax-miniapp.onrender.com';
function sign(actor,secret=token){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:actor})});
 const parts=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();
 p.set('hash',createHmac('sha256',key).update(parts).digest('hex'));
 return p.toString();
}
async function request(handler,initData,action='home',value='',key='',from=origin){
 const payload=Buffer.from(JSON.stringify({initData,action,value,key}));
 const req=Readable.from([payload]);req.method='POST';req.headers={origin:from};
 const res={status:0,headers:{},body:'',writeHead(code,headers){this.status=code;this.headers=headers;},end(body){this.body=body||'';}};
 await handler(req,res);
 return {status:res.status,headers:res.headers,data:res.body?JSON.parse(res.body):null};
}
function fixture(){
 const dir=mkdtempSync(tmpdir()+'/wa-miniapp-admin-'),store=new Store(dir);
 const links=new PublicWhatsAppLinks(store),cm=new PublicCubamaxLinks(store,links),admin='1234512345';
 const live=new Map(),config={token,url:'https://securitywhat.app',dataDir:dir};
 const telegram={
  store,accounts:{live,dir,send:async()=>({ok:true})},config,
  publicWa:{links,cubamax:cm},
  admins:()=>new Set([admin]),
  permissions:()=>new Set([]),
  permissionFile:{add:ids=>({added:[ids],count:1})},
  autoPublicAccess:{manual:()=>{}},
  webPanel:{access:{
    permanent:()=> 'signed-existing-panel-token',
    token:()=> 'referral-token',short:()=> '12345'
  },role:()=> 'admin'},
  menu:()=>({inline_keyboard:[
    [{text:'USUARIOS ASOCIADOS',callback_data:'users:list:0'}],
    [{text:'POPUP PERMISOS',callback_data:'operator-popup:menu'}],
    [{text:'MENSAJE SISTEMA',callback_data:'system-message'}],
    [{text:'PANEL WEB',callback_data:'op:panel'}]
  ]}),
  help:()=> 'Comandos existentes sin modificar.'
 };
 const handler=createAdminMiniAppBridge(telegram);
 return {handler,store,dir,admin,links,cm,telegram,close:()=>{store.db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('Admin bridge verifies Telegram signature and server-side admin role',async t=>{
 const f=fixture();t.after(f.close);
 assert.equal((await request(f.handler,sign(f.admin),'home','','','https://wrong.example')).status,403);
 assert.equal((await request(f.handler,'fake')).status,400);
 assert.equal((await request(f.handler,sign(f.admin,'wrong'))).status,400);
 assert.equal((await request(f.handler,sign('4555667788'))).status,403);
 const ok=await request(f.handler,sign(f.admin));
 assert.equal(ok.status,200);
 assert.equal(ok.data.admin,true);
 assert.equal(ok.data.role,'admin');
 assert.equal(ok.data.links.editorWA,'https://securitywhat.app/editor?site=wa#signed-existing-panel-token');
 assert.equal(ok.data.links.editorCM,'https://securitywhat.app/editor?site=cm#signed-existing-panel-token');
 assert.equal(ok.data.links.panel,'https://securitywhat.app/panel#signed-existing-panel-token');
});
test('Editor Usuarios overrides only whitelisted Mini App labels and keeps existing texts',async t=>{
 const f=fixture();t.after(f.close);const init=sign(f.admin);
 const previous=f.store.config().wa_public_link_texts;
 const save=await request(f.handler,init,'save-user-text','WhatsApp personalizado','whatsapp');
 assert.equal(save.status,200);
 assert.equal(userMiniappOverrides(f.store).whatsapp,'WhatsApp personalizado');
 assert.equal(f.store.config().wa_public_link_texts,previous);
 assert.equal(save.data.editors.find(x=>x.key==='whatsapp').effective,'WhatsApp personalizado');
 assert.equal((await request(f.handler,init,'save-user-text','hack','webhook_secret')).status,400);
 assert.equal((await request(f.handler,init,'save-user-text','A'.repeat(100),'whatsapp')).status,400);
 const restored=await request(f.handler,init,'save-user-text','','whatsapp');
 assert.equal(restored.status,200);assert.equal(userMiniappOverrides(f.store).whatsapp,undefined);
});
test('Admin users callback reuses original confirmation and ban/revoke logic',async t=>{
 const f=fixture();t.after(f.close);
 const who='5432154321',init=sign(f.admin);
 f.store.db.prepare("INSERT INTO wa_public_links(code,actor,photo,created,enabled) VALUES(?,?,?,?,1)")
   .run('prueba-admin',who,'/portal-media/'+('f'.repeat(64))+'.jpg',Date.now());
 const view=await request(f.handler,init,'callback','users:show:'+who);
 assert.equal(view.status,200);
 assert.match(view.data.messages[0].text,/USUARIO ASOCIADO/);
 assert.ok(view.data.messages[0].buttons.some(b=>b.action==='users:revoke:'+who));
 const confirm=await request(f.handler,init,'callback','users:revoke:'+who);
 assert.equal(confirm.status,200);
 assert.ok(confirm.data.messages[0].buttons.some(b=>b.action==='users:confirm-revoke:'+who));
 assert.equal(f.store.db.prepare("SELECT enabled FROM wa_public_links WHERE code='prueba-admin'").get().enabled,1);
 const applied=await request(f.handler,init,'callback','users:confirm-revoke:'+who);
 assert.equal(applied.status,200);
 assert.equal(f.store.db.prepare("SELECT enabled FROM wa_public_links WHERE code='prueba-admin'").get().enabled,0);
 const forbidden=await request(f.handler,sign(who),'callback','users:confirm-revoke:'+who);
 assert.equal(forbidden.status,403);
});
test('Admin Mini App is separate; customer Mini App HTML and original editors remain untouched',()=>{
 const original=readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../miniapp/admin.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const telegram=readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');
 assert.match(original,/id="whatsapp"/);
 assert.match(original,/id="cubamax"/);
 assert.doesNotMatch(original,/api\/miniapp-admin|\/admin\.html/);
 assert.doesNotMatch(original,/id="open-web-editor"/);
 assert.match(admin,/Editor Web/);assert.match(admin,/Editor Usuarios/);
 assert.match(main,/\/api\/miniapp-admin/);
 assert.match(telegram,/𝐀𝐃𝐌𝐈𝐍𝐈𝐒𝐓𝐑𝐀𝐃𝐎𝐑 𝐖𝐄𝐁.*web_app/);
});

test('Admin popup editor keeps the existing operator-popup handler and storage',async t=>{
 const f=fixture();t.after(f.close);const init=sign(f.admin);
 const menu=await request(f.handler,init,'callback','operator-popup:menu');
 assert.equal(menu.status,200);
 assert.ok(menu.data.messages[0].buttons.some(b=>b.action==='operator-popup:edit:title'));
 const prompt=await request(f.handler,init,'callback','operator-popup:edit:title');
 assert.equal(prompt.status,200);
 assert.equal(prompt.data.pending?.kind,'operatorPopup');
 const result=await request(f.handler,init,'input','Título de prueba');
 assert.equal(result.status,200);
 assert.match(result.data.messages[0].text,/actualizado|guardado/i);
 assert.match(f.store.config().wa_operator_referral_popup,/Título de prueba/);
});

test('Admin associated-link screen uses existing bot callback and pending rules',async t=>{
 const f=fixture();t.after(f.close);const init=sign(f.admin);
 const start=await request(f.handler,init,'callback','assoc:start');
 assert.equal(start.status,200);
 assert.equal(start.data.pending?.kind,'associated');
 assert.equal(start.data.pending?.stage,'phone');
 const input=await request(f.handler,init,'input','+12025550123');
 assert.equal(input.status,200);
 assert.equal(input.data.pending?.stage,'content');
 const cancel=await request(f.handler,init,'cancel');
 assert.equal(cancel.status,200);assert.equal(cancel.data.pending,null);
});

test('/start shows only one role-specific Mini App button, named after editable header for users',async()=>{
 const {PublicWaLinkBot}=await import('../src/public-wa-links-bot.js');
 const {publicWaCopyDefaults}=await import('../src/public-wa-copy.js');
 const admin='1234512345',regular='1234567890';
 const bot={
  pending:new Map(),
  admins:()=>new Set([admin]),
  store:{config:()=>({miniapp_user_labels:JSON.stringify({headerTitle:'Bienvenido'})})},
  send:async(chat,text,markup)=>({chat,text,markup})
 };
 const flow=new PublicWaLinkBot(bot);
 flow._links={texts:()=>({...publicWaCopyDefaults})};
 const a=await flow.start(admin,admin+':'+admin);
 const b=await flow.start(regular,regular+':'+regular);
 const adminButtons=a.markup.inline_keyboard.flat();
 const userButtons=b.markup.inline_keyboard.flat();
 assert.equal(adminButtons.length,1);
 assert.equal(userButtons.length,1);
 assert.equal(adminButtons[0].text,'👨🏻‍💻𝐀𝐃𝐌𝐈𝐍𝐈𝐒𝐓𝐑𝐀𝐃𝐎𝐑 𝐖𝐄𝐁');
 assert.equal(adminButtons[0].web_app.url,'https://whatsapp-cubamax-miniapp.onrender.com/admin.html');
 assert.equal(userButtons[0].text,'Bienvenido');
 assert.equal(userButtons[0].web_app.url,'https://whatsapp-cubamax-miniapp.onrender.com');
 assert.equal(userButtons[0].callback_data,undefined);
 assert.equal(adminButtons[0].style,'danger');
});

test('/menu keeps Administrador Web last and marks it red without changing other actions',async()=>{
 const {Telegram}=await import('../src/telegram.js');
 const rows=Telegram.prototype.menu.call({}).inline_keyboard;
 const last=rows.at(-1);
 assert.equal(last.length,1);
 assert.equal(last[0].text,'👨🏻‍💻𝐀𝐃𝐌𝐈𝐍𝐈𝐒𝐓𝐑𝐀𝐃𝐎𝐑 𝐖𝐄𝐁');
 assert.equal(last[0].style,'danger');
 assert.equal(last[0].web_app.url,'https://whatsapp-cubamax-miniapp.onrender.com/admin.html');
 assert.equal(rows.slice(0,-1).flat().some(button=>!!button.web_app),false);
 assert.ok(rows.slice(0,-1).flat().some(button=>button.callback_data==='users:list:0'));
});

test('Editor Usuarios edits all visible texts and keeps Telegram text editor synchronized',async t=>{
 const f=fixture();t.after(f.close);const init=sign(f.admin);
 const editor=await request(f.handler,init,'editor-users');
 assert.equal(editor.status,200);
 const keys=new Set(editor.data.editors.map(field=>field.key));
 for(const key of ['headerTitle','heroTitle','copyButton','reviewButton','deleteButton','mainMenuButton','socialHeading','socialWhatsapp','socialCubamax','flow:choose','flow:buttonCreate'])
   assert.ok(keys.has(key),key);
 const header=await request(f.handler,init,'save-user-text','Bienvenido','headerTitle');
 assert.equal(header.status,200);
 assert.equal(header.data.editors.find(x=>x.key==='headerTitle').effective,'Bienvenido');
 const post=await request(f.handler,init,'save-user-text','Información clara sobre el enlace de WhatsApp.','socialWhatsapp');
 assert.equal(post.status,200);
 assert.equal(post.data.editors.find(x=>x.key==='socialWhatsapp').effective,'Información clara sobre el enlace de WhatsApp.');
 const copy=await request(f.handler,init,'save-user-text','Revisar detalles','reviewButton');
 assert.equal(copy.status,200);
 assert.equal(copy.data.editors.find(x=>x.key==='reviewButton').effective,'Revisar detalles');
 const bot=await request(f.handler,init,'save-user-text','ENLACE NUEVO','flow:buttonCreate');
 assert.equal(bot.status,200);
 assert.equal(f.links.texts().buttonCreate,'ENLACE NUEVO');
 assert.equal((await request(f.handler,sign('9988776655'),'save-user-text','No permitido','headerTitle')).status,403);
});
test('Public Mini App actions include original delete confirmation and separate post-link texts',()=>{
 const html=readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
 assert.match(html,/pwa:cm-delete:~/);
 assert.match(html,/pwa:delete:~/);
 assert.match(html,/tr\('reviewButton','Revisar'\)/);
 assert.match(html,/tr\('deleteButton','Eliminar'\)/);
 assert.match(html,/tr\('mainMenuButton','MENÚ PRINCIPAL'\)/);
 assert.match(html,/tr\('socialWhatsapp'/);
 assert.match(html,/tr\('socialCubamax'/);
 assert.doesNotMatch(html,/\['Compartir',/);
});
