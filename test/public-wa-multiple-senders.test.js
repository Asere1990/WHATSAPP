import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {WebPanel} from '../src/panel.js';
import {PublicWaLinkBot} from '../src/public-wa-links-bot.js';
import {publicWaSenderNumbers} from '../src/public-wa-send.js';

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-multi-sender-'));
 const store=new Store(dir),sent=[];
 const first=store.invite('17867707509','Sistema principal').account;
 const second=store.invite('12025550199','Sistema adicional').account;
 for(const account of [first,second]){
  store.update(account.id,'consent',1);
  store.update(account.id,'status','connected');
 }
 const accounts={dir,live:new Map([[first.id,{ready:true}],[second.id,{ready:true}]]),
  send:async(...args)=>{sent.push(args);return {ok:true};}};
 const bot=new Telegram(store,{admins:'99999',dataDir:dir});
 bot.accounts=accounts;bot.api=async()=>({ok:true});
 const outputs=[];
 bot.send=async(...args)=>{outputs.push(args);return args;};
 const flow=bot.publicWa;
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,bot,flow,accounts,sent,outputs,first,second,dir};
}
function confExtra(ctx){ctx.store.setConfig('wa_public_sender_numbers',JSON.stringify([ctx.second.phone]));}
async function createPreview(ctx,code='trabajo-nuevo'){
 const {bot,flow,outputs}=ctx;
 const actor='123456789',key=actor+':'+actor;
 const photo='/portal-media/'+'a'.repeat(64)+'.png';
 const link=flow.links.create(actor,'enlace-anterior',photo);
 ctx.store.setConfig('wa_public_link_popup_photo',photo);
 flow.popupForSend=async()=>({asset:photo,replaced:2});
 flow.previewPopup=async()=>{};
 await flow.callback(actor,key,actor,'pwa:send:~'+link.link_id);
 await flow.input(actor,key,actor,{text:code});
 await flow.input(actor,key,actor,{text:'Estados Unidos'});
 await flow.input(actor,key,actor,{text:'2025550147'});
 assert.equal(bot.pending.get(key).kind,'publicWaConfirm');
 assert.match(outputs.at(-1)[1],/securitywhat.app/);
 return {actor,key};
}

test('multiple configured numbers are selectable AFTER the unchanged WhatsApp invitation preview',async t=>{
 const ctx=setup(t);confExtra(ctx);
 assert.deepEqual(publicWaSenderNumbers(ctx.store),['17867707509','12025550199']);
 const {actor,key}=await createPreview(ctx);
 await ctx.flow.callback(actor,key,actor,'pwa:send-confirm');
 assert.equal(ctx.bot.pending.get(key).kind,'publicWaConfirm','existing /cancelar state is maintained');
 const options=ctx.outputs.at(-1)[2].inline_keyboard.flat();
 assert.deepEqual(options.filter(x=>x.callback_data?.startsWith('pwa:send-from:')).map(x=>x.text),[
  '📤 ENVIAR DESDE +17867707509','📤 ENVIAR DESDE +12025550199'
 ]);
 assert.equal(ctx.sent.length,0,'choosing a sender must occur BEFORE delivery');
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:1');
 assert.equal(ctx.sent.length,1);
 assert.equal(ctx.sent[0][0],ctx.second.id,'delivery must use the selected secondary account');
 assert.equal(ctx.sent[0][1],'12025550147@c.us');
 assert.match(ctx.sent[0][2],/https:\/\/securitywhat\.app\/trabajo-nuevo/);
 assert.equal(ctx.store.config().wa_public_sender_phone,undefined,'primary number remains unchanged');
 assert.equal(ctx.store.account(ctx.first.id).status,'connected');
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:1');
 assert.equal(ctx.sent.length,1,'a prior confirmation cannot be replayed');
 assert.equal(ctx.store.db.prepare('SELECT count(*) n FROM wa_public_message_sends').get().n,1);
});

test('offline secondary sender is rejected but user may choose another sender without repeating popup',async t=>{
 const ctx=setup(t);confExtra(ctx);
 const {actor,key}=await createPreview(ctx,'trabajo-respaldo');
 await ctx.flow.callback(actor,key,actor,'pwa:send-confirm');
 ctx.accounts.live.set(ctx.second.id,{ready:false});
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:1');
 assert.equal(ctx.sent.length,0);
 assert.equal(ctx.bot.pending.get(key).kind,'publicWaConfirm');
 assert.match(ctx.outputs.at(-1)[1],/no está conectado/);
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:0');
 assert.equal(ctx.sent.length,1);
 assert.equal(ctx.sent[0][0],ctx.first.id);
});

test('single sender keeps original ENVIAR MENSAJE action without extra selection',async t=>{
 const ctx=setup(t),{actor,key}=await createPreview(ctx,'trabajo-unico');
 await ctx.flow.callback(actor,key,actor,'pwa:send-confirm');
 assert.equal(ctx.sent.length,1);
 assert.equal(ctx.sent[0][0],ctx.first.id);
});

