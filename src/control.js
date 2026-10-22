import { randomBytes } from 'node:crypto';
import { personLink, escapeHTML, clippedHTML } from './identity.js';
import { connectionLabel } from './session.js';
const keyboard=rows=>({inline_keyboard:rows});
export class Control {
  constructor(bot){this.bot=bot;this.actions=new Map();this.views=new Map();this.composing=new Map();this.jobs=new Set();}
  key(chat,actor){return `${chat}:${actor}`;}
  button(chat,actor,text,action){
    for(const [k,v]of this.actions)if(v.expires<Date.now())this.actions.delete(k);
    if(this.actions.size>=3000)this.actions.delete(this.actions.keys().next().value);
    const token=randomBytes(10).toString('hex');this.actions.set(token,{...action,chat:String(chat),actor:String(actor),expires:Date.now()+1800000});
    return {text,callback_data:`ctl:${token}`};
  }
  async text(chat,text,rows=[]){return this.bot.api('sendMessage',{chat_id:chat,text,parse_mode:'HTML',reply_markup:keyboard(rows),link_preview_options:{is_disabled:true}});}
  async home(chat,actor,page=0){
    this.composing.delete(this.key(chat,actor));
    const accounts=this.bot.store.all().filter(a=>a.consent),connected=accounts.filter(a=>this.bot.accounts.live.get(a.id)?.ready).length;
    const pageItems=accounts.slice(page*10,page*10+10),rows=[],lines=[`<b>WHATSAPP · MENÚ PRINCIPAL</b>\nCuentas conectadas: ${connected}\nCuentas autorizadas: ${accounts.length}\n`];
    for(const [i,a]of pageItems.entries()){
      const profile=await this.bot.accounts.tools.identity(a.id,`${a.phone}@c.us`,!!this.bot.accounts.live.get(a.id)?.ready);
      lines.push(`${page*10+i+1}. ${personLink({...profile,name:profile.name.slice(0,24)})}\n${escapeHTML(profile.country)} · ${connectionLabel(this.bot.accounts,a)}${a.paused?' · Pausada':''}`);
      rows.push([this.button(chat,actor,`${page*10+i+1}. ${profile.name.slice(0,40)}`,{kind:'account',id:a.id})]);
    }
    const nav=[];if(page)nav.push(this.button(chat,actor,'◀️ ANTERIOR',{kind:'home',page:page-1}));if((page+1)*10<accounts.length)nav.push(this.button(chat,actor,'SIGUIENTE ▶️',{kind:'home',page:page+1}));if(nav.length)rows.push(nav);
    rows.push(...this.bot.menu().inline_keyboard);
    this.views.set(this.key(chat,actor),{kind:'accounts',items:accounts.map(a=>a.id),expires:Date.now()+1800000});
    return this.text(chat,lines.join('\n\n')+(accounts.length?'':'Sin cuentas autorizadas.'),rows);
  }
  async account(chat,actor,id){
    const a=this.bot.store.account(id);if(!a?.consent)throw new Error('Cuenta no autorizada.');
    if(!this.bot.accounts.live.get(id)?.ready)return this.text(chat,`${personLink(await this.bot.accounts.tools.identity(id,`${a.phone}@c.us`))}\n\nEstado: ${connectionLabel(this.bot.accounts,a)}\n\nQue el dispositivo figure vinculado en el teléfono no confirma que el servidor esté conectado.`,[[this.button(chat,actor,'🔄 RECUPERAR CONEXIÓN',{kind:'recover',id})],[this.button(chat,actor,'ACTUALIZAR',{kind:'account',id}),this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]]);
    await this.bot.send(chat,'Consultando la cuenta…');
    const info=await this.bot.accounts.tools.overview(id),rows=[
      [this.button(chat,actor,'💬 CHATS',{kind:'chats',id,page:0})],
      [this.button(chat,actor,'📊 CHAT CON MÁS FOTOS Y VIDEOS',{kind:'ranking',id})],
      [this.button(chat,actor,'🔄 ACTUALIZAR',{kind:'account',id}),this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]
    ];
    const warning=info.total===null?'\n⚠️ No se pudo consultar la lista de chats. Pulsa ACTUALIZAR.':info.unreadable?`\n⚠️ Lista parcial: ${info.unreadable} chats no pudieron leerse.`:'';
    const caption=`${personLink(info.profile)}\nPaís del número: ${escapeHTML(info.profile.country)}\n\nChats privados disponibles: ${info.total??'No disponible'}\nChats abiertos (sin archivar): ${info.open??'No disponible'}\nChats con candado visibles: ${info.locked??'No disponible'}\nContactos bloqueados: ${info.blocked??'No disponible'}${warning}\n\nLos chats ocultos o no sincronizados pueden no aparecer.`;
    if(info.photo)try{return await this.bot.api('sendPhoto',{chat_id:chat,photo:info.photo,caption,parse_mode:'HTML',reply_markup:keyboard(rows)});}catch{}
    return this.text(chat,caption+'\n\nFoto de perfil no disponible.',rows);
  }
  async chats(chat,actor,id,page=0){
    const all=await this.bot.accounts.tools.list(id),lines=['<b>CHATS</b>\nSelecciona un botón o escribe su número.'],rows=[];
    for(const [i,c]of all.slice(page*10,page*10+10).entries()){
      const profile=await this.bot.accounts.tools.identity(id,c.id._serialized);
      lines.push(`${page*10+i+1}. ${personLink({...profile,name:profile.name.slice(0,24)})}${c.unreadCount?' · '+c.unreadCount+' sin leer':''}`);
      rows.push([this.button(chat,actor,`${page*10+i+1}. ${profile.name.slice(0,40)}`,{kind:'chat',id,peer:c.id._serialized})]);
    }
    const nav=[];if(page)nav.push(this.button(chat,actor,'◀️ ANTERIOR',{kind:'chats',id,page:page-1}));if((page+1)*10<all.length)nav.push(this.button(chat,actor,'SIGUIENTE ▶️',{kind:'chats',id,page:page+1}));if(nav.length)rows.push(nav);
    rows.push([this.button(chat,actor,'ATRÁS',{kind:'account',id}),this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]);
    this.views.set(this.key(chat,actor),{kind:'chats',id,items:all.map(c=>c.id._serialized),expires:Date.now()+1800000});
    const unavailable=this.bot.accounts.tools.listProblems.get(id);
    return this.text(chat,lines.join('\n\n')+(all.length?'':'\nSin chats disponibles.')+(unavailable?`\n⚠️ Lista parcial: ${unavailable} chats no pudieron leerse.`:''),rows);
  }
  chatButtons(chat,actor,id,peer){return [
    [this.button(chat,actor,'✍️ RESPONDER',{kind:'compose',id,peer}),this.button(chat,actor,'💬 VER MENSAJES',{kind:'messages',id,peer})],
    [this.button(chat,actor,'⬇️ DESCARGAR 10',{kind:'download',id,peer,media:'all'})],
    [this.button(chat,actor,'🖼 FOTOS 10',{kind:'download',id,peer,media:'photos'}),this.button(chat,actor,'🎬 VIDEOS 10',{kind:'download',id,peer,media:'videos'})],
    [this.button(chat,actor,'🗑 BORRAR ÚLTIMO MENSAJE',{kind:'deletePreview',id,peer})],
    [this.button(chat,actor,'ATRÁS',{kind:'chats',id,page:0}),this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]
  ];}
  async chat(chat,actor,id,peer){
    this.composing.delete(this.key(chat,actor));
    await this.bot.send(chat,'Consultando mensajes y archivos disponibles…');
    const tools=this.bot.accounts.tools,profile=await tools.identity(id,peer);
    let gallery;
    try{gallery=await tools.gallery(id,peer);}catch(error){
      this.bot.store.recordIncident(id,'consulta_multimedia',error);
      return this.text(chat,`${personLink(profile)}\n\nConteo multimedia: no disponible. WhatsApp no permitió consultar el índice; no se mostrará cero ni un total inventado.`,this.chatButtons(chat,actor,id,peer));
    }
    const counts=tools.counts(gallery.messages);
    return this.text(chat,`${personLink(profile)}\n\nFotos disponibles: ${counts.photos}\nVideos disponibles: ${counts.videos}\n\nÍndice multimedia del dispositivo vinculado: ${gallery.complete?'consulta terminada':'consulta parcial'}. Puede diferir de la galería guardada en el teléfono. Las descargas envían hasta 10 archivos nuevos disponibles a ALMACEN.`,this.chatButtons(chat,actor,id,peer));
  }
  async messages(chat,actor,id,peer){
    const tools=this.bot.accounts.tools,all=await tools.history(id,peer,50),incoming=all.filter(m=>!m.fromMe).slice(-10),a=this.bot.store.account(id);
    const sender=await tools.identity(id,peer),receiver=await tools.identity(id,`${a.phone}@c.us`);
    if(!incoming.length)return this.bot.send(chat,'No hay mensajes recibidos disponibles en el historial consultado.');
    for(const m of incoming){
      const when=new Date(m.timestamp*1000).toLocaleString('es',{timeZone:'America/New_York'});
      const sent=await this.text(chat,`Escribe: ${personLink(sender)}\nRecibe: ${personLink(receiver)}\n${escapeHTML(when)} (Nueva York)\n\n${clippedHTML(m.body||'['+m.type+']')}\n\nHaz reply a este mensaje para responder.`);
      this.bot.store.route(chat,sent.message_id,id,peer);
    }
    return this.text(chat,'Últimos mensajes recibidos del historial disponible.',this.chatButtons(chat,actor,id,peer));
  }
  run(chat,work,account,stage){
    const job=Promise.resolve().then(work).catch(async error=>{
      const code=error?.code||'WA_OPERATION_FAILED';
      console.error('WHATSAPP: operation_failed',JSON.stringify({account,stage,code,frames:String(error?.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)}));
      if(account)try{this.bot.store.recordIncident(account,stage,{code});}catch{}
      await this.bot.send(chat,`⚠️ No se completó la operación (${code}). Revisa /pendientes. Si falló un envío a Telegram, no lo repetiremos automáticamente para evitar duplicados.`).catch(()=>{});
    }).finally(()=>this.jobs.delete(job));
    this.jobs.add(job);
  }
  async ranking(chat,actor,id){
    await this.bot.send(chat,'Consultando los índices multimedia de los chats. Puede tardar…');
    this.run(chat,async()=>{
      const tools=this.bot.accounts.tools,chats=await tools.list(id);let best=null,failed=0;
      for(const c of chats){try{const counts=tools.counts((await tools.gallery(id,c.id._serialized)).messages);const total=counts.photos+counts.videos;if(!best||total>best.total)best={peer:c.id._serialized,total,...counts};}catch{failed++;}}
      if(!best)return this.bot.send(chat,'No hay chats que se puedan revisar.');
      const p=await tools.identity(id,best.peer);
      return this.text(chat,`Mayor cantidad en los índices consultados:\n${personLink(p)}\nFotos: ${best.photos} · Videos: ${best.videos}\nÍndices del dispositivo vinculado; pueden diferir del teléfono. Chats no consultados: ${failed}.`,[[this.button(chat,actor,'ABRIR CHAT',{kind:'chat',id,peer:best.peer})]]);
    },id,'consulta_estadisticas');
  }
  async action(chat,actor,a){
    const {id,peer}=a,tools=this.bot.accounts.tools;
    if(a.kind==='home')return this.home(chat,actor,a.page||0);
    if(a.kind==='account')return this.account(chat,actor,id);
    if(a.kind==='recover'){
      await this.bot.accounts.start(id);
      return this.text(chat,'Recuperando la sesión guardada. No hace falta pedir otro código mientras WhatsApp acepte la sesión. Pulsa ACTUALIZAR para consultar el resultado.',[[this.button(chat,actor,'ACTUALIZAR',{kind:'account',id})],[this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]]);
    }
    if(a.kind==='chats')return this.chats(chat,actor,id,a.page||0);
    if(a.kind==='chat')return this.chat(chat,actor,id,peer);
    if(a.kind==='messages')return this.messages(chat,actor,id,peer);
    if(a.kind==='ranking')return this.ranking(chat,actor,id);
    if(a.kind==='compose'){
      tools.client(id,true);const p=await tools.identity(id,peer),owner=this.bot.store.account(id);
      this.composing.set(this.key(chat,actor),{id,peer,expires:Date.now()+300000});
      return this.text(chat,`Responder a: ${personLink(p)}\nDesde: +${owner.phone}\n\nEnvía textos, fotos, videos o audios. Este destinatario seguirá activo durante cinco minutos. /cancelar o MENÚ PRINCIPAL para salir.`,[[this.button(chat,actor,'CANCELAR',{kind:'chat',id,peer})]]);
    }
    if(a.kind==='deletePreview'){
      const msg=await tools.lastOutgoing(id,peer);if(!msg)return this.bot.send(chat,'No hay un mensaje enviado disponible para borrar.');
      const p=await tools.identity(id,peer);
      return this.text(chat,`¿Borrar para todos este mensaje enviado a ${personLink(p)}?\n\n${escapeHTML((msg.body||'['+msg.type+']').slice(0,500))}\n\nWhatsApp debe permitir todavía su eliminación.`,[[this.button(chat,actor,'CONFIRMAR BORRADO',{kind:'delete',id,peer,message:msg.id._serialized})],[this.button(chat,actor,'CANCELAR',{kind:'chat',id,peer})]]);
    }
    if(a.kind==='delete'){await tools.deleteOutgoing(id,peer,a.message);return this.bot.send(chat,'Solicitud de borrado para todos enviada a WhatsApp.');}
    if(a.kind==='download'){
      await this.bot.send(chat,'Descargando hasta 10 archivos nuevos a ALMACEN…');
      this.run(chat,async()=>{
        const p=await tools.identity(id,peer),account=this.bot.store.account(id),owner=await tools.identity(id,`${account.phone}@c.us`);
        const result=await tools.downloadRecent(id,peer,a.media,async(msg,file)=>{
          file.caption=`${(msg.body||'').slice(0,500)}\n\nCuenta: ${owner.name} (+${owner.phone})\nContacto: ${p.name}${p.phone?' (+'+p.phone+')':''}\nCuenta ID: ${id}`;
          const sent=await this.bot.notify(null,file);this.bot.store.route(sent.chat.id,sent.message_id,id,peer);
        });
        await this.bot.send(chat,`Enviados a ALMACEN: ${result.sent}. No disponibles o demasiado grandes: ${result.skipped}. Fallos al descargar de WhatsApp: ${result.failed}. Archivos del índice consultados: ${result.scanned}${result.complete?'':' (índice parcial)'}; los archivos ya registrados no se repiten.`);
      },id,'descarga_manual');
    }
  }
  async callback(chat,actor,data){
    const token=data.slice(4),a=this.actions.get(token);
    if(!a||a.chat!==String(chat)||a.actor!==String(actor)||a.expires<Date.now())throw new Error('Este botón venció. Abre /menu.');
    if(a.kind==='delete')this.actions.delete(token);
    this.composing.delete(this.key(chat,actor));
    return this.action(chat,actor,a);
  }
  async input(m,actor){
    const key=this.key(m.chat.id,actor),raw=m.text||'';
    if(raw==='/cancelar'||raw==='/menu'||raw==='/start'){this.composing.delete(key);return false;}
    if(m.reply_to_message||raw.startsWith('/')){this.composing.delete(key);return false;}
    const pending=this.composing.get(key);
    if(pending){
      if(pending.expires<Date.now()){this.composing.delete(key);throw new Error('La respuesta venció. Pulsa RESPONDER de nuevo.');}
      await this.bot.deliver(m,pending.id,pending.peer);pending.expires=Date.now()+300000;return true;
    }
    if(/^\d+$/.test(raw)){
      const view=this.views.get(key),n=Number(raw)-1;
      if(!view||view.expires<Date.now())throw new Error('Abre /menu para actualizar la lista.');
      if(!view.items[n])throw new Error('Número fuera de la lista.');
      await this.action(m.chat.id,actor,view.kind==='accounts'?{kind:'account',id:view.items[n]}:{kind:'chat',id:view.id,peer:view.items[n]});return true;
    }
    return false;
  }
}
