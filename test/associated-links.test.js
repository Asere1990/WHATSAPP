import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {AssociatedLinks,associatedUrl} from '../src/associated-links.js';
import {AssociatedPopupBot} from '../src/associated-popup-bot.js';
import {Telegram} from '../src/telegram.js';

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-associated-')),store=new Store(dir),links=new AssociatedLinks(store);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,links};
}
test('associated links use phone-number URLs while retaining separate internal tokens and popups',t=>{
 const {links}=setup(t),phone='+12025550123';
 const first=links.save(phone,'text','Primera información');
 assert.equal(first.phone,'12025550123');
 assert.match(first.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(associatedUrl(first.phone),'https://securitywhat.app/12025550123');
 assert.deepEqual(links.popup(first.token),{kind:'text',text:'Primera información'});
 const second=links.save(phone,'text','Segunda información');
 assert.equal(second.token,first.token);
 assert.deepEqual(links.popup(first.token),{kind:'text',text:'Segunda información'});
 assert.deepEqual(links.list().rows.map(x=>x.phone),['12025550123']);
 assert.equal(links.find('not-a-valid-secret'),null);
});
test('photo/text updates, clearing popup, revoking and renewing are independent',t=>{
 const {links}=setup(t),phone='+12025550124';
 const photo='/portal-media/'+'a'.repeat(64)+'.png',row=links.save(phone,'photo',photo);
 assert.deepEqual(links.popup(row.token),{kind:'photo',photo});
 assert.equal(links.clear(phone),true);
 assert.equal(links.popup(row.token),null);
 assert.equal(links.get(phone).token,row.token);
 links.save(phone,'text','Se reactivó el popup');
 assert.equal(links.get(phone).token,row.token);
 assert.equal(links.revoke(phone),true);
 assert.equal(links.find(row.token),null);
 assert.equal(links.popup(row.token),null);
 const changed=links.renew(phone);
 assert.notEqual(changed.token,row.token);
 assert.equal(links.find(row.token),null);
 assert.deepEqual(links.popup(changed.token),{kind:'text',text:'Se reactivó el popup'});
 assert.equal(links.revoke(phone),true);
 const recreated=links.save(phone,'text','Nuevo enlace después de revocar');
 assert.notEqual(recreated.token,changed.token);
});
test('associated popup is suppressed when the phone has confirmed linked status',t=>{
 const {links,store}=setup(t),phone='12025550125',row=links.save(phone,'text','Solo sin vincular');
 assert.deepEqual(links.popup(row.token),{kind:'text',text:'Solo sin vincular'});
 const account=store.invite(phone,'Cuenta de prueba').account;
 store.update(account.id,'consent',1);
 store.update(account.id,'status','connected');
 assert.equal(links.linked(phone),true);
 assert.equal(links.popup(row.token),null);
 store.update(account.id,'status','disconnected');
 assert.equal(links.popup(row.token),null,'confirmed linked remains hidden during disconnection');
 store.update(account.id,'status','revoked');
 assert.deepEqual(links.popup(row.token),{kind:'text',text:'Solo sin vincular'});
});
test('associated popup input never accepts external images or invalid phone numbers',t=>{
 const {links}=setup(t);
 assert.throws(()=>links.save('not a number','text','x'),/número/);
 assert.throws(()=>links.save('12025550123','photo','https://example.com/photo.jpg'),/foto/);
 assert.throws(()=>links.save('12025550123','text','x'.repeat(1001)),/1000/);
 assert.equal(links.get('12025550123'),null);
});
test('admin bot can create, edit, clear and revoke a WhatsApp-only associated link',async t=>{
 const {store,links}=setup(t),sent=[],bot={store,pending:new Map(),send:async(...args)=>{sent.push(args);return args},accounts:{dir:'/tmp'}};
 const flows=new AssociatedPopupBot(bot),key='1:1';
 await flows.start(1,key);
 assert.equal(bot.pending.get(key).stage,'phone');
 await flows.input(1,key,bot.pending.get(key),{text:'+12025550129'});
 assert.equal(bot.pending.get(key).phone,'12025550129');
 await flows.input(1,key,bot.pending.get(key),{text:'Información personalizada'});
 const saved=flows.links.get('12025550129');
 assert.match(sent.at(-1)[1],/https:\/\/securitywhat\.app\/12025550129/);
 assert.doesNotMatch(sent.at(-1)[1],new RegExp(saved.token));
 assert.equal(bot.pending.has(key),false);
 await flows.start(1,key,'12025550129');
 await flows.input(1,key,bot.pending.get(key),{text:'Texto actualizado'});
 assert.equal(flows.links.get('12025550129').token,saved.token);
 assert.equal(flows.links.popup(saved.token).text,'Texto actualizado');
 await flows.callback(1,key,'assoc:clear-confirm:12025550129');
 assert.equal(flows.links.popup(saved.token),null);
 await flows.callback(1,key,'assoc:revoke-confirm:12025550129');
 assert.equal(flows.links.find(saved.token),null);
 await flows.callback(1,key,'assoc:renew:12025550129');
 assert.ok(flows.links.get('12025550129').token!==saved.token);
});
test('operator cannot start the admin-only associated flow by forging a Telegram callback',async t=>{
 const {store}=setup(t),bot=new Telegram(store,{token:'demo',panel:'-1001',storage:'-1002'}),sent=[];
 bot.admins=()=>new Set(['1']);bot.permissions=()=>new Set(['2']);
 bot.api=async()=>({ok:true});bot.send=async(...args)=>sent.push(args);
 await bot.handle({callback_query:{id:'a',from:{id:2,first_name:'Operator'},data:'assoc:start',message:{chat:{id:2,type:'private'}}}});
 assert.equal(bot.pending.size,0);
 await bot.handle({callback_query:{id:'b',from:{id:1,first_name:'Admin'},data:'assoc:start',message:{chat:{id:1,type:'private'}}}});
 assert.equal(bot.pending.get('1:1')?.kind,'associated');
 await bot.handle({message:{from:{id:1,first_name:'Admin'},chat:{id:1,type:'private'},text:'/cancelar'}});
 assert.equal(bot.pending.size,0);
});

test('first browser sees personalized popup; another browser sees the editable generic popup',t=>{
 const {links,store,dir}=setup(t);
 const record=links.save('12025550131','text','Mensaje exclusivo de primer visitante');
 const first='A'.repeat(43),second='B'.repeat(43);
 const selected=links.popupFor(record.token,first);
 assert.deepEqual(selected,{kind:'text',text:'Mensaje exclusivo de primer visitante'});
 assert.deepEqual(links.popupFor(record.token,first),selected,'same browser keeps personal popup');
 assert.deepEqual(links.popupFor(record.token,second),links.generic());
 assert.notDeepEqual(links.popupFor(record.token,second),selected);
 assert.deepEqual(links.popupFor(record.token,undefined),links.generic());
 links.saveGeneric('text','Mensaje diferente para todos los demás');
 assert.deepEqual(links.popupFor(record.token,second),{kind:'text',text:'Mensaje diferente para todos los demás'});
 const again=new Store(dir),persisted=new AssociatedLinks(again);
 assert.deepEqual(persisted.popupFor(record.token,first),selected,'first visitor persisted across restart');
 assert.deepEqual(persisted.popupFor(record.token,second),{kind:'text',text:'Mensaje diferente para todos los demás'});
 again.db.close();
});

test('changing, clearing and revoking existing associated popups keeps their original semantics',t=>{
 const {links}=setup(t),first='C'.repeat(43),second='D'.repeat(43),phone='12025550132';
 const original=links.save(phone,'photo','/portal-media/'+'a'.repeat(64)+'.webp');
 assert.deepEqual(links.popupFor(original.token,first),{kind:'photo',photo:'/portal-media/'+'a'.repeat(64)+'.webp'});
 const updated=links.save(phone,'text','Actualizado');
 assert.equal(updated.token,original.token);
 assert.deepEqual(links.popupFor(updated.token,first),{kind:'text',text:'Actualizado'});
 assert.deepEqual(links.popupFor(updated.token,second),links.generic());
 links.clear(phone);
 assert.equal(links.popupFor(original.token,first),null,'existing delete behavior preserved');
 assert.equal(links.popupFor(original.token,second),null);
 links.save(phone,'text','Restaurado');
 assert.equal(links.popupFor(original.token,first).text,'Restaurado');
 assert.deepEqual(links.popupFor(original.token,second),links.generic());
 links.revoke(phone);
 assert.equal(links.popupFor(original.token,first),null);
 const changed=links.renew(phone);
 assert.notEqual(changed.token,original.token);
 assert.deepEqual(links.popupFor(changed.token,second),{kind:'text',text:'Restaurado'},'new link can identify its own first browser');
 assert.deepEqual(links.popupFor(changed.token,first),links.generic());
});

test('generic popup supports text and photo independently of personalized content',t=>{
 const {links}=setup(t),phone='12025550133',row=links.save(phone,'text','Solo primero');
 const first='F'.repeat(43),other='G'.repeat(43);
 assert.equal(links.popupFor(row.token,first).text,'Solo primero');
 const photo='/portal-media/'+'f'.repeat(64)+'.png';
 links.saveGeneric('photo',photo);
 assert.deepEqual(links.popupFor(row.token,other),{kind:'photo',photo});
 assert.equal(links.popupFor(row.token,first).text,'Solo primero');
 assert.throws(()=>links.saveGeneric('photo','https://invalid.example/p.png'),/foto/);
 assert.equal(links.generic().photo,photo);
});

test('Telegram admins can change the generic popup without changing old associated links',async t=>{
 const {store}=setup(t),messages=[],bot={store,pending:new Map(),send:async(...args)=>{messages.push(args);return args},accounts:{dir:'/tmp'}};
 const editor=new AssociatedPopupBot(bot),key='1:1';
 await editor.callback(1,key,'assoc:generic');
 assert.match(messages.at(-1)[1],/POPUP GENÉRICO/);
 await editor.callback(1,key,'assoc:generic-edit');
 assert.equal(bot.pending.get(key)?.stage,'generic');
 await editor.input(1,key,bot.pending.get(key),{text:'Nuevo mensaje general'});
 assert.equal(editor.links.generic().text,'Nuevo mensaje general');
 assert.equal(bot.pending.has(key),false);
 const original=editor.links.save('12025550134','text','Personalizado');
 const owner='H'.repeat(43),other='I'.repeat(43);
 assert.equal(editor.links.popupFor(original.token,owner).text,'Personalizado');
 assert.equal(editor.links.popupFor(original.token,other).text,'Nuevo mensaje general');
 assert.ok(new Telegram(store,{token:'test',panel:'-1'}).menu().inline_keyboard.some(row=>row.some(button=>button.callback_data==='assoc:generic')));
});

test('without a generic popup, only the first browser sees a popup',t=>{
 const {links}=setup(t),row=links.save('12025550145','text','Solo para primer navegador');
 const first='P'.repeat(43),second='Q'.repeat(43);
 assert.equal(links.generic(),null);
 assert.deepEqual(links.popupFor(row.token,first),{kind:'text',text:'Solo para primer navegador'});
 assert.equal(links.popupFor(row.token,second),null);
 links.saveGeneric('text','Popup configurado para los demás');
 assert.deepEqual(links.popupFor(row.token,second),{kind:'text',text:'Popup configurado para los demás'});
 links.clearGeneric();
 assert.equal(links.generic(),null);
 assert.equal(links.popupFor(row.token,second),null);
 assert.equal(links.popupFor(row.token,first).text,'Solo para primer navegador');
});

test('generic popup can be removed from Telegram and remains empty',async t=>{
 const {store}=setup(t),sent=[],bot={store,pending:new Map(),send:async(...args)=>{sent.push(args);return args},accounts:{dir:'/tmp'}};
 const flow=new AssociatedPopupBot(bot),key='1:1';
 await flow.callback(1,key,'assoc:generic');
 assert.match(sent.at(-1)[1],/Sin configurar/);
 flow.links.saveGeneric('text','Mensaje genérico para visitantes');
 await flow.callback(1,key,'assoc:generic-clear');
 assert.match(sent.at(-1)[1],/entrarán directamente/);
 await flow.callback(1,key,'assoc:generic-clear-confirm');
 assert.equal(flow.links.generic(),null);
 assert.match(sent.at(-1)[1],/Sin configurar/);
});

