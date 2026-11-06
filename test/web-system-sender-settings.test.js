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
import {PublicWaSender} from '../src/public-wa-send.js';

test('only admin can replace system sender with an already authorized, connected WhatsApp account',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wa-switch-system-sender-'));
 const store=new Store(dir);
 const bot=new Telegram(store,{admins:'99999',dataDir:dir});
 bot.permissionFile.add('123456789');
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const previous=store.invite('17867707509','Sistema anterior').account;
 const replacement=store.invite('12025550199','Sistema nuevo').account;
 for(const a of [previous,replacement]){
  store.update(a.id,'consent',1);
  store.update(a.id,'status','connected');
 }
 const accounts={dir,live:new Map([[previous.id,{ready:true}],[replacement.id,{ready:false}]])};
 const panel=new WebPanel(store,accounts,bot,{dir,secure:false,
  url:'https://securitywhat.app',allowedOrigins:new Set(['https://securitywhat.app'])});
 bot.webPanel=panel;
 store.setConfig('wa_public_invitation_message','Texto configurado que debe quedar igual.');
 const server=createServer((req,res)=>panel.handle(req,res,new URL(req.url,'http://local').pathname,{},async request=>{
  let body='';for await(const chunk of request)body+=chunk;return JSON.parse(body||'{}');
 }));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port+'/api/panel/public-wa-system-number';
 const admin=panel.access.login(panel.access.token('99999','login'));
 const operator=panel.access.login(panel.access.token('123456789','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const get=(h=headers)=>fetch(base,{headers:h});
 const post=(phone,h=headers)=>fetch(base,{method:'POST',headers:h,body:JSON.stringify({phone})});
 const current=await get();assert.equal(current.status,200);
 assert.deepEqual(await current.json(),{phone:'+17867707509',connected:true});
 assert.equal((await get({Cookie:'wa_panel='+operator.secret})).status,403);
 assert.equal((await post('+12025550199',{...headers,'X-Panel-CSRF':'wrong'})).status,403);
 assert.equal((await post('+12025550199',{...headers,Origin:'https://malicious.example'})).status,403);
 assert.equal((await post('+12025550199',{...headers,Cookie:'wa_panel='+operator.secret})).status,403);
 assert.equal((await post('+12025550111')).status,400,'cannot set an unlinked number');
 assert.equal((await post('+12025550199')).status,409,'cannot switch to a disconnected system account');
 assert.equal(store.config().wa_public_sender_phone,undefined,'failed attempts must never change sender');
 accounts.live.set(replacement.id,{ready:true});
 const updated=await post('+1 (202) 555-0199');
 assert.equal(updated.status,200);
 assert.deepEqual(await updated.json(),{ok:true,phone:'+12025550199'});
 assert.equal(store.config().wa_public_sender_phone,'+12025550199');
 const reread=await get();assert.deepEqual(await reread.json(),{phone:'+12025550199',connected:true});
 const sender=new PublicWaSender(store,accounts,bot.publicWa.links);
 assert.equal(sender.source().id,replacement.id,'the existing sender engine picks up the new number automatically');
 assert.equal(store.account(previous.id).status,'connected','the old account stays connected');
 assert.equal(store.account(previous.id).consent,1);
 assert.equal(store.config().wa_public_invitation_message,'Texto configurado que debe quedar igual.');
});

test('existing admin web offers a direct sender-number button and saves only after confirmation',async()=>{
 const html=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
 for(const id of ['wa-system-number-open','wa-system-number-dialog','wa-system-number-form',
  'wa-system-number-input','wa-system-number-save','wa-system-number-cancel'])
  assert.match(html,new RegExp('id="'+id+'"'));
 const script=readFileSync(new URL('../public/wa-public-admin.js',import.meta.url),'utf8');
 const map=new Map(),requests=[];
 class Node{
  constructor(){this.textContent='';this.children=[];this.hidden=true;this.disabled=false;this.value='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const get=id=>{if(id==='workspace')return null;if(!map.has(id))map.set(id,new Node());return map.get(id);};
 const fetch=async(url,options={})=>{
  requests.push({url,options});
  if(url.endsWith('/me'))return {ok:true,json:async()=>({role:'admin',csrf:'test-csrf'})};
  if(url.endsWith('/public-wa-system-number')){
   if(options.method==='POST'){
    assert.equal(options.headers['X-Panel-CSRF'],'test-csrf');
    assert.equal(JSON.parse(options.body).phone,'+12025550199');
    return {ok:true,json:async()=>({ok:true,phone:'+12025550199'})};
   }
   return {ok:true,json:async()=>({phone:'+17867707509',connected:true})};
  }
  throw Error('Unexpected web call: '+url);
 };
 vm.runInNewContext(script,{document:{getElementById:get,createElement:()=>new Node()},fetch,confirm:()=>true,console},
  {filename:'public/wa-public-admin.js'});
 for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('wa-system-number-open').hidden,false,'admins can see the new button');
 await get('wa-system-number-open').onclick();
 assert.equal(get('wa-system-number-dialog').open,true);
 assert.equal(get('wa-system-number-input').value,'+17867707509');
 get('wa-system-number-input').value='+12025550199';
 await get('wa-system-number-form').onsubmit({preventDefault(){}});
 assert.equal(requests.filter(r=>r.url.endsWith('/public-wa-system-number')&&r.options.method==='POST').length,1);
 assert.match(get('wa-system-number-status').textContent,/actualizado/);
 assert.equal(get('wa-system-number-current').textContent,'Número actual: +12025550199 · Conectado');
 get('wa-system-number-cancel').onclick();
 assert.equal(get('wa-system-number-dialog').open,false);
});
