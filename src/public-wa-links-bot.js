import {PublicWhatsAppLinks} from './public-wa-links.js';
import {publicPopupPhoto} from './public-wa-photo.js';
import {sendEditorImage} from './editor-image.js';
import {savePageImage} from './page-editor.js';
import {PublicWaSender,publicWaCountry,publicWaDestination} from './public-wa-send.js';
import {renderPublicWaCopy} from './public-wa-copy.js';

// Public code/link management is isolated from WhatsApp/Meta sessions.
// The existing administrator and permisos.txt handlers remain unchanged.
export class PublicWaLinkBot {
  constructor(bot){this.bot=bot;this._links=null;}
  get links(){return this._links||(this._links=new PublicWhatsAppLinks(this.bot.store));}
  get sender(){return this._sender||(this._sender=new PublicWaSender(this.bot.store,this.bot.accounts,this.links));}
  copy(key,data={}){return renderPublicWaCopy(this.links.texts()[key]||'',data);}
  button(key){return this.copy(key).slice(0,64);}
  key(chat,actor){return String(chat)+':'+String(actor);}
  async start(chat,key){
    this.bot.pending.delete(key);
    const t=this.links.texts();
    return this.bot.send(chat,t.choose,{inline_keyboard:[
      [{text:this.button('buttonWhatsApp'),callback_data:'pwa:whatsapp'}],
      [{text:this.button('buttonCubamax'),callback_data:'pwa:cubamax'}],
      [{text:this.button('buttonMyLinks'),callback_data:'pwa:list:0'}]
    ]});
  }
  async askCode(chat,key){
    this.bot.pending.set(key,{kind:'publicWaCode',started:Date.now()});
    return this.bot.send(chat,this.copy('message1')+'\n\n'+this.copy('codeHelp'));
  }
  keyboard(code){
    const ref=code?this.links.callbackRef(code):'';
    return {inline_keyboard:[
      [{text:this.button('buttonViewLinks'),callback_data:'pwa:list:0'}],
      ...(code?[[{text:this.button('buttonSendLink'),callback_data:'pwa:send:'+ref}],
        [{text:this.button('buttonAssociatedAccounts'),callback_data:'pwa:accounts:'+ref}],
        [{text:this.button('buttonRevoke'),callback_data:'pwa:revoke:'+ref}],
        [{text:this.button('buttonDelete'),callback_data:'pwa:delete:'+ref}]]:[]),
      [{text:this.button('buttonCreateAnother'),callback_data:'pwa:create'}],
      [{text:this.button('buttonSites'),callback_data:'pwa:menu'}]
    ]};
  }
  async askOwnPhoto(chat,key,code,reason=''){
    this.bot.pending.set(key,{kind:'publicWaPhoto',code,started:Date.now()});
    const message=(reason?reason+'\n\n':'')+this.copy('ownPhoto');
    return this.bot.send(chat,message+'\n\n'+this.copy('cancelHelp'));
  }
  async completeLink(chat,key,actor,code,photo,ownPhoto=false){
    // Always show the picture the first visitor will see before issuing a URL.
    // User-supplied pictures are kept byte-for-byte as uploaded.
    await sendEditorImage(this.bot,chat,photo,
      '🖼 '+this.copy('preview')+'\n\n'+
      (ownPhoto?this.copy('ownPhotoNotice')+'\n\n':'')+
      this.copy('firstOnly'));
    const row=this.links.create(actor,code,photo);
    this.bot.pending.delete(key);
    await this.bot.send(chat,'✅ '+this.copy('delivered')+'\n\n'+this.links.url(row.code)+
      '\n\n'+this.copy('firstOnly'),this.keyboard(row.code));
    // El enlace ya existe. El nuevo flujo de envío NO altera su contenido ni las cuentas.
    return this.askCountry(chat,key,actor,row.code);
  }

