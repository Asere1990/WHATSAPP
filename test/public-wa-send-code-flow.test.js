import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {PublicWaLinkBot} from '../src/public-wa-links-bot.js';
import {PublicWaSender} from '../src/public-wa-send.js';

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
 const actor='123456789',chat=actor,key=actor+':'+actor;
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
