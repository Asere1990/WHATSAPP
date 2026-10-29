import {AssociatedLinks,associatedUrl} from './associated-links.js';
import {savePageImage} from './page-editor.js';

// Only the admin's private Telegram chat can start this flow.
export class AssociatedPopupBot {
 constructor(bot){this.bot=bot;this._links=null;}
 get links(){return this._links||(this._links=new AssociatedLinks(this.bot.store));}
 keyboard(phone){
  const row=this.links.get(phone);
  return {inline_keyboard:[
   ...(row?.active?[[{text:'✏️ EDITAR POPUP',callback_data:'assoc:edit:'+phone}],
     [{text:'🗑 ELIMINAR POPUP',callback_data:'assoc:clear:'+phone}],
     [{text:'🚫 REVOCAR ENLACE',callback_data:'assoc:revoke:'+phone}]]:
     [[{text:'🔄 GENERAR NUEVO ENLACE',callback_data:'assoc:renew:'+phone}]]),
   [{text:'📋 MIS ENLACES ASOCIADOS',callback_data:'assoc:list:0'}],
   [{text:'🖼 POPUP GENÉRICO',callback_data:'assoc:generic'}],
   [{text:'➕ OTRO NÚMERO',callback_data:'assoc:start'}]
  ]};
 }
 async start(chat,key,phone=''){
  this.bot.pending.set(key,{kind:'associated',stage:phone?'content':'phone',...(phone?{phone}:{})});
  const message=phone?'Número: +'+phone+'\n\nEnvía un TEXTO (máximo 1000 caracteres) o una FOTO para su popup. El nuevo contenido reemplazará al anterior sin cambiar el enlace activo.\n\n/cancelar para salir.':
   '𝐂𝐑𝐄𝐀𝐑 𝐄𝐍𝐋𝐀𝐂𝐄 𝐀𝐒𝐎𝐂𝐈𝐀𝐃𝐎\n\nEnvía el número completo con código de país.\nEjemplo: +12025550123\n\nEl enlace será permanente hasta que lo revoques.\n/cancelar para salir.';
  return this.bot.send(chat,message);
 }
 async genericMenu(chat,key){
  this.bot.pending.delete(key);
  const popup=this.links.generic();
  const current=popup?(popup.kind==='photo'?'Foto configurada':popup.text):'Sin configurar. Las demás personas entrarán directamente a la web.';
  return this.bot.send(chat,'POPUP GENÉRICO · WHATSAPP\n\nContenido actual: '+current+'\n\nSolo se mostrará al segundo navegador y a los posteriores si lo configuras.',{
   inline_keyboard:[[{text:'✏️ CAMBIAR POPUP GENÉRICO',callback_data:'assoc:generic-edit'}],...(popup?[[{text:'🗑 ELIMINAR POPUP GENÉRICO',callback_data:'assoc:generic-clear'}]]:[]),[{text:'📋 MIS ENLACES ASOCIADOS',callback_data:'assoc:list:0'}]]
  });
 }
 async input(chat,key,pending,m){
  if(pending.stage==='generic'){
   let kind,content;
   if(m.photo?.length||m.document){
    kind='photo';
    try{content=await savePageImage(this.bot,m);}catch(e){return this.bot.send(chat,e.message);}
   }else if(typeof m.text==='string'&&m.text.trim()){kind='text';content=m.text;}
   else return this.bot.send(chat,'Envía un texto o una foto. /cancelar para salir.');
   try{this.links.saveGeneric(kind,content);}catch(e){return this.bot.send(chat,e.message);}
   this.bot.pending.delete(key);
   await this.bot.send(chat,'✅ Popup genérico actualizado. Los nuevos visitantes que no sean el primer navegador verán este contenido.');
   return this.genericMenu(chat,key);
  }
  if(pending.stage==='phone'){
   let phone;try{phone=this.links.normalize(m.text||'');}catch(e){return this.bot.send(chat,e.message);}
   this.bot.pending.set(key,{kind:'associated',stage:'content',phone});
   const previous=this.links.get(phone);
   return this.bot.send(chat,'Número: +'+phone+'\n\nEnvía el TEXTO (máximo 1000 caracteres) o la FOTO que aparecerá en el popup.\n\n'+(previous?.active?'El popup anterior será sustituido y conservarás el mismo enlace.':'Se creará un enlace permanente nuevo.')+'\n\n/cancelar para salir.');
  }
  if(pending.stage==='content'){
   let kind,value;
   if(m.photo?.length||m.document){
    kind='photo';
    try{value=await savePageImage(this.bot,m);}catch(e){return this.bot.send(chat,e.message);}
   }else if(typeof m.text==='string'&&m.text.trim()){
    kind='text';value=m.text;
   }else return this.bot.send(chat,'Envíame un texto o una foto. /cancelar para salir.');
   let row;
   try{row=this.links.save(pending.phone,kind,value);}catch(e){return this.bot.send(chat,e.message);}
   this.bot.pending.delete(key);
   return this.bot.send(chat,
    '✅ ENLACE ASOCIADO\nNúmero: +'+row.phone+'\nPopup: '+(kind==='photo'?'Foto':'Texto')+'\n\n'+associatedUrl(row.token)+'\n\nEste enlace permanece activo hasta que lo revoques. Si cambias el popup del mismo número, la dirección sigue siendo la misma.\n\nImportante: el enlace por sí solo no verifica quién lo abre.',
    this.keyboard(row.phone));
  }
  return this.bot.send(chat,'Pulsa 𝐂𝐑𝐄𝐀𝐑 𝐄𝐍𝐋𝐀𝐂𝐄 𝐀𝐒𝐎𝐂𝐈𝐀𝐃𝐎 para empezar.');
 }
 async list(chat,offset=0){
  const {rows,total}=this.links.list(offset,10);
  const page=rows.map((row,i)=>[{text:(offset+i+1)+'. +'+row.phone+' · '+(row.active?(row.kind==='none'?'SIN POPUP':row.kind==='photo'?'FOTO':'TEXTO'):'REVOCADO'),callback_data:'assoc:show:'+row.phone}]);
  const navigation=[];
  if(offset>0)navigation.push({text:'◀️ ANTERIOR',callback_data:'assoc:list:'+Math.max(0,offset-10)});
  if(offset+rows.length<total)navigation.push({text:'SIGUIENTE ▶️',callback_data:'assoc:list:'+(offset+10)});
  return this.bot.send(chat,'ENLACES ASOCIADOS · '+total+'\n\nSelecciona un número para ver, editar o revocar su enlace.',{
    inline_keyboard:[...page,...(navigation.length?[navigation]:[]),[{text:'➕ CREAR ENLACE ASOCIADO',callback_data:'assoc:start'}]]
  });
 }
 async show(chat,phone){
  const row=this.links.get(phone);
  if(!row)return this.bot.send(chat,'No hay un enlace asociado para ese número.');
  const link=row.active?associatedUrl(row.token):'Revocado. El enlace anterior ya no funciona.';
  return this.bot.send(chat,'ENLACE ASOCIADO\n\nNúmero: +'+phone+'\nEstado: '+(row.active?'ACTIVO':'REVOCADO')+'\nPopup: '+(row.kind==='text'?'Texto':row.kind==='photo'?'Foto':'Ninguno')+'\n\n'+link+'\n\nLa dirección se mantiene al editar el popup. Solo cambia al revocar y generar otra.',this.keyboard(phone));
 }
 async callback(chat,key,data){
  const [,action,value]=data.split(':');
  if(action==='start'){return this.start(chat,key);}
  if(action==='generic')return this.genericMenu(chat,key);
  if(action==='generic-clear')return this.bot.send(chat,'¿Eliminar el popup genérico? Los visitantes posteriores entrarán directamente a la página.',{inline_keyboard:[[{text:'SÍ, ELIMINAR',callback_data:'assoc:generic-clear-confirm'}],[{text:'CANCELAR',callback_data:'assoc:generic'}]]});
  if(action==='generic-clear-confirm'){this.links.clearGeneric();return this.genericMenu(chat,key);}
  if(action==='generic-edit'){
   this.bot.pending.set(key,{kind:'associated',stage:'generic'});
   return this.bot.send(chat,'Envía el TEXTO (máximo 1000 caracteres) o la FOTO del popup genérico. Puedes cambiarlo cuando quieras. /cancelar para salir.');
  }
  if(action==='cancel'){this.bot.pending.delete(key);return this.bot.send(chat,'Cancelado.');}
  if(action==='list'){this.bot.pending.delete(key);return this.list(chat,Math.min(100000,Math.max(0,Number(value)||0)));}
  let phone;try{phone=this.links.normalize(value);}catch{return this.bot.send(chat,'Número inválido.');}
  const row=this.links.get(phone);
  if(!row)return this.bot.send(chat,'Ese número no tiene un enlace asociado.');
  if(action==='show')return this.show(chat,phone);
  if(action==='edit')return this.start(chat,key,phone);
  if(action==='clear')return this.bot.send(chat,'¿Eliminar el popup de +'+phone+'?\nEl enlace permanecerá activo, pero dejará de mostrar un popup personalizado.',{inline_keyboard:[[{text:'SÍ, ELIMINAR POPUP',callback_data:'assoc:clear-confirm:'+phone}],[{text:'CANCELAR',callback_data:'assoc:show:'+phone}]]});
  if(action==='clear-confirm'){this.links.clear(phone);return this.show(chat,phone);}
  if(action==='revoke')return this.bot.send(chat,'¿Revocar permanentemente el enlace de +'+phone+'?\nEl enlace dejará de abrir la página. Se podrá generar otro distinto.',{inline_keyboard:[[{text:'SÍ, REVOCAR ENLACE',callback_data:'assoc:revoke-confirm:'+phone}],[{text:'CANCELAR',callback_data:'assoc:show:'+phone}]]});
  if(action==='revoke-confirm'){this.links.revoke(phone);return this.show(chat,phone);}
  if(action==='renew'){if(row.active)return this.show(chat,phone);this.links.renew(phone);return this.show(chat,phone);}
  return this.bot.send(chat,'Opción no disponible.');
 }
}
