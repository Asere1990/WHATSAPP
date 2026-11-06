import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {WebPanel} from '../src/panel.js';

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-sender-session-state-'));
 const store=new Store(dir);
 const bot=new Telegram(store,{admins:'99999',dataDir:dir});
 const account=store.invite('13048293582','Cuenta emisora vinculada').account;
 store.update(account.id,'consent',1);
 store.update(account.id,'status','connected');
 store.setConfig('wa_public_sender_list',JSON.stringify([account.phone]));
 const calls=[];
 const accounts={dir,live:new Map(),start:async id=>{
  calls.push(id);
  const session={ready:false};
  accounts.live.set(id,session);
  return session;
 }};
 const panel=new WebPanel(store,accounts,bot,{
  dir,secure:false,url:'https://securitywhat.app',
  allowedOrigins:new Set(['https://securitywhat.app'])
 });
 bot.accounts=accounts;bot.webPanel=panel;
 const web=createServer((req,res)=>panel.handle(
  req,res,new URL(req.url,'http://local').pathname,{},async request=>{
   let input='';for await(const part of request)input+=part;
   return JSON.parse(input||'{}');
  }));
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,bot,accounts,panel,account,web,calls};
}

test('registered sender that loses its live connection stays marked linked, and admin may initiate session recovery without changing accounts',async t=>{
 const ctx=setup(t);
 ctx.web.listen(0,'127.0.0.1');await once(ctx.web,'listening');t.after(()=>ctx.web.close());
 const prefix='http://127.0.0.1:'+ctx.web.address().port+'/api/panel/';
 const admin=ctx.panel.access.login(ctx.panel.access.token('99999','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const list=async()=>{const res=await fetch(prefix+'public-wa-system-numbers',{headers});
  assert.equal(res.status,200);return (await res.json()).numbers[0];};
 const before=await list();
 assert.equal(before.phone,'+13048293582');
 assert.equal(before.connected,false);
 assert.equal(before.state,'Vinculado · Sin conexión');
 assert.equal(before.canReconnect,true);
 assert.equal(ctx.store.account(ctx.account.id).status,'connected');
 const result=await fetch(prefix+'public-wa-system-number-reconnect',{
  method:'POST',headers,body:JSON.stringify({phone:'+13048293582'})
 });
 assert.equal(result.status,200);
 assert.equal((await result.json()).connecting,true);
 assert.deepEqual(ctx.calls,[ctx.account.id],'reuse the original WhatsApp account, not create another');
 const recovering=await list();
 assert.equal(recovering.state,'Conectando / sincronizando');
 assert.equal(recovering.canReconnect,false);
 assert.equal(ctx.store.account(ctx.account.id).consent,1);
 assert.equal(ctx.store.db.prepare('SELECT count(*) n FROM accounts').get().n,1);
});

test('WhatsApp logout is shown as a closed session, never mislabeled as never linked or silently reauthorized',async t=>{
 const ctx=setup(t);
 ctx.store.revoke(ctx.account.id);
 ctx.web.listen(0,'127.0.0.1');await once(ctx.web,'listening');t.after(()=>ctx.web.close());
 const prefix='http://127.0.0.1:'+ctx.web.address().port+'/api/panel/';
 const admin=ctx.panel.access.login(ctx.panel.access.token('99999','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const list=await fetch(prefix+'public-wa-system-numbers',{headers});
 assert.equal(list.status,200);
 const data=(await list.json()).numbers[0];
 assert.equal(data.state,'Sesión cerrada; requiere vinculación');
 assert.equal(data.canReconnect,false);
 assert.equal(data.connected,false);
 assert.throws(()=>ctx.bot.publicWa.sender.source(ctx.account.phone),/estuvo vinculado.*sesión fue cerrada o revocada/);
 const response=await fetch(prefix+'public-wa-system-number-reconnect',{
  method:'POST',headers,body:JSON.stringify({phone:'+13048293582'})
 });
 assert.equal(response.status,409,'no fake reconnection of a logged-out session');
 assert.deepEqual(ctx.calls,[]);
 assert.equal(ctx.store.account(ctx.account.id).consent,0,'the original revocation is preserved');
 assert.equal(ctx.store.config().wa_public_sender_list,JSON.stringify([ctx.account.phone]));
});

test('reconnect endpoint remains admin-only and cannot recover arbitrary unconfigured accounts',async t=>{
 const ctx=setup(t);
 ctx.bot.permissionFile.add('123456789');
 const other=ctx.store.invite('12025550199','Otra cuenta').account;
 ctx.store.update(other.id,'consent',1);
 ctx.store.update(other.id,'status','connected');
 ctx.web.listen(0,'127.0.0.1');await once(ctx.web,'listening');t.after(()=>ctx.web.close());
 const url='http://127.0.0.1:'+ctx.web.address().port+'/api/panel/public-wa-system-number-reconnect';
 const admin=ctx.panel.access.login(ctx.panel.access.token('99999','login'));
 const operator=ctx.panel.access.login(ctx.panel.access.token('123456789','login'));
 const headers={Cookie:'wa_panel='+admin.secret,Origin:'https://securitywhat.app','X-Panel-CSRF':admin.csrf};
 const call=(phone,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify({phone})});
 assert.equal((await call('+13048293582',{...headers,Cookie:'wa_panel='+operator.secret})).status,403);
 assert.equal((await call('+13048293582',{...headers,'X-Panel-CSRF':'wrong'})).status,403);
 assert.equal((await call('+13048293582',{...headers,Origin:'https://example.org'})).status,403);
 assert.equal((await call('+12025550199')).status,404);
 assert.deepEqual(ctx.calls,[]);
 assert.equal(ctx.store.account(other.id).consent,1);
});