  async askCountry(chat,key,actor,code){
    const row=this.links.owned(actor,code);
    if(!row?.enabled)return this.bot.send(chat,'Este enlace no está activo.');
    this.bot.pending.set(key,{kind:'publicWaCountry',code,actor:String(actor)});
    return this.bot.send(chat,'🌎 ¿A qué país deseas enviar el enlace por WhatsApp?\n\nEscribe el nombre del país, por ejemplo: Cuba.\n\n/cancelar para salir.',{
      inline_keyboard:[[{text:this.button('buttonSkip'),callback_data:'pwa:send-skip'}]]
    });
  }
  async inputCountry(chat,key,actor,pending,m){
    let country;
    try{country=publicWaCountry(m.text||'');}
    catch(error){return this.bot.send(chat,error.message);}
    this.bot.pending.set(key,{kind:'publicWaPhone',code:pending.code,actor:String(actor),country});
    return this.bot.send(chat,'📱 País: '+country.name+'\n\nEscribe el número de WhatsApp del destinatario.\nPuede incluir el código internacional o ser un número local de '+country.name+'.\n\n/cancelar para salir.');
  }
  async inputPhone(chat,key,actor,pending,m){
    let recipient;
    try{recipient=publicWaDestination(pending.country.iso,m.text||'');}
    catch(error){return this.bot.send(chat,error.message);}
    let sender;
    try{sender=this.sender.source();}
    catch(error){return this.bot.send(chat,'⚠️ '+error.message+'\n\nTu enlace ya está creado. Puedes usar el botón ENVIAR POR WHATSAPP cuando la cuenta de envío esté conectada.');}
    let message;
    try{message=this.sender.message(pending.code);}
    catch(error){return this.bot.send(chat,'⚠️ '+error.message);}
    this.bot.pending.set(key,{kind:'publicWaConfirm',code:pending.code,actor:String(actor),
      recipient:recipient.phone,country:recipient.country,source:sender.id});
    return this.bot.send(chat,this.copy('sendPreviewTitle')+'\n\n'+message+
      '\n\n————————\n'+this.copy('sendPreviewDestination',{numero:recipient.e164,pais:recipient.country})+
      '\n\n'+this.copy('sendPreviewConsent'),{
        inline_keyboard:[[{text:this.button('buttonConfirmSend'),callback_data:'pwa:send-confirm'}],
          [{text:this.button('buttonCancel'),callback_data:'pwa:send-skip'}]]
      });
  }
  async input(chat,key,actor,m){
    const pending=this.bot.pending.get(key);
    if(pending?.kind==='publicWaCountry')return this.inputCountry(chat,key,actor,pending,m);
    if(pending?.kind==='publicWaPhone')return this.inputPhone(chat,key,actor,pending,m);
    if(pending?.kind==='publicWaPhoto'){
      if(!m.photo?.length&&!m.document)
        return this.bot.send(chat,this.links.texts().ownPhoto);
      try{
        const original=await savePageImage(this.bot,m);
        // This is the manual fallback; no OCR recoloring, layout edits,
        // or date replacement is applied to the person's own image.
        return await this.completeLink(chat,key,actor,pending.code,original,true);
      }catch(error){
        console.warn('WHATSAPP: public_own_popup_photo_failed',JSON.stringify({code:pending.code,error:error?.code||error?.name||'ERROR'}));
        return this.bot.send(chat,(error?.message||'No pude recibir esa imagen.')+'\n\n'+this.links.texts().ownPhoto);
      }
    }
    const raw=m.text?.trim()||'';
    if(!raw)return this.bot.send(chat,'Escribe tu código en un mensaje de texto.');
    let code;
    try{code=this.links.normalize(raw);}catch(e){return this.bot.send(chat,e.message);}
    if(this.links.record(code))return this.bot.send(chat,'Ese código ya se está utilizando. Elige otro.');
    const photo=this.links.sourcePhoto();
    if(!photo)return this.askOwnPhoto(chat,key,code,'No hay foto predeterminada disponible.');
    let derived;
    try{
      await this.bot.api('sendChatAction',{chat_id:chat,action:'upload_photo'}).catch(()=>{});
      derived=await publicPopupPhoto(this.bot.store,this.bot.accounts.dir,photo,new Date());
    }catch(error){
      console.warn('WHATSAPP: public_default_popup_ocr_unavailable',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
      return this.askOwnPhoto(chat,key,code,'No pude actualizar automáticamente la fecha y la hora de la foto predeterminada.');
    }
    try{
      return await this.completeLink(chat,key,actor,code,derived.asset);
    }catch(error){
      console.error('WHATSAPP: public_link_create_failed',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
      return this.bot.send(chat,'No fue posible generar el enlace. '+(error?.message||'Inténtalo de nuevo.')+'\n\nNo se modificó ninguna cuenta conectada.');
    }
  }
  async list(chat,actor,offset=0){
    const records=this.links.list(actor,offset);
    const rows=records.map(x=>[{text:x.code.slice(0,36)+(x.code.length>36?'…':'')+' · '+(x.enabled?'ACTIVO':'REVOCADO'),callback_data:'pwa:show:~'+x.link_id}]);
    return this.bot.send(chat,'MIS ENLACES · WHATSAPP\n\n'+(rows.length?'Elige uno para ver su estado y las cuentas asociadas.':'Todavía no has creado enlaces.'),{
      inline_keyboard:[...rows,
       ...(offset>0?[[{text:this.button('buttonPrevious'),callback_data:'pwa:list:'+Math.max(0,offset-12)}]]:[]),
       ...(records.length===12?[[{text:this.button('buttonNext'),callback_data:'pwa:list:'+(offset+12)}]]:[]),
       [{text:this.button('buttonCreate'),callback_data:'pwa:create'}],
       [{text:this.button('buttonBack'),callback_data:'pwa:menu'}]
      ]});
  }
  async show(chat,actor,code){
    const row=this.links.owned(actor,code);
    if(!row)return this.bot.send(chat,'Este enlace no te pertenece o fue eliminado.');
    const data=this.links.accounts(actor,code);
    return this.bot.send(chat,'ENLACE WHATSAPP\nCódigo: '+code+'\nEstado: '+(row.enabled?'ACTIVO':'REVOCADO')+
      '\nCuentas vinculadas voluntariamente: '+data.length+
      '\n\n'+(row.enabled?this.links.url(code):'Enlace revocado.')+
      '\n\nRevocar o eliminar el enlace NO desconecta cuentas de WhatsApp.',this.keyboard(code));
  }
  async accounts(chat,actor,code){
    const row=this.links.owned(actor,code);
    if(!row)return this.bot.send(chat,'Enlace no disponible.');
    const entries=this.links.accounts(actor,code);
    return this.bot.send(chat,'CUENTAS ASOCIADAS · '+code+'\n\n'+
      (entries.length?entries.map((a,i)=>`${i+1}. +${a.phone} · ${a.confirmed?'Conectada anteriormente':'En proceso'} · ${a.status}`).join('\n'):'Todavía no hay cuentas asociadas.')+
      '\n\nLa asociación es informativa; no concede acceso a las conversaciones.',{
        inline_keyboard:[[{text:this.button('buttonBack'),callback_data:'pwa:show:'+this.links.callbackRef(code)}]]
      });
  }
  async callback(chat,key,actor,data){
    const action=data.slice(4),parts=action.split(':'),verb=parts[0],value=parts.slice(1).join(':');
    if(verb==='menu')return this.start(chat,key);
    if(verb==='whatsapp'||verb==='create')return this.askCode(chat,key);
    if(verb==='cubamax'){
      this.bot.pending.delete(key);
      return this.bot.send(chat,'CUBAMAX\n\nhttps://cubamaxcom.online\n\nEl sistema de Cubamax conserva su funcionamiento actual.',{
        inline_keyboard:[[{text:this.button('buttonReturn'),callback_data:'pwa:menu'}]]
      });
    }
    if(verb==='send-skip'){
      this.bot.pending.delete(key);
      return this.bot.send(chat,'Enlace guardado. No se envió ningún mensaje.',this.keyboard());
    }
    if(verb==='send-confirm'){
      const pending=this.bot.pending.get(key);
      if(pending?.kind!=='publicWaConfirm'||pending.actor!==String(actor))
        return this.bot.send(chat,'La confirmación venció. Abre MIS ENLACES y elige ENVIAR POR WHATSAPP.');
      this.bot.pending.delete(key); // Un toque = un solo intento.
      try{
        const sent=await this.sender.send({actor,code:pending.code,phone:pending.recipient,source:pending.source});
        return this.bot.send(chat,'✅ Mensaje enviado por WhatsApp desde +'+sent.source+
          ' a +'+sent.phone+'.\n\nPuedes administrar este enlace desde MIS ENLACES.',this.keyboard(pending.code));
      }catch(error){
        return this.bot.send(chat,'⚠️ '+(error?.message||'No se pudo confirmar el envío.')+
          '\n\nTu enlace sigue activo.',this.keyboard(pending.code));
      }
    }
    if(verb==='list'){this.bot.pending.delete(key);return this.list(chat,actor,Math.min(100000,Math.max(0,Number(value)||0)));}
    const row=this.links.ownedRef(actor,value);
    if(!row)return this.bot.send(chat,'Ese enlace no está disponible para tu cuenta.');
    const code=row.code;
    if(verb==='show')return this.show(chat,actor,code);
    if(verb==='send')return this.askCountry(chat,key,actor,code);
    if(verb==='accounts')return this.accounts(chat,actor,code);
    if(verb==='revoke')return this.bot.send(chat,'¿Revocar '+code+'? El enlace dejará de abrir la web. Las cuentas ya conectadas NO serán desconectadas.',{
      inline_keyboard:[[{text:this.button('buttonConfirmRevoke'),callback_data:'pwa:revoke-yes:'+value}],[{text:this.button('buttonCancelAction'),callback_data:'pwa:show:'+value}]]
    });
    if(verb==='revoke-yes'){
      this.links.revoke(actor,code);
      return this.show(chat,actor,code);
    }
    if(verb==='delete')return this.bot.send(chat,'¿Eliminar definitivamente el enlace '+code+' y su historial de asociaciones? No se eliminarán cuentas conectadas.',{
      inline_keyboard:[[{text:this.button('buttonConfirmDelete'),callback_data:'pwa:delete-yes:'+value}],[{text:this.button('buttonCancelAction'),callback_data:'pwa:show:'+value}]]
    });
    if(verb==='delete-yes'){
      this.links.delete(actor,code);
      return this.list(chat,actor);
    }
    return this.bot.send(chat,'Opción no disponible.');
  }
}
