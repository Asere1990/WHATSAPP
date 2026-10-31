import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {AssociatedLinks} from '../src/associated-links.js';
import {AssociatedPopupBot} from '../src/associated-popup-bot.js';
import {alertCopy,renderAssociatedAlert} from '../src/associated-alert.js';

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-associated-alert-'));
 const store=new Store(dir),links=new AssociatedLinks(store),messages=[],previews=[];
 const bot={store,accounts:{dir},pending:new Map(),
  send:async(...args)=>{messages.push(args);return args;},
  sendFile:async(...args)=>{previews.push(args);return args;}
 };
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,links,messages,previews,bot,flow:new AssociatedPopupBot(bot)};
}

test('informational red alert is clearly branded and renders in the existing image dimensions',async()=>{
 const image=await renderAssociatedAlert('Aviso de mantenimiento','SecurityWhat realizará un mantenimiento programado.');
 const {default:sharp}=await import('sharp');
 const info=await sharp(image).metadata();
 assert.equal(info.width,1370);
 assert.equal(info.height,2048);
 assert.equal(info.format,'png');
 assert.ok(image.length<2*1024*1024);
 assert.equal(alertCopy('  Mensaje    nuevo ',72,'Cabecera'),'Mensaje nuevo');
 await assert.rejects(()=>renderAssociatedAlert('Intento de inicio de sesión detectado','Aviso falso'),/no simules/);
});

test('ADD POPUP ALERT runs title, text, preview and confirmation before creating the short URL',async t=>{
 const {bot,flow,links,previews,messages,dir}=setup(t),key='1:1',phone='5351234567';
 const other=links.save('5357654321','text','El popup B no se modifica');
 await flow.start(1,key);
 await flow.input(1,key,bot.pending.get(key),{text:phone});
 const buttons=messages.at(-1)[2].inline_keyboard.flat();
 assert.equal(buttons.find(x=>x.text==='ADD POPUP ALERT')?.callback_data,'assoc:alert-start:'+phone);
 assert.equal(links.get(phone),null);
 await flow.callback(1,key,'assoc:alert-start:'+phone);
 assert.equal(bot.pending.get(key).stage,'alert-title');
 await flow.input(1,key,bot.pending.get(key),{text:'Aviso de mantenimiento'});
 assert.equal(bot.pending.get(key).stage,'alert-text');
 await flow.input(1,key,bot.pending.get(key),{text:'Te informamos de una actualización programada.'});
 assert.equal(bot.pending.get(key).stage,'alert-confirm');
 assert.equal(previews.length,1);
 assert.equal(previews[0][1].mime,'image/png');
 assert.match(previews[0][1].caption,/SecurityWhat/);
 assert.equal(links.get(phone),null,'preview does not create the link');
 await flow.callback(1,key,'assoc:alert-edit-title:'+phone);
 assert.equal(bot.pending.get(key).stage,'alert-title');
 await flow.input(1,key,bot.pending.get(key),{text:'Novedades del servicio'});
 assert.equal(previews.length,2);
 await flow.callback(1,key,'assoc:alert-save:'+phone);
 const row=links.get(phone);
 assert.equal(row.kind,'photo');
 assert.match(row.content,/^\/portal-media\/[a-f0-9]{64}\.png$/);
 assert.ok(existsSync(path.join(dir,row.content.slice(1))));
 assert.equal(readFileSync(path.join(dir,row.content.slice(1))).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(bot.pending.has(key),false);
 assert.match(messages.at(-1)[1],/https:\/\/securitywhat\.app\/5351234567/);
 assert.equal(links.get(other.phone).content,'El popup B no se modifica');
});

test('cancelling an alert preview keeps the existing popup and existing link token',async t=>{
 const {bot,flow,links}=setup(t),key='1:1',phone='5351234567';
 const original=links.save(phone,'text','Contenido original');
 await flow.start(1,key,phone);
 await flow.callback(1,key,'assoc:alert-start:'+phone);
 await flow.input(1,key,bot.pending.get(key),{text:'Aviso informativo'});
 await flow.input(1,key,bot.pending.get(key),{text:'Información temporal del servicio.'});
 assert.equal(links.get(phone).content,'Contenido original');
 await flow.callback(1,key,'assoc:alert-cancel:'+phone);
 assert.equal(links.get(phone).content,'Contenido original');
 assert.equal(links.get(phone).token,original.token);
 assert.equal(bot.pending.get(key).stage,'content');
 await flow.callback(1,key,'assoc:alert-save:'+phone);
 assert.equal(links.get(phone).content,'Contenido original','stale save is ignored');
});
