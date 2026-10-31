import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {PanelChatList} from '../src/panel-chat-list.js';
import {WebPanel} from '../src/panel.js';

const pn='12025550129@s.whatsapp.net',lid='88776655@lid',group='120363777777777777@g.us';
const message=(peer,id,ts,message)=>({key:{remoteJid:peer,id,fromMe:false},messageTimestamp:ts,message});
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-fast-chats-'),store=new Store(dir);
 const a=store.invite('12025550123','Account A').account;
 const b=store.invite('12025550124','Account B').account;
 for(const item of [a,b]){
  store.update(item.id,'consent',1);store.update(item.id,'status','connected');
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(item.id);
 }
 const db=new BaileysStore(store,a.id);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,dir,a,b,db};
}
test('a 700-chat directory only resolves the 50 visible names and previews, with short-lived reuse',t=>{
 const {store,a,db}=setup(t);let clock=1000,calls=0;
 for(let i=0;i<700;i++)db.put('chat',(12025550000+i)+'@s.whatsapp.net',
  {id:(12025550000+i)+'@s.whatsapp.net',name:'Contacto '+i,conversationTimestamp:700-i},
  {timestamp:700-i});
 const profiles={name:(id,peer,aliases)=>{calls++;assert.equal(id,a.id);assert.ok(aliases.includes(peer));return 'Contacto '+peer.split('@')[0];},
  url:(_id,peer)=>'/image/'+peer};
 const list=new PanelChatList(store,profiles,{now:()=>clock,ttl:15000,pageSize:50});
 const first=list.page(a.id,db);
 assert.equal(first.items.length,50);
 assert.equal(first.next,50);
 assert.equal(calls,50,'must not resolve all 700 contact profiles');
 assert.equal(first.items[0].timestamp,700);
 assert.equal(first.items[49].timestamp,651);
 const again=list.page(a.id,db);
 assert.equal(again.items.length,50);assert.equal(calls,50,'reused names stay in the catalog');
 const second=list.page(a.id,db,{offset:first.next});
 assert.equal(second.items.length,50);assert.equal(second.next,100);assert.equal(calls,100);
 assert.equal(second.items[0].timestamp,650);
 clock+=15001;
 list.page(a.id,db);
 assert.equal(calls,150,'a new snapshot refreshes only the visible names');
});
test('search keeps contact-name matching across the full catalog and pagination does not duplicate entries',t=>{
 const {store,a,db}=setup(t);let calls=0;
 for(let i=0;i<145;i++)db.put('chat',(12025550000+i)+'@s.whatsapp.net',
  {id:(12025550000+i)+'@s.whatsapp.net',name:i%20===0?'ABUELA '+i:'Cliente '+i,conversationTimestamp:145-i},
  {timestamp:145-i});
 const profiles={name:(_id,peer)=>{calls++;const chat=db.get('chat',peer);return chat.name;},url:()=>'/image'};
 const list=new PanelChatList(store,profiles);
 const main=list.page(a.id,db);
 assert.equal(main.items.length,50);assert.equal(main.next,50);
 const more=list.page(a.id,db,{offset:50});
 assert.equal(new Set([...main.items,...more.items].map(c=>c.peer)).size,100);
 const search=list.page(a.id,db,{query:'abuela'});
 assert.equal(search.items.length,8);
 assert.ok(search.items.every(c=>c.name.includes('ABUELA')));
 assert.equal(search.next,null);
 const numberSearch=list.page(a.id,db,{query:'12025550144'});
 assert.equal(numberSearch.items.length,1);
 assert.ok(calls<=145,'catalog caches resolved contact names after the first lookup');
});
test('number/LID aliases merge into one chat without mixing profiles or another account',t=>{
 const {store,a,b,db}=setup(t);
 db.put('mapping',lid,pn);
 db.put('chat',lid,{id:lid,name:'Alias temporal',conversationTimestamp:110,unreadCount:1},{timestamp:110});
 db.put('chat',pn,{id:pn,name:'Nombre elegido',conversationTimestamp:100,unreadCount:2},{timestamp:100});
 db.put('contact',pn,{id:pn,name:'Contacto seguro'});
 db.put('chat',group,{id:group,name:'Mi grupo',conversationTimestamp:120},{timestamp:120});
 db.message(message(lid,'latest',130,{imageMessage:{caption:'Foto reciente'}}));
 const telegram={admins:()=>new Set(['1']),permissions:()=>new Set()};
 const panel=new WebPanel(store,{live:new Map()},telegram,{url:'http://test',allowedOrigins:new Set()});
 const results=panel.chatList.page(a.id,db);
 const contact=results.items.find(c=>c.peer===pn);
 assert.ok(contact,'LID should resolve to the known number JID');
 assert.equal(results.items.filter(c=>c.peer===pn).length,1);
 assert.equal(contact.name,'Nombre elegido');
 assert.equal(contact.phone,'+12025550129');
 assert.equal(contact.preview,'Foto reciente');
 assert.equal(contact.timestamp,130);
 assert.equal(contact.unread,2);
 assert.equal(results.items.find(c=>c.peer===group),undefined,'WhatsApp panel omits legacy groups');
 assert.equal(panel.chatList.page(b.id,new BaileysStore(store,b.id)).items.length,0);
});
test('search and browsing snapshots refresh after TTL and do not keep deleted data indefinitely',t=>{
 const {store,a,db}=setup(t);let now=1000;
 db.put('chat',pn,{id:pn,name:'Contacto inicial',conversationTimestamp:100},{timestamp:100});
 const list=new PanelChatList(store,{name:(_id,peer)=>db.get('chat',peer).name,url:()=>'/avatar'},{
  now:()=>now,ttl:1000
 });
 assert.equal(list.page(a.id,db).items[0].name,'Contacto inicial');
 const other='12025550131@s.whatsapp.net';
 db.put('chat',other,{id:other,name:'Chat nuevo',conversationTimestamp:200},{timestamp:200});
 assert.equal(list.page(a.id,db).items.length,1);
 now+=1001;
 assert.equal(list.page(a.id,db).items.length,2);
 assert.equal(list.page(a.id,db).items[0].name,'Chat nuevo');
});
test('the optimized endpoint keeps the existing per-user authorization boundary',async t=>{
 const {store,a,b,db}=setup(t);
 const peer=pn;db.put('chat',peer,{id:peer,name:'Visible',conversationTimestamp:100});
 const panel=new WebPanel(store,{live:new Map()},{
  admins:()=>new Set(['1']),permissions:()=>new Set(['2'])
 },{url:'http://test',secure:false,allowedOrigins:new Set()});
 const session=panel.access.login(panel.access.token('2','login'));
 const get=async account=>{
  let code,raw;
  const req={method:'GET',headers:{cookie:'wa_panel='+session.secret},socket:{remoteAddress:'127.0.0.1'},
   url:'/api/panel/chats?account='+account+'&offset=0'};
  const res={writeHead(value){code=value;},end(value){raw=value;}};
  await panel.handle(req,res,'/api/panel/chats',{},async()=>({}));
  return {code,data:JSON.parse(raw)};
 };
 const denied=await get(a.id);assert.equal(denied.code,404);
 const token=panel.access.token('2','referral');
 panel.access.attach(a.id,token);
 const allowed=await get(a.id);assert.equal(allowed.code,200);
 assert.equal(allowed.data.items[0].name,'Visible');
 assert.equal((await get(b.id)).code,404);
 store.revoke(a.id);
 assert.equal((await get(a.id)).code,404);
});
test('the panel preserves chat/gallery paths and avoids background directory refreshes inside a chat',()=>{
 const script=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/panel.js',import.meta.url),'utf8');
 assert.match(script,/screen==='chats'.*Date\.now\(\)-lastChatsAt>=30000/);
 assert.match(script,/querySelectorAll\('\.chat-item'\)\.length<=50/);
 assert.match(script,/screen==='thread'\)await messages\(\)/);
 assert.match(script,/const chatRequests=new Set\(\)/);
 assert.match(script,/se conserva la lista anterior/);
 assert.match(server,/route==='\/api\/panel\/gallery'/);
 assert.match(server,/route==='\/api\/panel\/messages'/);
});
