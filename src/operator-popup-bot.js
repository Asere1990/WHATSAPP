import {savePageImage} from './page-editor.js';
import {operatorPopupContent,updateOperatorPopup} from './operator-referral-popup.js';

const edits={
  title:'Envía el TÍTULO del popup (máximo 100 caracteres).',
  text:'Envía el TEXTO del popup (máximo 1000 caracteres).',
  button:'Envía el TEXTO del botón (máximo 65 caracteres).',
  color:'Envía el COLOR del botón en formato #RRGGBB.',
  photo:'Envía una FOTO PNG, JPG, GIF o WebP (máximo 2 MB). La foto cubrirá todo el popup sin bordes; el botón seguirá visible.'
};

export class OperatorPopupBot{
  constructor(bot){this.bot=bot;}
  async menu(chat){
    const p=operatorPopupContent(this.bot.store);
    return this.bot.send(chat,
      'POPUP PERMISOS.TXT\n\nEste popup se muestra en cada visita a los enlaces de vinculación creados por usuarios de permisos.txt. No modifica los popups de admins.txt.\n\nTítulo: '+p.title+
      '\nTexto: '+p.text+'\nBotón: '+p.button+'\nColor: '+p.color+'\nFoto: '+(p.photo?'Configurada':'Sin foto'),
      {inline_keyboard:[
        [{text:'✏️ TÍTULO',callback_data:'operator-popup:edit:title'}],
        [{text:'📝 TEXTO',callback_data:'operator-popup:edit:text'}],
        [{text:'🖼 FOTO COMPLETA',callback_data:'operator-popup:edit:photo'}],
        [{text:'🔘 BOTÓN',callback_data:'operator-popup:edit:button'}],
        [{text:'🎨 COLOR DEL BOTÓN',callback_data:'operator-popup:edit:color'}],
        ...(p.photo?[[{text:'🗑 QUITAR FOTO',callback_data:'operator-popup:clear-photo'}]]:[]),
        [{text:'↩ MENÚ PRINCIPAL',callback_data:'operator-popup:back'}]
      ]}
    );
  }
  async callback(chat,key,data){
    const action=data.slice('operator-popup:'.length);
    if(action==='back'){this.bot.pending.delete(key);return this.bot.control.home(chat,Number(key.split(':').at(-1)));}
    if(action==='menu'){this.bot.pending.delete(key);return this.menu(chat);}
    if(action==='clear-photo'){
      updateOperatorPopup(this.bot.store,'photo','');
      return this.menu(chat);
    }
    if(action.startsWith('edit:')&&Object.hasOwn(edits,action.slice(5))){
      const field=action.slice(5);
      this.bot.pending.set(key,{kind:'operatorPopup',field});
      return this.bot.send(chat,edits[field]+'\n\n/cancelar para salir.');
    }
    return this.menu(chat);
  }
  async input(chat,key,pending,m){
    const {field}=pending;
    try{
      const value=field==='photo'?await savePageImage(this.bot,m):m.text||'';
      updateOperatorPopup(this.bot.store,field,value);
      this.bot.pending.delete(key);
      await this.bot.send(chat,'✅ POPUP PERMISOS.TXT actualizado. Los nuevos visitantes verán el cambio.');
      return this.menu(chat);
    }catch(error){return this.bot.send(chat,error.message||'No se pudo guardar el popup.');}
  }
}