test('admin can add a connected sender via web without replacing primary or changing accounts',async t=>{
 const ctx=setup(t);
 ctx.bot.permissionFile.add('123456789');
 const panel=new WebPanel(ctx.store,ctx.accounts,ctx.bot,{
  dir:ctx.dir,secure:false,url:'https://securitywhat.app',
  allowedOrigins:new Set(['https://securitywhat.app'])
 });
 ctx.bot.webPanel=panel;
 const server=createServer((req,res)=>panel.handle(
  req,res,new URL(req.url,'http://local').pathname,{},async request=>{
   let data='';for await(const chunk of request)data+=chunk;return JSON.parse(data||'{}');
  }
 ));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/api/panel/public-wa-system-numbers';
 const admin=panel.access.login(panel.access.token('99999','login'));
 const operator=panel.access.login(panel.access.token('123456789','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const post=(phone,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify({phone})});
 const get=(h=headers)=>fetch(url,{headers:h});
 const initial=await get();assert.equal(initial.status,200);
 assert.deepEqual((await initial.json()).numbers.map(x=>x.phone),['+17867707509']);
 assert.equal((await get({Cookie:'wa_panel='+operator.secret})).status,403);
 assert.equal((await post('+12025550199',{...headers,Cookie:'wa_panel='+operator.secret})).status,403);
 assert.equal((await post('+12025550199',{...headers,'X-Panel-CSRF':'wrong'})).status,403);
 assert.equal((await post('+12025550199',{...headers,Origin:'https://example.com'})).status,403);
 assert.equal((await post('+12025550999')).status,400,'not a connected sender');
 ctx.accounts.live.set(ctx.second.id,{ready:false});
 assert.equal((await post('+12025550199')).status,409,'disconnected sender cannot be added');
 ctx.accounts.live.set(ctx.second.id,{ready:true});
 const added=await post('+12025550199');
 assert.equal(added.status,200);
 assert.deepEqual(await added.json(),{ok:true,phone:'+12025550199'});
 assert.equal(ctx.store.config().wa_public_sender_phone,undefined);
 assert.deepEqual(publicWaSenderNumbers(ctx.store),['17867707509','12025550199']);
 assert.equal(ctx.store.account(ctx.first.id).status,'connected');
 assert.equal(ctx.store.account(ctx.second.id).status,'connected');
 const repeat=await post('+12025550199');
 assert.equal(repeat.status,200);
 assert.equal((await repeat.json()).alreadyAdded,true);
 const list=await get();
 assert.deepEqual((await list.json()).numbers.map(x=>[x.phone,x.primary,x.connected]),[
  ['+17867707509',true,true],['+12025550199',false,true]
 ]);
});

test('only new system-number UI elements are added to existing panel',()=>{
 const html=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
 for(const id of ['wa-system-number-add-open','wa-system-number-add-dialog','wa-system-number-add-form',
  'wa-system-number-add-input','wa-system-number-add-save','wa-system-number-add-cancel'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('id="wa-system-number-open"'),'existing change-number button preserved');
 assert.ok(html.includes('id="wa-public-admin-open"'),'existing link-admin button preserved');
});


test('admin removes only a secondary system sender; existing account, history and primary remain untouched',async t=>{
 const ctx=setup(t);confExtra(ctx);
 ctx.bot.permissionFile.add('123456789');
 const panel=new WebPanel(ctx.store,ctx.accounts,ctx.bot,{
  dir:ctx.dir,secure:false,url:'https://securitywhat.app',
  allowedOrigins:new Set(['https://securitywhat.app'])
 });
 ctx.bot.webPanel=panel;
 const server=createServer((req,res)=>panel.handle(
  req,res,new URL(req.url,'http://local').pathname,{},async request=>{
   let body='';for await(const chunk of request)body+=chunk;
   return JSON.parse(body||'{}');
  }
 ));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/api/panel/public-wa-system-number-remove';
 const admin=panel.access.login(panel.access.token('99999','login'));
 const operator=panel.access.login(panel.access.token('123456789','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const remove=(phone,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify({phone})});
 const before=ctx.store.config().wa_public_sender_numbers;
 ctx.flow.sender; // Initialize the existing send-history table without sending a message.
 const old=ctx.store.db.prepare('INSERT INTO wa_public_message_sends(actor,code,phone,source,created,status) VALUES(?,?,?,?,?,?)')
  .run('123456789','enlace-anterior','12025550188',ctx.second.id,Date.now()-86400000,'sent');
 assert.equal((await remove('+12025550199',{Cookie:'wa_panel='+operator.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':operator.csrf})).status,403);
 assert.equal((await remove('+12025550199',{...headers,'X-Panel-CSRF':'incorrecto'})).status,403);
 assert.equal((await remove('+12025550199',{...headers,Origin:'https://otro.example'})).status,403);
 assert.equal((await remove('+17867707509')).status,400,'the primary number is protected');
 assert.equal((await remove('+12025550999')).status,404,'unknown system numbers are rejected');
 assert.equal(ctx.store.config().wa_public_sender_numbers,before,'invalid actions leave config unchanged');
 ctx.accounts.live.set(ctx.second.id,{ready:false});
 const removed=await remove('+1 (202) 555-0199');
 assert.equal(removed.status,200,'offline secondary numbers can still be removed');
 assert.deepEqual(await removed.json(),{ok:true,phone:'+12025550199'});
 assert.deepEqual(publicWaSenderNumbers(ctx.store),['17867707509']);
 assert.equal(ctx.store.config().wa_public_sender_phone,undefined,'primary configuration is unchanged');
 assert.equal(ctx.store.account(ctx.second.id).status,'connected');
 assert.equal(ctx.store.account(ctx.second.id).consent,1);
 assert.equal(ctx.store.db.prepare('SELECT count(*) n FROM wa_public_message_sends WHERE source=?').get(ctx.second.id).n,1,
  'removing an emitter must not erase previous message records');
 assert.equal(ctx.store.db.prepare('SELECT status FROM wa_public_message_sends WHERE id=?').get(old.lastInsertRowid).status,'sent');
 assert.equal((await remove('+12025550199')).status,404,'second removal does not affect anything');
});

test('removing an emitter after preview excludes it from the send choices',async t=>{
 const ctx=setup(t);confExtra(ctx);
 const {actor,key}=await createPreview(ctx,'trabajo-remover');
 await ctx.flow.callback(actor,key,actor,'pwa:send-confirm');
 ctx.store.setConfig('wa_public_sender_numbers',JSON.stringify([]));
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:1');
 assert.equal(ctx.sent.length,0,'removed sender cannot send a pending message');
 const choices=ctx.outputs.at(-1)[2].inline_keyboard.flat()
  .filter(button=>button.callback_data?.startsWith('pwa:send-from:'));
 assert.deepEqual(choices.map(x=>x.text),['📤 ENVIAR DESDE +17867707509']);
 await ctx.flow.callback(actor,key,actor,'pwa:send-from:0');
 assert.equal(ctx.sent.length,1);
 assert.equal(ctx.sent[0][0],ctx.first.id);
});

test('web shows REMOVER only beside additional senders and requests confirmation',async()=>{
 const source=readFileSync(new URL('../public/wa-public-admin.js',import.meta.url),'utf8');
 const elements=new Map(),requests=[],confirmations=[];
 class Node{
  constructor(tag='div',value=''){
   this.tagName=tag.toUpperCase();this.textContent=value;this.children=[];
   this.hidden=true;this.disabled=false;this.style={};this.value='';
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  addEventListener(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const node=id=>{
  if(id==='workspace')return null;
  if(!elements.has(id))elements.set(id,new Node());
  return elements.get(id);
 };
 let numbers=[
  {phone:'+17867707509',primary:true,connected:true},
  {phone:'+12025550199',primary:false,connected:true}
 ];
 const fetch=async(url,options={})=>{
  requests.push({url,options});
  if(url.endsWith('/me'))return {ok:true,json:async()=>({role:'admin',csrf:'csrf-token'})};
  if(url.endsWith('/public-wa-system-numbers')){
   return {ok:true,json:async()=>({numbers})};
  }
  if(url.endsWith('/public-wa-system-number-remove')){
   assert.equal(options.method,'POST');
   assert.equal(options.headers['X-Panel-CSRF'],'csrf-token');
   assert.equal(JSON.parse(options.body).phone,'+12025550199');
   numbers=numbers.filter(item=>item.primary);
   return {ok:true,json:async()=>({ok:true,phone:'+12025550199'})};
  }
  throw Error('Unexpected URL '+url);
 };
 vm.runInNewContext(source,{
  document:{getElementById:node,createElement:tag=>new Node(tag)},fetch,
  confirm:message=>{confirmations.push(message);return true;},console
 },{filename:'public/wa-public-admin.js'});
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 await settle();
 await node('wa-system-number-add-open').onclick();await settle();
 const before=node('wa-system-number-list').children;
 assert.equal(before.length,2);
 assert.equal(before[0].children.length,0,'primary number must have no remove button');
 assert.equal(before[1].children[1].textContent,'REMOVER NÚMERO');
 await before[1].children[1].onclick();await settle();
 assert.equal(confirmations.length,1,'user must explicitly confirm removal');
 assert.match(confirmations[0],/NO se borrarán ni se desconectarán/);
 assert.equal(requests.filter(item=>item.url.endsWith('/public-wa-system-number-remove')).length,1);
 assert.equal(node('wa-system-number-list').children.length,1,'list refreshes immediately');
 assert.match(node('wa-system-number-add-status').textContent,/removido/);
});
