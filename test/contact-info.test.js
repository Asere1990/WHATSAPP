import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {BaileysStore} from '../src/baileys-store.js';
import {PanelProfiles} from '../src/panel-profiles.js';
import {WebPanel} from '../src/panel.js';

const personal='12025550129@s.whatsapp.net',business='12025550130@s.whatsapp.net';
const group='120363777777777777@g.us';
function setup(t){
 const dir=mkdtempSync(tmpdir()+'/wa-contact-info-'),store=new Store(dir);
 const a=store.invite('12025550123','Prueba').account;
 const b=store.invite('12025550124','Otra').account;
 for(const row of [a,b]){
  store.update(row.id,'consent',1);
  store.update(row.id,'status','connected');
  store.db.prepare('UPDATE accounts SET confirmed=1 WHERE id=?').run(row.id);
 }
 const db=new BaileysStore(store,a.id);
 for(const [peer,name] of [[personal,'Contacto'],[business,'Negocio'],[group,'Grupo']]){
  db.put('chat',peer,{id:peer,name,conversationTimestamp:100});
  if(!peer.endsWith('@g.us'))db.put('contact',peer,{id:peer,name});
 }
 const calls=[];
 const accounts={dir,live:new Map([[a.id,{ready:true,client:{
  kind:'baileys',
  socket:{getBusinessProfile:async jid=>{
   calls.push(jid);
   if(jid===business)return {wid:jid,description:'Empresa de ejemplo',category:'Comercio'};
   return undefined;
  }}
 }}]])};
 const telegram={admins:()=>new Set(['1']),permissions:()=>new Set(['2'])};
 const panel=new WebPanel(store,accounts,telegram,{dir,url:'http://test',secure:false,allowedOrigins:new Set()});
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,a,b,db,accounts,panel,calls};
}
test('a confirmed business profile is Business, a successful empty profile is WhatsApp normal',async t=>{
 const {panel,a,calls}=setup(t);
 const company=await panel.contactInfo('1',a.id,business);
 assert.equal(company.name,'Negocio');
 assert.equal(company.phone,'+12025550130');
 assert.equal(company.type,'business');
 assert.equal(company.category,'Comercio');
 assert.equal(company.description,'Empresa de ejemplo');
 assert.deepEqual(company.detected,{photos:0,videos:0});
 const ordinary=await panel.contactInfo('1',a.id,personal);
 assert.equal(ordinary.type,'normal');
 assert.equal(ordinary.phone,'+12025550129');
 assert.equal(ordinary.category,'');
 assert.equal(ordinary.description,'');
 assert.deepEqual(calls,[business,personal]);
 const again=await panel.contactInfo('1',a.id,personal);
 assert.equal(again.type,'normal');
 assert.deepEqual(calls,[business,personal],'opening the card twice uses in-memory cache');
});

test('without WhatsApp connectivity, an unknown contact is not incorrectly labelled normal',async t=>{
 const {panel,a,accounts,db,calls}=setup(t);
 accounts.live.get(a.id).ready=false;
 assert.equal((await panel.contactInfo('1',a.id,personal)).type,'unknown');
 assert.deepEqual(calls,[]);
 db.put('contact',business,{id:business,isBusiness:true,description:'Empresa'});
 assert.equal((await panel.contactInfo('1',a.id,business)).type,'business');
});

test('Business lookup failures do not affect chats and are not treated as a personal profile',async t=>{
 const {panel,a,accounts}=setup(t);
 accounts.live.get(a.id).client.socket.getBusinessProfile=async()=>{throw Error('PROTOCOL_DOWN');};
 const result=await panel.contactInfo('1',a.id,personal);
 assert.equal(result.type,'unknown');
 assert.equal(result.name,'Contacto');
});

test('contact information is denied for other accounts, unknown peers and group conversations',async t=>{
 const {panel,a,b,calls}=setup(t);
 await assert.rejects(panel.contactInfo('2',a.id,personal),{status:404});
 await assert.rejects(panel.contactInfo('1',b.id,personal),{status:404});
 await assert.rejects(panel.contactInfo('1',a.id,'12025550199@s.whatsapp.net'),{status:404});
 await assert.rejects(panel.contactInfo('1',a.id,group),{status:404});
 assert.deepEqual(calls,[], 'no unauthorized lookup should reach WhatsApp');
});

test('GET profile detail uses the existing authenticated panel permission checks',async t=>{
 const {panel,a,b}=setup(t);
 const session=panel.access.login(panel.access.token('1','login'));
 const call=async(account,peer)=>{
  let status,output;
  const req={method:'GET',headers:{cookie:'wa_panel='+session.secret},socket:{remoteAddress:'127.0.0.1'},
   url:'/api/panel/contact-info?account='+account+'&peer='+encodeURIComponent(peer)};
  const res={writeHead(code){status=code;},end(body){output=body;}};
  await panel.handle(req,res,'/api/panel/contact-info',{},async()=>({}));
  return {status,data:JSON.parse(output)};
 };
 assert.equal((await call(a.id,business)).data.type,'business');
 assert.equal((await call(a.id,group)).status,404);
 assert.equal((await call(b.id,personal)).status,404);
});

test('contact card is separate from existing threads and no call/edit actions are introduced',()=>{
 const html=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
 assert.ok(html.includes('id="contact-info-trigger"'));
 assert.ok(html.includes('id="contact-info-dialog"'));
 assert.ok(html.includes('id="contact-info-type"'));
 assert.ok(html.includes('id="contact-info-close"'));
 assert.ok(html.includes('id="contact-info-gallery"'));
 assert.ok(script.includes("if(!chat||chat.group||!account)return"));
 assert.ok(script.includes("$('tab-gallery').click()"));
 assert.ok(html.includes('id="tab-messages"'));
 assert.ok(html.includes('id="tab-gallery"'));
 assert.equal(html.includes('id="contact-info-call"'),false);
 assert.equal(html.includes('id="contact-info-edit"'),false);
});
