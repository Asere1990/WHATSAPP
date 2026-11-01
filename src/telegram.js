import {savePageImage,PageEditor} from './page-editor.js';
import { readFileSync } from 'node:fs';
import {PermissionFile} from './permission-file.js';
import { Control } from './control.js';
import { GuideEditor } from './guides.js';
import {PortalEditor} from './portal.js';
import {SystemMessages} from './system-messages.js';
import {AssociatedPopupBot} from './associated-popup-bot.js';
import {OperatorPopupBot} from './operator-popup-bot.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class Telegram {
  constructor(store,config) {this.store=store;this.config=config;this.permissionFile=new PermissionFile({dataDir:config.dataDir||process.env.DATA_DIR||'./data'});this.pending=new Map();this.running=false;this.offset=Number(store.config().telegram_offset||0);this.control=new Control(this);this.guideEditor=new GuideEditor(this);this.portalEditor=new PortalEditor(this);this.pageEditor=new PageEditor(this);this.systemMessages=new SystemMessages(this);this.associated=new AssociatedPopupBot(this);this.operatorPopup=new OperatorPopupBot(this);}
  admins() {
    let file='';try{file=readFileSync('admins.txt','utf8');}catch{}
    return new Set(`${this.config.admins||''}\n${file}`.split(/[\s,]+/).filter(x=>/^\d+$/.test(x)));
  }
  permissions(){return this.permissionFile.read();}
  async api(method,body) {
    const form=body instanceof FormData;
    const response=await fetch(`https://api.telegram.org/bot${this.config.token}/${method}`,{method:'POST',body:form?body:JSON.stringify(body),headers:form?{}:{'Content-Type':'application/json'},signal:AbortSignal.timeout(40000)});
    const data=await response.json();if(!data.ok){
      const error=new Error(`Telegram no pudo completar ${method} (código ${data.error_code||response.status}).`);
      error.code=`TG_${method}_${data.error_code||response.status}`;error.telegramDescription=String(data.description||'');throw error;
    }return data.result;
  }
  async send(chat,text,markup) {return this.api('sendMessage',{chat_id:chat,text:text.slice(0,4000),reply_markup:markup,link_preview_options:{is_disabled:true}});}
  async notifyOwner(account,text,file,options={}){
    const actor=this.webPanel?.access.owner(account);if(!actor||!this.webPanel?.role(actor)||this.admins().has(actor)||String(actor)===String(this.config.panel))return;
    try{const sent=file?await this.sendFile(actor,{...file,display:true}):await this.api('sendMessage',{chat_id:actor,text,parse_mode:options.parse_mode,link_preview_options:{is_disabled:true}});if(options.peer&&sent?.message_id)this.store.route(actor,sent.message_id,account,options.peer);}catch{console.log('WHATSAPP: owner_notification_unavailable',JSON.stringify({account}));}
  }
  async notify(text,file,options={}){const owner=options.account?this.notifyOwner(options.account,text,file,options):Promise.resolve();const [sent]=await Promise.all([this.notifyAdmin(text,file,options),owner]);return sent;}
  // WhatsApp linking alerts go to CHATS first, with ALMACEN and admins as
  // fallbacks. Failure is visible in logs rather than silently discarded.
  async notifyLinkEvent(text,options={}){
    const kind=options.kind||'link',sentOptions={...options};delete sentOptions.kind;
    try{return await this.notify(text,null,sentOptions);}
    catch(error){
      console.error('WHATSAPP: link_notice_primary_failed',JSON.stringify({kind,code:error.code||'TG_SEND_FAILED'}));
      const attempted=new Set([String(this.config.panel||'')]);
      const alternatives=[['almacen',this.config.storage],...[...this.admins()].map(id=>['admin',id])];
      for(const [destination,chat] of alternatives){
        if(!chat||attempted.has(String(chat)))continue;
        attempted.add(String(chat));
        try{
          const sent=await this.api('sendMessage',{chat_id:chat,text:String(text).slice(0,4000),
            ...(sentOptions.parse_mode?{parse_mode:sentOptions.parse_mode}:{}),
            link_preview_options:{is_disabled:true}});
          console.log('WHATSAPP: link_notice_fallback_delivered',JSON.stringify({kind,destination}));
          return sent;
        }catch(failure){console.error('WHATSAPP: link_notice_fallback_failed',JSON.stringify({kind,destination,code:failure.code||'TG_SEND_FAILED'}));}
      }
      throw error;
    }
  }
  async notifyAdmin(text,file,options={}) {
    if(!this.config.token||!this.config.panel)throw new Error('Falta panel de Telegram');
    if(!file)return options.parse_mode?this.api('sendMessage',{chat_id:this.config.panel,text,parse_mode:options.parse_mode,link_preview_options:{is_disabled:true}}):this.send(this.config.panel,text);
    if(file.systemReply)return this.sendFile(this.config.panel,{...file,display:true});
    if(!this.config.storage)throw new Error('Falta configurar ALMACEN');
    const audio=file.conversation&&file.mime?.startsWith('audio/');
    return this.sendFile(audio?this.config.panel:this.config.storage,{...file,display:audio||file.display});
  }
  async sendFile(chat,file,markup){
    const audio=file.display&&file.mime?.startsWith('audio/'),photo=file.display&&['image/jpeg','image/png'].includes(file.mime)&&file.data.length<=10*1024*1024,video=file.display&&file.mime==='video/mp4';
    const field=audio?(file.voice?'voice':'audio'):photo?'photo':video?'video':'document';
    const method={voice:'sendVoice',audio:'sendAudio',photo:'sendPhoto',video:'sendVideo',document:'sendDocument'}[field];
    const form=new FormData();form.set('chat_id',String(chat));form.set('caption',(file.caption||'').slice(0,1024));form.set(field,new Blob([file.data],{type:file.mime}),file.name);
    if(file.parse_mode)form.set('parse_mode',file.parse_mode);
    if(markup)form.set('reply_markup',JSON.stringify(markup));
    return this.api(method,form);
  }
  verifyStorageReceipt(sent){
    if(String(sent?.chat?.id)!==String(this.config.storage)||!Number.isInteger(sent?.message_id)||!(sent.photo?.length||sent.video||sent.document)){
      const error=Error('Telegram no confirmó el archivo en ALMACEN.');error.code='TG_STORAGE_RECEIPT';throw error;
    }
  }
  async profilePhoto(url){
    const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)(whatsapp\.net|fbcdn\.net)$/.test(parsed.hostname))throw Error('Foto no disponible');
    const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw Error('Foto no disponible');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>5*1024*1024)throw Error('Foto demasiado grande');chunks.push(chunk);}return Buffer.concat(chunks);
  }

  menu(){
    const rows=[[{text:'MENSAJE DE SISTEMA PARA',callback_data:'system-message'}],[{text:'🤖 CUENTAS',callback_data:'accounts'},{text:'➕ CONECTAR CUENTA',callback_data:'invite'}],[{text:'🎨 EDITAR PÁGINA',callback_data:'design'},{text:'📋 COMANDOS',callback_data:'help'}],[{text:'🖥 PANEL WEB',callback_data:'op:panel',style:'primary'},{text:'✏️ EDITOR VISUAL',callback_data:'op:editor',style:'success'},{text:'🔗 GENERAR ENLACE WEB',callback_data:'op:referral',style:'success'}], [{text:'🌐 CREAR WEB / MIS WEBS',callback_data:'op:studio',style:'success'}],[{text:'𝐂𝐑𝐄𝐀𝐑 𝐄𝐍𝐋𝐀𝐂𝐄 𝐀𝐒𝐎𝐂𝐈𝐀𝐃𝐎',callback_data:'assoc:start',style:'success'},{text:'📋 MIS ENLACES ASOCIADOS',callback_data:'assoc:list:0'}],[{text:'🖼 POPUP GENÉRICO',callback_data:'assoc:generic'}],[{text:'permisos.txt',callback_data:'permissions-file'}],[{text:'🖼 POPUP PERMISOS.TXT',callback_data:'operator-popup:menu'}]];
    const success=new Set(['invite','op:referral','op:studio','assoc:start','assoc:generic']);
    // Telegram supports primary (blue) and success (green) buttons.
    return {inline_keyboard:rows.flatMap(row=>row.map(button=>[{...button,style:button.style|| (success.has(button.callback_data)?'success':'primary')}]))};
  }
  async download(fileId) {
    const f=await this.api('getFile',{file_id:fileId});
    if(f.file_size>20*1024*1024||!f.file_path||f.file_path.includes('..'))throw new Error('Archivo demasiado grande o no disponible. Máximo 20 MB.');
    const r=await fetch(`https://api.telegram.org/file/bot${this.config.token}/${f.file_path}`,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error('No se pudo descargar');
    const data=Buffer.from(await r.arrayBuffer());if(data.length>20*1024*1024)throw new Error('Archivo demasiado grande');return data;
  }
  help() {return 'WHATSAPP · Administración\n\n/invitar +NUMERO Nombre — enlace privado, válido 24 h\n/cuentas — cuentas y estado\n/pausar ID · /activar ID\n/reconectar ID — recuperar sesión existente\n/baileys [ID] — vincular con el motor ligero\n/desconectar ID — solicitar desvinculación\n/regla ID palabra | respuesta — coincidencia exacta, sin IA\n/reglas ID · /borrarregla NUMERO\n/pendientes — incidencias por revisar\n/cubamax — editar textos e imágenes de Cubamax\n/editar titulo TEXTO\n/editar descripcion TEXTO\n/editar boton TEXTO\n/editar color #16a675\n/menu — botones\n\nEn mi privado: /menu → cuenta → ENVIAR WHATSAPP para escribir a un número nuevo con vista previa y confirmación. DESCONECTAR CUENTA pide confirmar. SMS no está incluido.\n\n/menu → cuenta → CHATS → contacto. RESPONDER admite texto, fotos, videos, documentos y audio. VER MENSAJES muestra ambos participantes en una vista paginada; los audios se abren con ESCUCHAR. BORRAR ÚLTIMO MENSAJE pide confirmar el último enviado y depende del permiso de WhatsApp. Las descargas van a ALMACEN; los mensajes y audios recibidos, a CHATS. También puedes usar reply allí. Los conteos consultan el índice multimedia del dispositivo vinculado; puede diferir de la galería del teléfono.';}
  async accountsList(chat) {
    const list=this.store.all().filter(a=>a.consent&&this.accounts?.live.get(a.id)?.ready);await this.send(chat,list.length?list.slice(0,30).map(a=>`${this.store.profile(a.id,`${a.phone}@c.us`)?.name||'Cuenta de WhatsApp'} · +${a.phone}\n${a.id}\n${a.status}${a.paused?' · PAUSADO':''}`).join('\n\n'):'Todavía no hay cuentas.',this.menu());
  }
  async handle(u) {
    const m=u.message||u.callback_query?.message,actor=u.callback_query?.from||u.message?.from;
    if(!m||!actor)return;
    const isAdmin=this.admins().has(String(actor.id)),isOperator=this.permissions().has(String(actor.id));
    if(!isAdmin){
      if(!isOperator||!this.webPanel||m.chat.type!=='private'||String(m.chat.id)!==String(actor.id))return;
      this.webPanel.access.remember(actor.id,[actor.first_name,actor.last_name].filter(Boolean).join(' ')||actor.username);
      if(u.callback_query){await this.api('answerCallbackQuery',{callback_query_id:u.callback_query.id});if(!u.callback_query.data?.startsWith('op:'))return;return this.webPanel.telegramAction(m.chat.id,actor.id,u.callback_query.data.slice(3));}
      const command=(m.text||'').split(/\s/)[0].split('@')[0];if(['/start','/menu','/cuentas'].includes(command))return this.webPanel.telegramMenu(m.chat.id,actor.id);
      if(command==='/panel'||command==='/enlace')return this.webPanel.telegramAction(m.chat.id,actor.id,command==='/panel'?'panel':'referral');return;
    }
    this.webPanel?.access.remember(actor.id,[actor.first_name,actor.last_name].filter(Boolean).join(' ')||actor.username);
    const chat=m.chat.id, key=`${chat}:${actor.id}`,cb=u.callback_query;
    // Management only in an admin's private DM or the configured panel.
    if(m.chat.type!=='private'&&String(chat)!==String(this.config.panel)&&String(chat)!==String(this.config.storage))return;
    const reply=text=>this.send(chat,text);
    if(cb) {
      if(!cb.data?.startsWith('sys:send:'))this.systemMessages.cancel(key);
      this.control.composing.delete(key);if(!cb.data?.startsWith('ctl:'))this.control.outgoingDrafts.delete(key);
      await this.api('answerCallbackQuery',{callback_query_id:cb.id});
      if(m.chat.type!=='private')return reply('Abre el privado de este bot y escribe /menu para administrar las cuentas. Aquí puedes responder con reply a los mensajes recibidos.');
      if(cb.data==='permissions-file'){
        this.pending.set(key,{kind:'permissionIds'});
        return reply('permisos.txt · ADMINISTRACIÓN\n\nEnvía uno o varios telegram_id separados por comas o espacios. Se agregarán sin duplicados y conservarán sus permisos después de reiniciar.\n\n/cancelar para salir.');
      }
      if(cb.data?.startsWith('op:')&&this.webPanel)return this.webPanel.telegramAction(chat,actor.id,cb.data.slice(3));
      if(cb.data?.startsWith('operator-popup:')){this.pending.delete(key);return this.operatorPopup.callback(chat,key,cb.data);}
      if(cb.data?.startsWith('assoc:'))return this.associated.callback(chat,key,cb.data);
      if(cb.data==='system-message'){this.pending.delete(key);return this.systemMessages.list(chat,key);}
      if(cb.data?.startsWith('sys:')){this.pending.delete(key);return this.systemMessages.callback(chat,key,cb.data);}
      if(cb.data==='guide'||cb.data?.startsWith('guide:')){this.pending.delete(key);return this.guideEditor.callback(chat,key,cb.data);}
      if(cb.data?.startsWith('ctl:')){this.pending.delete(key);return this.control.callback(chat,actor.id,cb.data,m.message_id);}
      if(cb.data==='accounts')return this.control.home(chat,actor.id);
      if(cb.data==='help')return reply(this.help());
      if(cb.data==='invite'){this.pending.set(key,{kind:'invite'});return reply('Envía el número con código de país y el nombre. Ejemplo: +12025550123 María');}
      if(cb.data==='cm'||cb.data?.startsWith('cm:')){this.pending.delete(key);return this.portalEditor.callback(chat,key,cb.data);}
      if(cb.data==='design'){this.pending.delete(key);return this.send(chat,'EDITAR PÁGINA · Elige la web.',{inline_keyboard:[[{text:'EDITAR WHATSAPP',callback_data:'pg:wa'}],[{text:'EDITAR CUBAMAX',callback_data:'cm'}]]});}
      if(cb.data?.startsWith('pg:')){this.pending.delete(key);return this.pageEditor.callback(chat,key,cb.data);}
      if(cb.data?.startsWith('edit:')) {this.pending.set(key,{kind:cb.data.slice(5)});return reply(cb.data==='edit:logo'?'Envía el nuevo logo como foto.':'Envía el nuevo valor. /cancelar para salir.');}
      if(cb.data?.startsWith('disconnect:')){await this.accounts.disconnect(cb.data.split(':')[1]);return reply('Cuenta desvinculada.');}
      return;
    }
    const raw=m.text||'',[command,...args]=raw.split(/\s+/),cmd=command.split('@')[0];
    if(cmd==='/cancelar'){this.systemMessages.cancel(key);this.pending.delete(key);this.control.composing.delete(key);this.control.outgoingDrafts.delete(key);return reply('Cancelado.');}
    if(m.chat.type==='private'&&!this.pending.has(key)&&await this.control.input(m,actor.id))return;
    const pending=this.pending.get(key);
    if(pending&&!raw.startsWith('/')&&!m.reply_to_message) {
      if(pending.kind==='operatorPopup')return this.operatorPopup.input(chat,key,pending,m);
      if(pending.kind==='associated')return this.associated.input(chat,key,pending,m);
      if(pending.kind==='systemMessage')return this.systemMessages.input(chat,key,pending,m);
      if(pending.kind==='page'){await this.pageEditor.input(chat,pending,m);this.pending.delete(key);return;}
      if(pending.kind==='cubamax'){await this.portalEditor.input(chat,pending,m);this.pending.delete(key);return;}
      if(pending.kind==='guide'){await this.guideEditor.input(chat,pending,m);this.pending.delete(key);return;}
      if(pending.kind==='permissionIds'){
        if(m.chat.type!=='private')return;
        const result=this.permissionFile.add(raw);
        this.pending.delete(key);
        return reply(result.added.length
          ?`✅ permisos.txt actualizado.\nAgregados: ${result.added.join(', ')}\nTotal autorizados: ${result.count}`
          :'✅ Esos telegram_id ya tenían permisos. No se realizaron cambios.');
      }
      if(pending.kind==='invite'){await this.invite(chat,...raw.split(/\s+/));this.pending.delete(key);return;}
      if(pending.kind==='logo'){
        this.store.setConfig('logo',await savePageImage(this,m));
      } else this.edit(pending.kind,raw);
      this.pending.delete(key);return reply(`✅ Cambio guardado. Vista previa: ${this.config.url}`);
    }
    if(cmd==='/start'||cmd==='/menu'||cmd==='/cuentas'){
      this.systemMessages.cancel(key);
      this.pending.delete(key);
      if(m.chat.type!=='private')return reply('Abre el privado de este bot y escribe /menu para administrar las cuentas. Aquí puedes responder con reply a los mensajes recibidos.');
      return this.control.home(chat,actor.id);
    }
    if(cmd==='/cubamax'){if(m.chat.type!=='private')return reply('Abre el privado del bot y escribe /cubamax.');this.pending.delete(key);return this.portalEditor.menu(chat);}
    if((cmd==='/panel'||cmd==='/enlace')&&this.webPanel&&m.chat.type==='private')return this.webPanel.telegramAction(chat,actor.id,cmd==='/panel'?'panel':'referral');
    if(cmd==='/comandos')return reply(this.help());
    if(cmd==='/baileys'){
      const items=args[0]?[this.store.account(args[0])]:this.store.all().filter(a=>a.consent);
      if(!items.length||items.some(a=>!a?.consent))throw Error('Cuenta no autorizada.');
      for(const a of items){
        if(this.accounts.live.get(a.id)?.client?.kind==='baileys'&&this.accounts.live.get(a.id).ready){await reply(`La cuenta ${a.id} ya está conectada con Baileys.`);continue;}
        await this.accounts.prepareBaileys(a.id);
        await this.invite(chat,a.phone,a.name||'Cuenta de WhatsApp');
      }
      return reply('Abre el enlace de cada cuenta y vincúlala una vez con el código. La página y el menú se mantienen.');
    }
    if(cmd==='/invitar')return this.invite(chat,...args);
    if(cmd==='/editar'){
      const fields={titulo:'title',descripcion:'description',boton:'button',color:'color'};
      this.edit(fields[args[0]],args.slice(1).join(' '));return reply(`✅ Página actualizada. ${this.config.url}`);
    }
    if(['/pausar','/activar','/desconectar','/reconectar'].includes(cmd)){
      const a=this.store.account(args[0]);if(!a)throw new Error('Cuenta no encontrada.');
      if(cmd==='/desconectar')return this.send(chat,`¿Desvincular ${a.name}?`,{inline_keyboard:[[{text:'Confirmar desvinculación',callback_data:`disconnect:${a.id}`}]]});
      if(cmd==='/reconectar'){await this.accounts.start(a.id);return reply('Recuperando sesión. Si WhatsApp la revocó, crea otra invitación.');}
      this.store.update(a.id,'paused',cmd==='/pausar'?1:0);this.store.audit(a.id,cmd.slice(1));return reply(cmd==='/pausar'?'Atención pausada.':'Atención activada.');
    }
    if(cmd==='/regla'){
      const id=args.shift(),[keyword,...rest]=args.join(' ').split('|'),text=rest.join('|').trim();
      if(!this.store.account(id)||!keyword?.trim()||!text||text.length>3000)throw new Error('Uso: /regla ID palabra | respuesta');
      this.store.setRule(id,keyword.trim().toLowerCase(),text);return reply('Regla guardada. Solo responde si el mensaje completo coincide con la palabra o frase.');
    }
    if(cmd==='/reglas')return reply(this.store.rules(args[0]||'').map(r=>`${r.id}. ${r.keyword} → ${r.reply}`).join('\n')||'Sin reglas.');
    if(cmd==='/borrarregla'){this.store.db.prepare('DELETE FROM rules WHERE id=?').run(Number(args[0]));return reply('Regla eliminada.');}
    if(cmd==='/pendientes'){
      const messages=this.store.db.prepare("SELECT id,account,state FROM inbox WHERE state!='done' ORDER BY id DESC LIMIT 30").all().map(r=>`Mensaje ${r.id} · ${r.account} · ${r.state}`);
      const incidents=this.store.openIncidents().map(r=>`Incidencia #${r.id} · ${r.account} · ${r.stage} · ${r.code}`);
      const media=this.store.db.prepare("SELECT account,message,state FROM media_exports WHERE state!='done' ORDER BY created DESC LIMIT 30").all().map(r=>`Archivo ${r.message} · ${r.account} · ${r.state}`);
      return reply([...incidents,...messages,...media].join('\n')||'Sin incidencias.');
    }
    if(m.reply_to_message){
      const route=this.store.getRoute(chat,m.reply_to_message.message_id);if(!route)return;
      this.control.composing.delete(key);
      return this.deliver(m,route.account,route.peer);
    }
    if(m.chat.type==='private'&&(m.photo||m.video||m.document||m.voice||m.audio))return reply('Selecciona el contacto y pulsa RESPONDER antes de enviar el archivo.');
  }
  async deliver(m,account,peer){
    const f=m.document||m.video||m.photo?.at(-1)||m.audio||m.voice;
    const media=f?{data:await this.download(f.file_id),name:f.file_name||(m.voice?'audio.ogg':m.photo?'foto.jpg':m.video?'video.mp4':'archivo'),mime:f.mime_type||(m.photo?'image/jpeg':m.voice?'audio/ogg':'application/octet-stream'),voice:!!m.voice}:null;
    if(!m.text&&!m.caption&&!media)throw new Error('Envía texto, foto, video, documento o audio.');
    await this.accounts.send(account,peer,m.text||m.caption||'',media);
    const a=this.store.account(account),p=await this.accounts.tools.identity(account,peer);return this.send(m.chat.id,`✅ Enviado a ${p.name}${p.phone?' (+'+p.phone+')':''}, desde +${a.phone}.`);
  }
  edit(key,value) {
    if(!['title','description','button','color'].includes(key)||!value?.trim())throw new Error('Campo o valor inválido.');
    if(key==='color'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Usa un color como #16a675.');
    if(value.length>(key==='description'?600:100))throw new Error('Texto demasiado largo.');this.store.setConfig(key,value);
  }
  async invite(chat,phone,...name) {
    if(!phone||!name.length)throw new Error('Uso: /invitar +NUMERO Nombre');
    const {account,secret}=this.store.invite(phone,name.join(' '));
    return this.send(chat,`Enlace privado para ${account.name}. Válido 24 horas y de un solo uso. Envíalo únicamente al titular:\n${this.config.url}/#${secret}`);
  }
  async registerCommands(){
    if(!this.config.token)return;
    for(const language_code of ['', 'es']){
      const scope={type:'all_private_chats'},params={scope,language_code};
      const current=await this.api('getMyCommands',params);
      const commands=[{command:'menu',description:'Abrir el menú principal'},...(Array.isArray(current)?current:[]).filter(c=>c.command!=='menu')].slice(0,100);
      await this.api('setMyCommands',{...params,commands});
      const saved=await this.api('getMyCommands',params);
      if(!saved?.some(c=>c.command==='menu'))throw Error('No se pudo verificar el comando menu.');
    }
    console.log('WHATSAPP: telegram_menu_command_registered');
  }
  async start() {
    this.running=true;this.systemMessages.resolve();
    try{await this.registerCommands();}catch{console.error('WHATSAPP: telegram_command_registration_failed');}
    while(this.running){
      try{
        const updates=await this.api('getUpdates',{offset:this.offset,timeout:25,allowed_updates:['message','callback_query']});
        for(const u of updates){
          this.offset=u.update_id+1;this.store.setConfig('telegram_offset',String(this.offset));
          try{await this.handle(u);}catch(e){
            const m=u.message||u.callback_query?.message,actor=u.message?.from||u.callback_query?.from;
            const scoped=u.callback_query?.data?.startsWith('ctl:')?this.control.actions.get(u.callback_query.data.slice(4)):null;
            const code=e?.code||'MENU_ERROR';console.error('WHATSAPP: admin_action_failed',JSON.stringify({account:scoped?.id||null,code,frames:String(e?.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)}));
            if(scoped?.id)try{this.store.recordIncident(scoped.id,'menu',{code});}catch{}
            const message=typeof e?.message==='string'&&e.message.length>3?e.message:'WhatsApp no pudo completar la consulta. La cuenta sigue vinculada; vuelve a intentarlo.';
            if(m&&this.admins().has(String(actor?.id)))await this.send(m.chat.id,`⚠️ ${message}`).catch(()=>{});
          }
        }
      }catch {if(this.running)await sleep(3000);}
    }
  }
}

