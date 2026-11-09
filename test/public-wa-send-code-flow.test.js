import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {PublicWaLinkBot} from '../src/public-wa-links-bot.js';
import {PublicWaSender,publicWaSystemSendAllowed} from '../src/public-wa-send.js';

const systemAdminActor=readFileSync('admins.txt','utf8').split(/\r?\n/)
 .map(line=>line.split('#')[0].split(',')[0].trim())
 .find(id=>/^\d+$/.test(id));

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-send-fresh-code-'));
 const store=new Store(dir),events=[],outgoing=[];
 store.db.exec('CREATE TABLE IF NOT EXISTS panel_owners(account TEXT PRIMARY KEY,actor TEXT NOT NULL,created INTEGER NOT NULL)');
 const senderAccount=store.invite('17867707509','Sistema').account;
 store.update(senderAccount.id,'consent',1);
 store.update(senderAccount.id,'status','connected');
 const accounts={dir,live:new Map([[senderAccount.id,{ready:true}]]),
  send:async(...args)=>{outgoing.push(args);return {ok:true};}};
 const bot={store,accounts,pending:new Map(),
  send:async(...args)=>{events.push({kind:'telegram',args});return args;},
  api:async()=>true};
 const flow=new PublicWaLinkBot(bot);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,bot,flow,events,outgoing};
}

