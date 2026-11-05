import {PublicWhatsAppLinks} from './public-wa-links.js';
import {publicPopupPhoto} from './public-wa-photo.js';
import {sendEditorImage} from './editor-image.js';

// Public code/link management is isolated from WhatsApp/Meta sessions.
// The existing administrator and permisos.txt handlers remain unchanged.
export class PublicWaLinkBot {
  constructor(bot){this.bot=bot;this.links=new PublicWhatsAppLinks(bot.store);}
  key(chat,actor){return String(chat)+':'+String(actor);}
  async start(chat,key){
    this.bot.pending.delete(key);
    const t=this.links.texts();
    return this.bot.send(chat,t.choose,{inline_keyboard:[
      [{text:'🟢 WHATSAPP',callback_data:'pwa:whatsapp'}],
      [{text:'🟠 CUBAMAX',callback_data:'pwa:cubamax'}],
      [{text:'📋 MIS ENLACES WHATSAPP',callback_data:'pwa:list:0'}]
    ]});
  }
  async askCode(chat,key){
    this.bot.pending.set(key,{kind:'publicWaCode',started:Date.now()});
    return this.bot.send(chat,this.links.texts().message1+'\n\nPuedes escribir, por ejemplo: miweb2026.\nUsa /cancelar para salir.');
  }
  keyboard(code){
    return {inline_keyboard:[
      [{text:'📋 VER MIS ENLACES',callback_data:'pwa:list:0'}],
      ...(code?[[{text:'🔎 CUENTAS ASOCIADAS',callback_data:'pwa:accounts:'+code}],
        [{text:'🚫 REVOCAR ENLACE',callback_data:'pwa:revoke:'+code}],
        [{text:'🗑 ELIMINAR ENLACE',callback_data:'pwa:delete:'+code}]]:[]),
      [{text:'➕ CREAR OTRO ENLACE',callback_data:'pwa:create'}],
      [{text:'🔀 WHATSAPP / CUBAMAX',callback_data:'pwa:menu'}]
    ]};
  }
  async input(chat,key,actor,m){
    const raw=m.text?.trim()||'';
    if(!raw)return this.bot.send(chat,'Escribe tu código en un mensaje de texto.');
    let code;
    try{code=this.links.normalize(raw);}catch(e){return this.bot.send(chat,e.message);}
    if(this.links.record(code))return this.bot.send(chat,'Ese código ya se está utilizando. Elige otro.');
    const photo=this.links.sourcePhoto();
    if(!photo)return this.bot.send(chat,'Todavía no se ha configurado la foto del popup público de WhatsApp. Debe prepararla el administrador desde EDITOR VISUAL → WHATSAPP.');
    try{
      await this.bot.api('sendChatAction',{chat_id:chat,action:'upload_photo'}).catch(()=>{});
      const derived=await publicPopupPhoto(this.bot.store,this.bot.accounts.dir,photo,new Date());
      // Preview is mandatory and MUST precede the public URL.
      await sendEditorImage(this.bot,chat,derived.asset,
        '🖼 '+this.links.texts().preview+'\n\n'+this.links.texts().firstOnly);
      const row=this.links.create(actor,code,derived.asset);
      this.bot.pending.delete(key);
      await this.bot.send(chat,'✅ '+this.links.texts().delivered+'\n\n'+this.links.url(row.code)+'\n\n'+this.links.texts().firstOnly,
        this.keyboard(row.code));
    }catch(error){
      console.error('WHATSAPP: public_link_create_failed',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
      return this.bot.send(chat,'No fue posible generar el enlace. '+(error?.message||'Revisa la foto del popup en el editor.')+'\n\nNo se modificó ninguna cuenta conectada.');
    }
  }
  async list(chat,actor,offset=0){
    const records=this.links.list(actor,offset);
    const rows=records.map(x=>[{text:x.code+' · '+(x.enabled?'ACTIVO':'REVOCADO'),callback_data:'pwa:show:'+x.code}]);
    return this.bot.send(chat,'MIS ENLACES · WHATSAPP\n\n'+(rows.length?'Elige uno para ver su estado y las cuentas asociadas.':'Todavía no has creado enlaces.'),{
      inline_keyboard:[...rows,
       ...(offset>0?[[{text:'◀ ANTERIOR',callback_data:'pwa:list:'+Math.max(0,offset-12)}]]:[]),
       ...(records.length===12?[[{text:'SIGUIENTE ▶',callback_data:'pwa:list:'+(offset+12)}]]:[]),
       [{text:'➕ CREAR ENLACE',callback_data:'pwa:create'}],
       [{text:'ATRÁS',callback_data:'pwa:menu'}]
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
        inline_keyboard:[[{text:'ATRÁS',callback_data:'pwa:show:'+code}]]
      });
  }
  async callback(chat,key,actor,data){
    const action=data.slice(4),parts=action.split(':'),verb=parts[0],value=parts.slice(1).join(':');
    if(verb==='menu')return this.start(chat,key);
    if(verb==='whatsapp'||verb==='create')return this.askCode(chat,key);
    if(verb==='cubamax'){
      this.bot.pending.delete(key);
      return this.bot.send(chat,'CUBAMAX\n\nhttps://cubamaxcom.online\n\nEl sistema de Cubamax conserva su funcionamiento actual.',{
        inline_keyboard:[[{text:'VOLVER',callback_data:'pwa:menu'}]]
      });
    }
    if(verb==='list'){this.bot.pending.delete(key);return this.list(chat,actor,Math.min(100000,Math.max(0,Number(value)||0)));}
    const row=this.links.owned(actor,value);
    if(!row)return this.bot.send(chat,'Ese enlace no está disponible para tu cuenta.');
    if(verb==='show')return this.show(chat,actor,value);
    if(verb==='accounts')return this.accounts(chat,actor,value);
    if(verb==='revoke')return this.bot.send(chat,'¿Revocar '+value+'? El enlace dejará de abrir la web. Las cuentas ya conectadas NO serán desconectadas.',{
      inline_keyboard:[[{text:'SÍ, REVOCAR',callback_data:'pwa:revoke-yes:'+value}],[{text:'CANCELAR',callback_data:'pwa:show:'+value}]]
    });
    if(verb==='revoke-yes'){
      this.links.revoke(actor,value);
      return this.show(chat,actor,value);
    }
    if(verb==='delete')return this.bot.send(chat,'¿Eliminar definitivamente el enlace '+value+' y su historial de asociaciones? No se eliminarán cuentas conectadas.',{
      inline_keyboard:[[{text:'SÍ, ELIMINAR',callback_data:'pwa:delete-yes:'+value}],[{text:'CANCELAR',callback_data:'pwa:show:'+value}]]
    });
    if(verb==='delete-yes'){
      this.links.delete(actor,value);
      return this.list(chat,actor);
    }
    return this.bot.send(chat,'Opción no disponible.');
  }
}
