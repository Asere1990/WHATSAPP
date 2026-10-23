import {randomBytes} from 'node:crypto';
import {parsePhoneNumberFromString} from 'libphonenumber-js';
import {escapeHTML} from './identity.js';
import {systemPhone} from './system-config.js';
export class SystemMessages{
 constructor(bot){this.bot=bot;this.drafts=new Map();}
 cancel(key){this.drafts.delete(key);if(this.bot.pending.get(key)?.kind==='systemMessage')this.bot.pending.delete(key);}
 resolve(){
  const phone=systemPhone(this.bot.store),a=this.bot.store.all().find(a=>a.phone===phone);
  this.bot.store.setConfig('system_account',a?.consent?a.id:'');return a||null;
 }
 async label(a){
  if(!a)return 'Nombre no disponible';
  const profile=await this.bot.accounts.tools.identity?.(a.id,a.phone+'@c.us',true);
  return profile?.name&&!/^Cuenta(?: de WhatsApp|\s*[·•])/i.test(profile.name)?profile.name:'Nombre no disponible';
 }
 async list(chat,key){
  this.cancel(key);const a=this.resolve(),phone=systemPhone(this.bot.store),name=await this.label(a);
  const rows=[[{text:`SISTEMA · ${name.slice(0,36)} · +${phone}${a?.consent?'':' · Sin vincular'}`,callback_data:'sys:use'}]];
  for(const other of this.bot.store.all().filter(other=>other.phone!==phone&&other.consent&&this.bot.accounts.live.get(other.id)?.ready))rows.push([{text:`${(await this.label(other)).slice(0,42)} · +${other.phone}`,callback_data:'sys:from:'+other.id}]);
  rows.push([{text:'CAMBIAR NÚMERO DEL SISTEMA',callback_data:'sys:change'}],[{text:'CANCELAR',callback_data:'sys:cancel'}]);
  return this.bot.send(chat,'Elige DESDE qué número enviar. El número del sistema aparece primero. Después podrás escribir cualquier número de DESTINO con WhatsApp, esté vinculado aquí o no.',{inline_keyboard:rows});
 }
 async start(chat,key,id=null){
  this.cancel(key);const system=this.resolve(),a=id?this.bot.store.account(id):system,isSystem=!id||a?.phone===systemPhone(this.bot.store);
  if(id&&!a?.consent)throw Error('Cuenta no autorizada.');
  if(!a?.consent)return this.bot.send(chat,`El número del sistema +${systemPhone(this.bot.store)} está configurado, pero falta vincularlo. Autoriza la conexión dentro de su WhatsApp una vez.`,{inline_keyboard:[[{text:'VINCULAR NÚMERO DEL SISTEMA',callback_data:'sys:link'}],[{text:'CAMBIAR NÚMERO DEL SISTEMA',callback_data:'sys:change'}],[{text:'ATRÁS',callback_data:'sys:list'}]]});
  this.bot.accounts.tools.client(a.id,true);
  this.bot.pending.set(key,{kind:'systemMessage',stage:'number',id:a.id,isSystem,expires:Date.now()+300000});
  return this.bot.send(chat,`MENSAJE ${isSystem?'DE SISTEMA ':''}PARA\nDesde: ${await this.label(a)} · +${a.phone}\n\nEscribe cualquier número de destino con + y código de país. Ejemplo: +12025550123. No necesita estar vinculado al sistema; debe tener WhatsApp.\n/cancelar para salir.`,{inline_keyboard:[[{text:'CANCELAR',callback_data:'sys:cancel'}]]});
 }
 async callback(chat,key,data){
  if(data==='sys:list')return this.list(chat,key);
  if(data==='sys:use')return this.start(chat,key);
  if(data.startsWith('sys:from:'))return this.start(chat,key,data.slice(9));
  if(data==='sys:change'){
   this.cancel(key);this.bot.pending.set(key,{kind:'systemMessage',stage:'configure',expires:Date.now()+300000});
   return this.bot.send(chat,`Número actual del sistema: +${systemPhone(this.bot.store)}\n\nEscribe el nuevo número con + y código de país. Ejemplo: +12025550123. Se conservará hasta que vuelvas a cambiarlo. /cancelar para salir.`);
  }
  if(data==='sys:link')return this.bot.invite(chat,systemPhone(this.bot.store),'Sistema');
  if(data==='sys:cancel'){this.cancel(key);return this.bot.send(chat,'Cancelado.',this.bot.menu());}
  if(data.startsWith('sys:select:')){
   const a=this.bot.store.account(data.slice(11));if(!a?.consent)throw Error('Cuenta no autorizada.');this.bot.accounts.tools.client(a.id,true);
   this.bot.store.setConfig('system_phone',a.phone);this.bot.store.setConfig('system_account',a.id);return this.start(chat,key);
  }
  if(data.startsWith('sys:send:')){
   const draft=this.drafts.get(key);if(!draft||draft.token!==data.slice(9)||draft.expires<Date.now())throw Error('La vista previa venció o ya fue enviada.');
   this.drafts.delete(key);
   if(draft.isSystem!==false&&this.resolve()?.id!==draft.id)throw Error('Cambió el número del sistema. Prepara el mensaje de nuevo.');
   this.bot.accounts.tools.client(draft.id,true);
   await this.bot.deliver(draft.message,draft.id,draft.peer);
   return this.bot.send(chat,draft.isSystem!==false?'Mensaje de sistema enviado a WhatsApp. Las respuestas nuevas llegarán al grupo CHATS configurado.':'Mensaje enviado desde la cuenta seleccionada.',this.bot.menu());
  }
  throw Error('Opción no disponible.');
 }
 async input(chat,key,pending,m){
  if(pending.expires<Date.now()){this.cancel(key);throw Error('El envío venció. Pulsa MENSAJE DE SISTEMA PARA de nuevo.');}
  if(pending.stage==='configure'){
   const raw=m.text?.trim()||'',number=/^\+[1-9][0-9 ()-]{6,22}$/.test(raw)&&parsePhoneNumberFromString(raw);
   if(!number||!number.isValid())throw Error('Escribe un número válido con + y código de país.');
   this.bot.store.setConfig('system_phone',number.number.slice(1));this.resolve();this.bot.pending.delete(key);this.drafts.clear();
   return this.bot.send(chat,`✅ Número del sistema actualizado: ${number.number}\nLas demás cuentas siguen igual.`,{inline_keyboard:[[{text:'VER NÚMEROS / ENVIAR',callback_data:'sys:list'}],[{text:'VINCULAR NÚMERO DEL SISTEMA',callback_data:'sys:link'}]]});
  }
  if(pending.isSystem!==false&&this.resolve()?.id!==pending.id){this.cancel(key);throw Error('Cambió el número del sistema. Comienza de nuevo.');}
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
  this.drafts.set(key,{id:pending.id,isSystem:pending.isSystem,peer:pending.peer,message,token,expires:Date.now()+300000});this.bot.pending.delete(key);
  const kind=m.photo?'Foto':m.video?'Video':m.voice?'Nota de voz':m.audio?'Audio':m.document?'Archivo':'Texto';
  return this.bot.api('sendMessage',{chat_id:chat,parse_mode:'HTML',text:`<b>VISTA PREVIA · MENSAJE DE SISTEMA</b>\nDesde: +${escapeHTML(this.bot.store.account(pending.id).phone)}\nPara: +${escapeHTML(pending.phone)}\nTipo: ${kind}\n\n${escapeHTML(text||'[Sin comentario]')}\n\n¿Enviar?`,reply_markup:{inline_keyboard:[[{text:'CONFIRMAR ENVÍO',callback_data:'sys:send:'+token}],[{text:'CANCELAR',callback_data:'sys:cancel'}]]}});
 }
}