test('ENVIAR POR WHATSAPP requests a fresh code, country and phone before OCR popup preview and sends that exact URL',async t=>{
 const {store,bot,flow,events,outgoing}=setup(t);
 const actor=systemAdminActor,chat=actor,key=actor+':'+actor;
 const oldPhoto='/portal-media/'+'a'.repeat(64)+'.png';
 const newPhoto='/portal-media/'+'b'.repeat(64)+'.png';
 const previous=flow.links.create(actor,'enlace-predeterminado',oldPhoto);
 store.setConfig('wa_public_link_popup_photo',oldPhoto);
 const configured='Notificación de trabajo para el destinatario.\n\nhttps://securitywhat.app/enlace-predeterminado';
 store.setConfig('wa_public_invitation_message',configured);
 const generated=[],previews=[];
 flow.popupForSend=async(source,at)=>{
  generated.push({source,at});
  return {asset:newPhoto,replaced:2,issuedAt:at.toISOString()};
 };
 flow.previewPopup=async(c,asset,caption)=>{
  previews.push({chat:c,asset,caption});
  events.push({kind:'popup-photo',asset});
 };
 await flow.callback(chat,key,actor,'pwa:send:~'+previous.link_id);
 assert.equal(bot.pending.get(key).kind,'publicWaCode');
 assert.equal(bot.pending.get(key).sendFirst,true);
 assert.match(events.at(-1).args[1],/código/i);
 assert.equal(generated.length,0,'OCR must wait until after country and phone');
 await flow.input(chat,key,actor,{text:'Trabajo2026'});
 assert.equal(bot.pending.get(key).kind,'publicWaCountry');
 assert.equal(bot.pending.get(key).code,'trabajo2026');
 assert.equal(flow.links.record('trabajo2026'),null,'do not create the link prematurely');
 await flow.input(chat,key,actor,{text:'Cuba'});
 assert.equal(bot.pending.get(key).kind,'publicWaPhone');
 assert.equal(bot.pending.get(key).sendFirst,true);
 assert.equal(generated.length,0,'country step must not generate popup');
 await flow.input(chat,key,actor,{text:'51234567'});
 assert.equal(generated.length,1);
 assert.equal(generated[0].source,oldPhoto);
 assert.ok(generated[0].at instanceof Date);
 assert.equal(previews.length,1);
 assert.equal(previews[0].asset,newPhoto);
 assert.equal(flow.links.record('trabajo2026').photo,newPhoto);
 assert.equal(bot.pending.get(key).kind,'publicWaConfirm');
 assert.equal(bot.pending.get(key).code,'trabajo2026');
 const previewMessage=events.at(-1).args[1];
 assert.match(previewMessage,/https:\/\/securitywhat\.app\/trabajo2026/);
 assert.doesNotMatch(previewMessage,/https:\/\/securitywhat\.app\/enlace-predeterminado/);
 const firstVisitor='X'.repeat(43),secondVisitor='Y'.repeat(43);
 assert.deepEqual(flow.links.claimFirst('trabajo2026',firstVisitor),{kind:'photo',photo:newPhoto});
 assert.equal(flow.links.claimFirst('trabajo2026',secondVisitor),null);
 await flow.callback(chat,key,actor,'pwa:send-confirm');
 assert.equal(outgoing.length,1);
 assert.equal(outgoing[0][1],'5351234567@c.us');
 assert.equal(outgoing[0][2],'Notificación de trabajo para el destinatario.\n\nhttps://securitywhat.app/trabajo2026');
 assert.equal((outgoing[0][2].match(/https:\/\/securitywhat\.app\//g)||[]).length,1);
 assert.equal(flow.links.record('enlace-predeterminado').code,'enlace-predeterminado',
  'previous links remain unchanged');
 assert.equal(store.config().wa_public_invitation_message,configured,'editor text remains untouched');
 assert.equal(store.config().wa_public_link_popup_photo,oldPhoto,'OCR image setting remains unchanged');
});

test('the sender drops only an embedded old WhatsApp URL; all other editor text and media selection are preserved',t=>{
 const {store,flow}=setup(t);
 const sender=new PublicWaSender(store,flow.bot.accounts,flow.links);
 store.setConfig('wa_public_invitation_message',
  'Aviso laboral.\nSitio de referencia: https://example.org/instructions\nhttps://www.securitywhat.app/old-123');
 const value=sender.message('nuevo-unico');
 assert.match(value,/https:\/\/example\.org\/instructions/);
 assert.ok(value.endsWith('https://securitywhat.app/nuevo-unico'));
 assert.doesNotMatch(value,/old-123/);
 assert.equal((value.match(/securitywhat\.app/g)||[]).length,1);
});


test('a numeric code already used by a legacy WhatsApp link is rejected before country, phone or popup',async t=>{
 const {store,bot,flow,events}=setup(t);
 const actor=systemAdminActor,key=actor+':'+actor;
 const photo='/portal-media/'+'c'.repeat(64)+'.png';
 const previous=flow.links.create(actor,'anterior',photo);
 store.db.exec('CREATE TABLE IF NOT EXISTS wa_associated_links(phone TEXT PRIMARY KEY)');
 store.db.prepare('INSERT INTO wa_associated_links(phone) VALUES (?)').run('12025550123');
 let ocrCalls=0,popupCalls=0;
 flow.popupForSend=async()=>{ocrCalls++;return {asset:photo};};
 flow.previewPopup=async()=>{popupCalls++;};
 await flow.callback(actor,key,actor,'pwa:send:~'+previous.link_id);
 await flow.input(actor,key,actor,{text:'12025550123'});
 assert.equal(bot.pending.get(key).kind,'publicWaCode','keep asking for a valid code');
 assert.match(events.at(-1).args[1],/Ese código ya corresponde a un enlace existente/);
 assert.equal(ocrCalls,0);
 assert.equal(popupCalls,0);
 assert.equal(flow.links.record('12025550123'),null);
 await flow.input(actor,key,actor,{text:'nuevo-aviso-laboral'});
 assert.equal(bot.pending.get(key).kind,'publicWaCountry','another code should continue the same sequence');
});

test('a numeric code claimed after entry but before popup cannot leave a preview without continuation',async t=>{
 const {store,bot,flow,events}=setup(t);
 const actor=systemAdminActor,key=actor+':'+actor;
 const photo='/portal-media/'+'d'.repeat(64)+'.png';
 const previous=flow.links.create(actor,'anterior',photo);
 store.setConfig('wa_public_link_popup_photo',photo);
 store.db.exec('CREATE TABLE IF NOT EXISTS wa_associated_links(phone TEXT PRIMARY KEY)');
 let popupCalls=0;
 flow.previewPopup=async()=>{popupCalls++;};
 flow.popupForSend=async()=>{
   store.db.prepare('INSERT INTO wa_associated_links(phone) VALUES (?)').run('12025550124');
   return {asset:photo,replaced:2};
 };
 await flow.callback(actor,key,actor,'pwa:send:~'+previous.link_id);
 await flow.input(actor,key,actor,{text:'12025550124'});
 await flow.input(actor,key,actor,{text:'Cuba'});
 await flow.input(actor,key,actor,{text:'51234567'});
 assert.equal(popupCalls,0,'reject a now-reserved code before sending photo');
 assert.equal(flow.links.record('12025550124'),null);
 assert.equal(bot.pending.get(key).kind,'publicWaCode');
 assert.match(events.at(-1).args[1],/Ese código ya corresponde a un enlace existente/);
});


test('an unlinked WhatsApp recipient reaches the popup and send confirmation without customer-service authorization',async t=>{
 const {store,bot,flow,events,outgoing}=setup(t);
 const actor=systemAdminActor,key=actor+':'+actor,chat=actor;
 const photo='/portal-media/'+'c'.repeat(64)+'.png';
 const previous=flow.links.create(actor,'anterior-enlace',photo);
 store.setConfig('wa_public_link_popup_photo',photo);
 let popupCount=0;
 flow.popupForSend=async()=>({asset:photo,replaced:2});
 flow.previewPopup=async()=>{popupCount++;};
 // The SENDER may be unavailable, but the user must be able to finish the
 // recipient/code/popup preview without incorrectly treating the recipient
 // as an account that must be linked or approved here.
 const system=store.db.prepare('SELECT id FROM accounts WHERE phone=?').get('17867707509');
 bot.accounts.live.set(system.id,{ready:false});
 await flow.callback(chat,key,actor,'pwa:send:~'+previous.link_id);
 await flow.input(chat,key,actor,{text:'invitacion-trabajo'});
 await flow.input(chat,key,actor,{text:'Estados Unidos'});
 await flow.input(chat,key,actor,{text:'2025550199'});
 assert.equal(popupCount,1);
 assert.equal(flow.links.record('invitacion-trabajo')?.code,'invitacion-trabajo');
 assert.equal(bot.pending.get(key).kind,'publicWaConfirm');
 assert.match(events.at(-1).args[1],/https:\/\/securitywhat\.app\/invitacion-trabajo/);
 assert.ok(events.at(-1).args[2].inline_keyboard.flat().some(button=>button.callback_data==='pwa:send-confirm'));
 assert.equal(outgoing.length,0,'preview does not send the message');
 await flow.callback(chat,key,actor,'pwa:send-confirm');
 assert.equal(outgoing.length,0,'the system must not pretend an offline sender delivered the message');
 assert.match(events.at(-1).args[1],/REMITENTE/);
 assert.match(events.at(-1).args[1],/DESTINATARIO no necesita estar vinculado/);
});

test('unlisted users can create links but cannot send from system numbers, including old callbacks',async t=>{
 const {store,bot,flow,events,outgoing}=setup(t);
 const actor=['1122334455','2233445566','3344556677'].find(id=>!publicWaSystemSendAllowed(id));
 assert.ok(actor);
 const key=actor+':'+actor,photo='/portal-media/'+'e'.repeat(64)+'.png';
 const link=flow.links.create(actor,'enlace-propio',photo);
 const buttons=flow.keyboard(link.code).inline_keyboard.flat().map(button=>button.callback_data);
 assert.equal(buttons.some(data=>data?.startsWith('pwa:send:')),false);
 assert.ok(buttons.some(data=>data?.startsWith('pwa:accounts:')));
 await flow.callback(actor,key,actor,'pwa:whatsapp');
 assert.equal(bot.pending.get(key).kind,'publicWaCode','creating own links stays available');
 await flow.callback(actor,key,actor,'pwa:send:~'+link.link_id);
 assert.equal(bot.pending.has(key),false,'old sending buttons cannot enter the flow');
 assert.match(events.at(-1).args[1],/Solo los administradores/);
 bot.pending.set(key,{kind:'publicWaPhone',code:link.code,actor,country:{iso:'US',name:'Estados Unidos'}});
 await flow.input(actor,key,actor,{text:'2025550147'});
 assert.equal(bot.pending.has(key),false,'a previous send flow cannot be continued');
 bot.pending.set(key,{kind:'publicWaConfirm',code:link.code,actor,recipient:'12025550147'});
 await flow.callback(actor,key,actor,'pwa:send-confirm');
 assert.equal(bot.pending.has(key),false);
 const source=store.db.prepare('SELECT id FROM accounts WHERE phone=?').get('17867707509').id;
 await assert.rejects(()=>flow.sender.send({actor,code:link.code,phone:'12025550147',source}),/administradores/);
 assert.equal(outgoing.length,0);
 assert.equal(flow.links.record(link.code).enabled,1,'own link remains active');
});
