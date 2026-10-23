import {randomBytes} from 'node:crypto';
import {parsePhoneNumberFromString} from 'libphonenumber-js';
import {escapeHTML} from './identity.js';
export class SystemMessages{
 constructor(bot){this.bot=bot;this.drafts=new Map();}
 cancel(key){this.drafts.delete(key);if(this.bot.pending.get(key)?.kind==='systemMessage')this.bot.pending.delete(key);}
 resolve(){
  const store=this.bot.store,configured=store.config().system_account;
  if(configured)return store.account(configured);
  const named=store.all().filter(a=>a.consent&&/^sistema$/i.test((a.name||'').trim()));
  if(named.length===1){store.setConfig('system_account',named[0].id);return named[0];}
  return null;
 }
 async start(chat,key){
  this.cancel(key);const a=this.resolve();
  if(!a?.consent){const accounts=this.bot.store.all().filter(a=>a.consent&&this.bot.accounts.live.get(a.id)?.ready);
   return this.bot.send(chat,'Selecciona una vez el número que enviará los mensajes del sistema. Si todavía no lo vinculaste, usa CONECTAR CUENTA.',{inline_keyboard:[...accounts.map(a=>[{text:`${a.name} · +${a.phone}`,callback_data:'sys:select:'+a.id}]),[{text:'CANCELAR',callback_data:'sys:cancel'}]]});
  }
  this.bot.accounts.tools.client(a.id,true);
  this.bot.pending.set(key,{kind:'systemMessage',stage:'number',id:a.id,expires:Date.now()+300000});
  return this.bot.send(chat,`MENSAJE DE SISTEMA PARA\nDesde: +${a.phone}\n\nEscribe el número de destino con + y código de país. Ejemplo: +12025550123.\n/cancelar para salir.`,{inline_keyboard:[[{text:'CANCELAR',callback_data:'sys:cancel'}]]});
 }
 async callback(chat,key,data){
  if(data==='sys:cancel'){this.cancel(key);return this.bot.send(chat,'Cancelado.',this.bot.menu());}
  if(data.startsWith('sys:select:')){
   const a=this.bot.store.account(data.slice(11));if(!a?.consent)throw Error('Cuenta no autorizada.');this.bot.accounts.tools.client(a.id,true);
   this.bot.store.setConfig('system_account',a.id);return this.start(chat,key);
  }
  if(data.startsWith('sys:send:')){
   const draft=this.drafts.get(key);if(!draft||draft.token!==data.slice(9)||draft.expires<Date.now())throw Error('La vista previa venció o ya fue enviada.');
   this.drafts.delete(key);
   if(this.bot.store.config().system_account!==draft.id)throw Error('Cambió el número del sistema. Prepara el mensaje de nuevo.');
   this.bot.accounts.tools.client(draft.id,true);
   await this.bot.deliver(draft.message,draft.id,draft.peer);
   return this.bot.send(chat,'Mensaje de sistema enviado a WhatsApp. Las respuestas nuevas llegarán al grupo CHATS configurado.',this.bot.menu());
  }
  throw Error('Opción no disponible.');
 }
 async input(chat,key,pending,m){
  if(pending.expires<Date.now()){this.cancel(key);throw Error('El envío venció. Pulsa MENSAJE DE SISTEMA PARA de nuevo.');}
  if(this.bot.store.config().system_account!==pending.id){this.cancel(key);throw Error('Cambió el número del sistema. Comienza de nuevo.');}
  this.bot.accounts.tools.client(pending.id,true);
  if(pending.stage==='number'){
   const raw=m.text?.trim()||'',number=/^\+[1-9][0-9 ()-]{6,22}$/.test(raw)&&parsePhoneNumberFromString(raw);
   if(!number||!number.isValid())throw Error('Número inválido. Ejemplo: +12025550123 (incluye + y código de país).');
   pending.peer=number.number.slice(1)+'@c.us';pending.phone=number.number.slice(1);pending.stage='message';pending.expires=Date.now()+300000;
   return this.bot.send(chat,`Para: +${pending.phone}\n\nEscribe el mensaje. Puedes mandar una foto, un video o un audio; también texto o un archivo. Una pieza por envío, con comentario opcional.\nVerás una confirmación antes de enviarlo. /cancelar para salir.`,{inline_keyboard:[[{text:'CANCELAR',callback_data:'sys:cancel'}]]});
  }
  if(m.media_group_id)throw Error('Envía una sola foto o video por mensaje; este envío no admite álbumes.');
  const file=m.photo?.at(-1)||m.video||m.audio||m.voice||m.document,text=m.text||m.caption||'';
  if(!file&&!text.trim())throw Error('Envía texto, foto, video, audio o archivo.');
  if(text.length>(file?900:3000))throw Error(file?'El comentario admite hasta 900 caracteres.':'El texto admite hasta 3000 caracteres.');
  if(file?.file_size>20*1024*1024)throw Error('El archivo admite hasta 20 MB.');
  for(const [k,d]of this.drafts)if(d.expires<Date.now())this.drafts.delete(k);
  const token=randomBytes(10).toString('hex'),message={chat:{id:chat}};
  for(const field of ['text','caption','photo','video','audio','voice','document'])if(m[field]!==undefined)message[field]=m[field];
  this.drafts.set(key,{id:pending.id,peer:pending.peer,message,token,expires:Date.now()+300000});this.bot.pending.delete(key);
  const kind=m.photo?'Foto':m.video?'Video':m.voice?'Nota de voz':m.audio?'Audio':m.document?'Archivo':'Texto';
  return this.bot.api('sendMessage',{chat_id:chat,parse_mode:'HTML',text:`<b>VISTA PREVIA · MENSAJE DE SISTEMA</b>\nDesde: +${escapeHTML(this.bot.store.account(pending.id).phone)}\nPara: +${escapeHTML(pending.phone)}\nTipo: ${kind}\n\n${escapeHTML(text||'[Sin comentario]')}\n\n¿Enviar?`,reply_markup:{inline_keyboard:[[{text:'CONFIRMAR ENVÍO',callback_data:'sys:send:'+token}],[{text:'CANCELAR',callback_data:'sys:cancel'}]]}});
 }
}
