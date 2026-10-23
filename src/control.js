import { randomBytes } from 'node:crypto';
import { personLink, escapeHTML, clippedHTML } from './identity.js';
import { historyPages } from './history.js';
import { connectionLabel } from './session.js';
const keyboard=rows=>({inline_keyboard:rows});
export class Control {
  constructor(bot){this.bot=bot;this.actions=new Map();this.views=new Map();this.composing=new Map();this.jobs=new Set();this.histories=new Map();}
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
    if(info.photoData)return this.bot.sendFile(chat,{...info.photoData,display:true,caption,parse_mode:'HTML'},keyboard(rows));
    if(info.photo){let data;try{data=await this.bot.profilePhoto(info.photo);}catch{console.error('WHATSAPP: profile_url_download_failed',JSON.stringify({account:id,code:'WA_PROFILE_URL_FETCH'}));}
      if(data)return this.bot.sendFile(chat,{data,mime:'image/jpeg',name:'perfil.jpg',display:true,caption,parse_mode:'HTML'},keyboard(rows));
    }
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
    [this.button(chat,actor,'🧾 REVISAR ENVÍOS ANTERIORES',{kind:'exportsReview',id,peer})],
    [this.button(chat,actor,'🔄 SINCRONIZAR GALERÍA',{kind:'syncMedia',id,peer})],
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
    const tools=this.bot.accounts.tools,all=await tools.history(id,peer,500),a=this.bot.store.account(id);
    if(!all.length)return this.bot.send(chat,'No hay mensajes disponibles en el historial consultado.');
    const contact=await tools.identity(id,peer),owner=await tools.identity(id,`${a.phone}@c.us`);
    const messages=all.slice().sort((a,b)=>a.timestamp-b.timestamp),pages=historyPages(messages,owner,contact),token=randomBytes(10).toString('hex');
    for(const [key,h] of this.histories)if(h.expires<Date.now())this.histories.delete(key);
    if(this.histories.size>=100)this.histories.delete(this.histories.keys().next().value);
    this.histories.set(token,{id,peer,messages,pages,chat:String(chat),actor:String(actor),expires:Date.now()+1800000});
    return this.historyPage(chat,actor,token,pages.length-1);
  }
  history(chat,actor,token){
    const h=this.histories.get(token);if(!h||h.chat!==String(chat)||h.actor!==String(actor)||h.expires<Date.now())throw Error('El historial venció. Pulsa VER MENSAJES.');return h;
  }
  async historyPage(chat,actor,token,page,messageId){
    const h=this.history(chat,actor,token),p=h.pages[page];if(!p)throw Error('Página no disponible.');
    const rows=[],nav=[];
    if(page)nav.push(this.button(chat,actor,'◀️ ANTERIORES',{kind:'historyPage',token,page:page-1}));
    if(page+1<h.pages.length)nav.push(this.button(chat,actor,'SIGUIENTES ▶️',{kind:'historyPage',token,page:page+1}));
    if(nav.length)rows.push(nav);
    for(const index of p.media){const m=h.messages[index];rows.push([this.button(chat,actor,`${['ptt','audio'].includes(m.type)?'▶️ ESCUCHAR':'📎 VER ARCHIVO'} ${index+1}`,{kind:'historyMedia',token,index})]);}
    rows.push([this.button(chat,actor,'✍️ RESPONDER',{kind:'compose',id:h.id,peer:h.peer}),this.button(chat,actor,'ATRÁS',{kind:'chat',id:h.id,peer:h.peer})]);
    const text=`<b>CONVERSACIÓN · ${page+1}/${h.pages.length}</b>\nHistorial disponible consultado: ${h.messages.length} mensajes (hasta 500).\n\n${p.text}Responde a esta vista para escribir al contacto.`;
    const sent=messageId?await this.bot.api('editMessageText',{chat_id:chat,message_id:messageId,text,parse_mode:'HTML',reply_markup:keyboard(rows),link_preview_options:{is_disabled:true}}):await this.text(chat,text,rows);
    this.bot.store.route(chat,messageId||sent.message_id,h.id,h.peer);return sent;
  }
  async historyMedia(chat,actor,token,index){
    const h=this.history(chat,actor,token),m=h.messages[index];
    if(!m?.hasMedia||m.isEphemeral||m.rawData?.isViewOnce)throw Error('Archivo no disponible.');
    const cap=Number(process.env.MAX_MEDIA_MB||20)*1024*1024;
    if(Number(m.rawData?.size||m.rawData?.fileSize||0)>cap)return this.bot.send(chat,'El archivo supera el límite de envío.');
    let media;try{media=await m.downloadMedia();}catch{return this.bot.send(chat,'WhatsApp no permitió recuperar este archivo del historial.');}
    if(!media)return this.bot.send(chat,'Este archivo ya no está disponible para descargar en el dispositivo vinculado.');
    const data=Buffer.from(media.data,'base64');if(!data.length||data.length>cap)return this.bot.send(chat,'Archivo vacío o demasiado grande.');
    const sent=await this.bot.sendFile(chat,{data,mime:media.mimetype,name:media.filename||(['ptt','audio'].includes(m.type)?'audio.ogg':'archivo'),voice:m.type==='ptt',display:true,caption:(m.body||'Archivo de la conversación').slice(0,900)});
    this.bot.store.route(chat,sent.message_id,h.id,h.peer);return sent;
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
    if(a.kind==='historyPage')return this.historyPage(chat,actor,a.token,a.page,a.telegramMessageId);
    if(a.kind==='historyMedia')return this.historyMedia(chat,actor,a.token,a.index);
    if(a.kind==='messages')return this.messages(chat,actor,id,peer);
    if(a.kind==='syncMedia'){
      const accepted=await tools.client(id).syncHistory(peer);
      return this.text(chat,accepted?'WhatsApp aceptó la solicitud de ampliar el historial de este chat. Cuando termine de sincronizar, pulsa ACTUALIZAR GALERÍA. Esto no garantiza recuperar todos los archivos guardados en el teléfono.':'WhatsApp no ofreció ampliar el historial de este chat. Puedes actualizar el índice disponible; el total del teléfono puede seguir siendo distinto.',[[this.button(chat,actor,'ACTUALIZAR GALERÍA',{kind:'chat',id,peer})],[this.button(chat,actor,'MENÚ PRINCIPAL',{kind:'home'})]]);
    }
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
    if(a.kind==='exportsReview'){
      const gallery=await tools.gallery(id,peer),legacy=gallery.messages.filter(m=>this.bot.store.exportState(id,m.id._serialized)==='done'&&!this.bot.store.receipt(id,m.id._serialized));
      return this.text(chat,`Archivos marcados como enviados sin comprobante guardado: ${legacy.length}.\nPodemos habilitar hasta 10 para descargarlos de nuevo. Si ya estaban en ALMACEN, se repetirán.`,legacy.length?[[this.button(chat,actor,'HABILITAR 10 PARA REENVÍO',{kind:'exportsReset',id,peer})],[this.button(chat,actor,'ATRÁS',{kind:'chat',id,peer})]]:[[this.button(chat,actor,'ATRÁS',{kind:'chat',id,peer})]]);
    }
    if(a.kind==='exportsReset'){
      const gallery=await tools.gallery(id,peer);let count=0;
      for(const m of gallery.messages.slice().reverse()){if(count===10)break;if(this.bot.store.resetUnverifiedExport(id,m.id._serialized))count++;}
      return this.text(chat,`Archivos habilitados de nuevo: ${count}. Pulsa DESCARGAR 10 para enviarlos a ALMACEN.`,this.chatButtons(chat,actor,id,peer));
    }
    if(a.kind==='download'){
      const destination=await this.bot.api('getChat',{chat_id:this.bot.config.storage});
      if(String(destination?.id)!==String(this.bot.config.storage))throw Error('No se pudo verificar ALMACEN.');
      const progressMessage=await this.bot.send(chat,'⬇️ Descarga del lote: 0%\nConsultando los archivos nuevos…');
      let lastProgress=0,lastPercent=-1;
      const updateProgress=async p=>{
        if(p.phase!=='finished'&&(p.percent===lastPercent||Date.now()-lastProgress<1100))return;
        lastProgress=Date.now();lastPercent=p.percent;
        const phase=p.phase==='finished'?'Procesamiento terminado':p.phase==='uploading'?'Enviando a ALMACEN':'Descargando y enviando';
        await this.bot.api('editMessageText',{chat_id:chat,message_id:progressMessage.message_id,text:`⬇️ Descarga del lote: ${p.percent}%\nArchivos confirmados en ALMACEN: ${p.sent}/${p.target}\n${phase}${p.skipped||p.failed?' · No disponibles o fallidos: '+(p.skipped+p.failed):''}`}).catch(()=>{});
      };
      this.run(chat,async()=>{
        const p=await tools.identity(id,peer),account=this.bot.store.account(id),owner=await tools.identity(id,`${account.phone}@c.us`);
        const receipts=[];
        const result=await tools.downloadRecent(id,peer,a.media,async(msg,file)=>{
          file.caption=`${(msg.body||'').slice(0,500)}\n\nCuenta: ${owner.name} (+${owner.phone})\nContacto: ${p.name}${p.phone?' (+'+p.phone+')':''}\nCuenta ID: ${id}`;
          file.display=true;
          const sent=await this.bot.notify(null,file);
          this.bot.verifyStorageReceipt(sent);
          this.bot.store.exportReceipt(id,msg.id._serialized,sent.chat.id,sent.message_id);
          receipts.push(sent);this.bot.store.route(sent.chat.id,sent.message_id,id,peer);
        },updateProgress);
        const links=receipts.map((r,i)=>`<a href="https://t.me/c/${String(r.chat.id).replace(/^-100/,'')}/${r.message_id}">Archivo ${i+1}</a>`).join(' · ');
        console.log('WHATSAPP: download_receipts',JSON.stringify({account:id,destination:this.bot.config.storage,sent:result.sent,messages:receipts.map(r=>r.message_id)}));
        const summary=`Lote finalizado · ${result.target?Math.floor(result.sent*100/result.target):0}% enviados\nConfirmados por Telegram en ALMACEN: ${result.sent}.\nDestino: ${escapeHTML(this.bot.config.storage)}\nNo disponibles o demasiado grandes: ${result.skipped}. Fallos de WhatsApp: ${result.failed}.\nÍndice del chat: ${result.scanned}${result.complete?'':' (parcial)'}. Este lote envía hasta 10 nuevos; el siguiente continúa con otros archivos.\n\n${links}`;
        try{await this.bot.api('editMessageText',{chat_id:chat,message_id:progressMessage.message_id,text:summary,parse_mode:'HTML',link_preview_options:{is_disabled:true}});}catch{await this.text(chat,summary);}
      },id,'descarga_manual');
    }
  }
  async callback(chat,actor,data,messageId){
    const token=data.slice(4),a=this.actions.get(token);
    if(!a||a.chat!==String(chat)||a.actor!==String(actor)||a.expires<Date.now())throw new Error('Este botón venció. Abre /menu.');
    if(a.kind==='delete'||a.kind==='exportsReset')this.actions.delete(token);
    this.composing.delete(this.key(chat,actor));
    return this.action(chat,actor,{...a,telegramMessageId:messageId});
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
