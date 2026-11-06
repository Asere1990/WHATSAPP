import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../src/store.js';
import {Telegram} from '../src/telegram.js';
import {WebPanel} from '../src/panel.js';

test('admin web list includes old permisos.txt operators with zero links, public-link owners and banned users',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wa-web-user-directory-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'original-permisos.txt'),baseline='123456789 # operador antiguo\n223344556\n99999\n';
 writeFileSync(source,baseline);
 const store=new Store(dir);
 t.after(()=>store.db.close());
 const bot=new Telegram(store,{admins:'99999',dataDir:dir});
 bot.permissionFile.source=source;
 bot.permissionFile.add('334455667');
 bot.publicWa.links.create('445566778','enlace-antiguo','/portal-media/'+'a'.repeat(64)+'.png');
 bot.associatedUsers.remember({id:'445566778',first_name:'Marta',username:'marta_demo'});
 const accounts={dir,live:new Map()};
 const panel=new WebPanel(store,accounts,bot,{url:'http://test',secure:false,allowedOrigins:new Set(['http://test']),dir});
 bot.webPanel=panel;
 panel.access.remember('123456789','Operador anterior');
 const server=createServer((req,res)=>panel.handle(req,res,new URL(req.url,'http://local').pathname,{},async request=>{
  let body='';for await(const chunk of request)body+=chunk;
  return JSON.parse(body||'{}');
 }));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const login=panel.access.login(panel.access.token('99999','login'));
 const headers={Cookie:'wa_panel='+login.secret,Origin:'http://test','X-Panel-CSRF':login.csrf};
 const get=async()=>{const r=await fetch(base+'/api/panel/public-wa-users',{headers});assert.equal(r.status,200);return (await r.json()).users;};
 const post=async(actor,banned,headersOverride=headers)=>fetch(base+'/api/panel/public-wa-ban-user',{
  method:'POST',headers:headersOverride,body:JSON.stringify({actor,banned})
 });
 const users=await get(),byActor=new Map(users.map(u=>[u.actor,u]));
 for(const id of ['123456789','223344556','334455667','445566778','99999'])
  assert.ok(byActor.has(id),'missing ID '+id);
 assert.deepEqual([byActor.get('123456789').links,byActor.get('123456789').active],[0,0]);
 assert.equal(byActor.get('123456789').name,'Operador anterior');
 assert.deepEqual([byActor.get('445566778').links,byActor.get('445566778').active],[1,1]);
 assert.equal(byActor.get('445566778').username,'marta_demo');
 assert.equal(byActor.get('99999').admin,true,'admins are listed but not bannable');
 const unauthorized=await post('223344556',true,{...headers,'X-Panel-CSRF':'wrong'});
 assert.equal(unauthorized.status,403);
 const adminBan=await post('99999',true);assert.equal(adminBan.status,403);
 const banned=await post('123456789',true);assert.equal(banned.status,200);
 assert.equal((await banned.json()).banned,true);
 assert.equal(bot.permissions().has('123456789'),false,'banned legacy user loses operator role');
 assert.equal(readFileSync(source,'utf8'),baseline,'the original permisos.txt must not be edited');
 assert.equal(byActor.get('123456789').banned,false);
 assert.equal((await get()).find(u=>u.actor==='123456789').banned,true,'banned user remains listed');
 const restored=await post('123456789',false);assert.equal(restored.status,200);
 assert.equal(bot.permissions().has('123456789'),true);
 const linkBan=await post('445566778',true);assert.equal(linkBan.status,200);
 assert.equal(bot.publicWa.links.active('enlace-antiguo'),null,'ban disables owned links');
 assert.equal((await get()).find(u=>u.actor==='445566778').active,0);
 const linkRestore=await post('445566778',false);assert.equal(linkRestore.status,200);
 assert.equal(bot.publicWa.links.active('enlace-antiguo'),null,'unban does not auto-reactivate links');
});
test('web user cards offer confirmed ban/unban without changing their original link controls',async()=>{
 const code=readFileSync(new URL('../public/wa-public-admin.js',import.meta.url),'utf8');
 const elements=new Map(),requests=[];
 let users=[{actor:'123456789',name:'Operador',username:'operador_1',links:0,active:0,banned:false,admin:false}];
 class Node{
  constructor(tag='div',value=''){this.tagName=tag.toUpperCase();this.textContent=value;this.children=[];this.hidden=false;this.disabled=false;this.style={};}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  addEventListener(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const get=id=>{if(id==='workspace')return null;if(!elements.has(id))elements.set(id,new Node());return elements.get(id);};
 const fetch=async (url,options={})=>{
  requests.push({url,options});
  if(url.endsWith('/me'))return {ok:true,json:async()=>({role:'admin',csrf:'csrf'})};
  if(url.endsWith('/public-wa-users'))return {ok:true,json:async()=>({users})};
  if(url.endsWith('/public-wa-ban-user')){
   assert.equal(options.headers['X-Panel-CSRF'],'csrf');
   const input=JSON.parse(options.body);assert.equal(input.actor,'123456789');
   users=[{...users[0],banned:input.banned}];
   return {ok:true,json:async()=>({ok:true,banned:input.banned})};
  }
  throw Error('Unexpected request '+url);
 };
 vm.runInNewContext(code,{document:{getElementById:get,createElement:tag=>new Node(tag)},fetch,
  confirm:()=>true,console},{filename:'public/wa-public-admin.js'});
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 await settle();await get('wa-public-admin-open').onclick();await settle();
 let row=get('wa-public-users').children[0],controls=row.children[3].children;
 assert.deepEqual(controls.map(x=>x.textContent),['VER ENLACES','ELIMINAR TODO DEL USUARIO','⛔ BANEAR USUARIO']);
 await controls[2].onclick();await settle();
 assert.equal(requests.filter(r=>r.url.endsWith('/public-wa-ban-user')).length,1);
 row=get('wa-public-users').children[0];controls=row.children[3].children;
 assert.equal(controls[2].textContent,'✅ DESBANEAR USUARIO');
 assert.equal(controls[0].textContent,'VER ENLACES');
 assert.equal(controls[1].textContent,'ELIMINAR TODO DEL USUARIO');
 await controls[2].onclick();await settle();
 row=get('wa-public-users').children[0];controls=row.children[3].children;
 assert.equal(controls[2].textContent,'⛔ BANEAR USUARIO');
});
