import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {WebPanel} from '../src/panel.js';
import {AssociatedLinks} from '../src/associated-links.js';

test('admin web counts every verifiable WhatsApp, Cubamax and old link without changing their owners',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wa-link-counts-')),store=new Store(dir);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const id='8163168935',other='1234512345',source=path.join(dir,'legacy-permisos.txt');
 writeFileSync(source,id+'\n'+other+'\n');
 const bot=new Telegram(store,{admins:'99999',dataDir:dir});
 bot.permissionFile.source=source;
 const publicWa=bot.publicWa.links,publicCm=bot.publicWa.cubamax;
 bot.associatedUsers.remember({id,first_name:'Mr',last_name:'boogie'});
 const accounts={dir,live:new Map()};
 const panel=new WebPanel(store,accounts,bot,{
  url:'https://securitywhat.app',secure:false,dir,
  allowedOrigins:new Set(['https://securitywhat.app'])
 });
 bot.webPanel=panel;
 const photo='/portal-media/'+'a'.repeat(64)+'.png';
 publicWa.create(id,'mi-codigo-wa',photo);
 publicCm.create(id,'mi-codigo-cubamax');
 const tokenWa=panel.access.token(id,'referral',{site:'wa'});
 const shortWa=panel.access.short(tokenWa);
 const tokenCm=panel.access.token(id,'referral',{site:'cm'});
 const shortCm=panel.access.short(tokenCm);
 store.db.prepare('INSERT INTO studio_pages(id,name,draft,published,version,created) VALUES(?,?,?,?,?,?)')
  .run('mi-pagina','Web del equipo','{}','{}',1,Date.now());
 const custom=panel.studio.link({actor:id,role:'operator'},'mi-pagina');
 const account=store.invite('12025550123','Cuenta asociada').account;
 store.db.prepare('INSERT INTO panel_owners(account,actor,created) VALUES(?,?,?)')
  .run(account.id,id,Date.now());
 const associated=new AssociatedLinks(store);
 associated.save('12025550123','text','Información de trabajo');
 // An admin-created associated URL with no verifiable owner must not be
 // falsely attributed to either Telegram user.
 associated.save('12025550999','text','Sin titular Telegram');
 const server=createServer((req,res)=>panel.handle(
  req,res,new URL(req.url,'http://local').pathname,{},async()=>({})
 ));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const login=panel.access.login(panel.access.token('99999','login'));
 const headers={Cookie:'wa_panel='+login.secret};
 const list=async()=>{const response=await fetch(base+'/api/panel/public-wa-users',{headers});
  assert.equal(response.status,200);return (await response.json()).users;};
 const items=async()=>{const response=await fetch(base+'/api/panel/public-wa-user-links?actor='+id,{headers});
  assert.equal(response.status,200);return (await response.json()).items;};
 const users=await list(),mr=users.find(x=>x.actor===id),empty=users.find(x=>x.actor===other);
 assert.ok(mr,'old permisos.txt account remains visible');
 assert.equal(mr.permitted,true);
 assert.equal(empty.permitted,true);
 assert.equal(mr.total_accounts,1,'account ownership is counted without modifying the account');
 assert.equal(mr.linked_accounts,0,'unconfirmed accounts are not reported as linked');
 assert.ok(mr.joined_at>0,'first verifiable system activity is available');
 assert.equal(empty.joined_at,null,'never fabricate the join date for an older permission');
 assert.equal(mr.name,'Mr boogie');
 assert.equal(mr.links,6);
 assert.equal(mr.active,6);
 for(const label of ['wa','cm','legacyWa','legacyCm','studio','associated'])
  assert.deepEqual(mr.sources[label],{links:1,active:1},label);
 assert.deepEqual([empty.links,empty.active],[0,0]);
 const links=await items();
 assert.equal(links.length,6,'every counted link should have a corresponding detail');
 assert.deepEqual(new Set(links.map(link=>link.site)),new Set([
  'WhatsApp','Cubamax','WhatsApp · vinculación anterior',
  'Cubamax · vinculación anterior','Web personalizada','WhatsApp · asociado a cuenta'
 ]));
 assert.ok(links.some(link=>link.url==='https://securitywhat.app/'+String(shortWa).padStart(6,'0')));
 assert.ok(links.some(link=>link.url==='https://cubamaxcom.online/'+String(shortCm).padStart(5,'0')));
 assert.ok(links.some(link=>link.url===custom.url));
 assert.ok(links.some(link=>link.url==='https://securitywhat.app/12025550123'));
 assert.ok(!links.some(link=>link.code.includes('12025550999')),
  'unowned admin-associated link must not be attributed to Mr boogie');
 // Expiry only changes the reported state. The row and referral URL persist.
 store.db.prepare("UPDATE panel_tokens SET expires=? WHERE actor=? AND kind='referral' AND hash=(SELECT hash FROM panel_referral_short WHERE id=?)")
  .run(Date.now()-1000,id,Number(shortWa));
 const updated=(await list()).find(x=>x.actor===id);
 assert.equal(updated.links,6);
 assert.equal(updated.active,5);
 assert.equal(updated.sources.legacyWa.active,0);
 assert.equal((await items()).find(link=>link.site==='WhatsApp · vinculación anterior').enabled,false);
 assert.equal(publicWa.active('mi-codigo-wa')?.code,'mi-codigo-wa');
 assert.equal(publicCm.activeId(publicCm.record('mi-codigo-cubamax').link_id)?.code,'mi-codigo-cubamax');
});
