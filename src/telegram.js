import { readFileSync } from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class Telegram {
  constructor(store,config) {this.store=store;this.config=config;this.pending=new Map();this.running=false;this.offset=Number(store.config().telegram_offset||0);}
  admins() {
    let file='';try{file=readFileSync('admins.txt','utf8');}catch{}
    return new Set(`${this.config.admins||''}\n${file}`.split(/[\s,]+/).filter(x=>/^\d+$/.test(x)));
  }
  async api(method,body) {
    const form=body instanceof FormData;
    const response=await fetch(`https://api.telegram.org/bot${this.config.token}/${method}`,{method:'POST',body:form?body:JSON.stringify(body),headers:form?{}:{'Content-Type':'application/json'},signal:AbortSignal.timeout(40000)});
    const data=await response.json();if(!data.ok)throw new Error(`Telegram ${method} no disponible`);return data.result;
  }
  async send(chat,text,markup) {return this.api('sendMessage',{chat_id:chat,text:text.slice(0,4000),reply_markup:markup,link_preview_options:{is_disabled:true}});}
  async notify(text,file) {
    if(!this.config.token||!this.config.panel)throw new Error('Falta panel de Telegram');
    if(!file)return this.send(this.config.panel,text);
    if(!this.config.storage)throw new Error('Falta configurar ALMACEN');
    const form=new FormData();form.set('chat_id',this.config.storage);form.set('caption',(file.caption||'').slice(0,1024));form.set('document',new Blob([file.data],{type:file.mime}),file.name);
    return this.api('sendDocument',form);
  }
  menu() {return {inline_keyboard:[[{text:'🤖 CUENTAS',callback_data:'accounts'},{text:'➕ CONECTAR CUENTA',callback_data:'invite'}],[{text:'🎨 EDITAR PÁGINA',callback_data:'design'},{text:'📋 COMANDOS',callback_data:'help'}]]};}
  async download(fileId) {
    const f=await this.api('getFile',{file_id:fileId});
    if(f.file_size>20*1024*1024||!f.file_path||f.file_path.includes('..'))throw new Error('Archivo demasiado grande o no disponible. Máximo 20 MB.');
    const r=await fetch(`https://api.telegram.org/file/bot${this.config.token}/${f.file_path}`,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error('No se pudo descargar');
    const data=Buffer.from(await r.arrayBuffer());if(data.length>20*1024*1024)throw new Error('Archivo demasiado grande');return data;
  }
  help() {return 'WHATSAPP · Administración\n\n/invitar +NUMERO Nombre — enlace privado, válido 24 h\n/cuentas — cuentas y estado\n/pausar ID · /activar ID\n/reconectar ID — recuperar sesión existente\n/desconectar ID — solicitar desvinculación\n/regla ID palabra | respuesta — coincidencia exacta, sin IA\n/reglas ID · /borrarregla NUMERO\n/pendientes — incidencias por revisar\n/editar titulo TEXTO\n/editar descripcion TEXTO\n/editar boton TEXTO\n/editar color #16a675\n/menu — botones\n\nPara contestar, responde al mensaje recibido con texto, foto, video o documento. Los archivos se conservan 7 días. No se importan historiales antiguos.';}
  async accountsList(chat) {
    const list=this.store.all();await this.send(chat,list.length?list.slice(0,30).map(a=>`${a.name} · +${a.phone}\n${a.id}\n${a.status}${a.paused?' · PAUSADO':''}`).join('\n\n'):'Todavía no hay cuentas.',this.menu());
  }
  async handle(u) {
    const m=u.message||u.callback_query?.message,actor=u.callback_query?.from||u.message?.from;
    if(!m||!actor||!this.admins().has(String(actor.id)))return;
    const chat=m.chat.id, key=String(actor.id),cb=u.callback_query;
    // Management only in an admin's private DM or the configured panel.
    if(m.chat.type!=='private'&&String(chat)!==String(this.config.panel)&&String(chat)!==String(this.config.storage))return;
    const reply=text=>this.send(chat,text);
    if(cb) {
      await this.api('answerCallbackQuery',{callback_query_id:cb.id});
      if(cb.data==='accounts')return this.accountsList(chat);
      if(cb.data==='help')return reply(this.help());
      if(cb.data==='invite'){this.pending.set(key,{kind:'invite'});return reply('Envía el número con código de país y el nombre. Ejemplo: +12025550123 María');}
      if(cb.data==='design')return this.send(chat,'¿Qué quieres cambiar?',{inline_keyboard:[[{text:'Logo',callback_data:'edit:logo'},{text:'Título',callback_data:'edit:title'}],[{text:'Texto',callback_data:'edit:description'},{text:'Color',callback_data:'edit:color'}],[{text:'Texto del botón',callback_data:'edit:button'},{text:'Ver página',url:this.config.url}]]});
      if(cb.data?.startsWith('edit:')) {this.pending.set(key,{kind:cb.data.slice(5)});return reply(cb.data==='edit:logo'?'Envía el nuevo logo como foto.':'Envía el nuevo valor. /cancelar para salir.');}
      if(cb.data?.startsWith('disconnect:')){await this.accounts.disconnect(cb.data.split(':')[1]);return reply('Cuenta desvinculada.');}
      return;
    }
    const raw=m.text||'',[command,...args]=raw.split(/\s+/),cmd=command.split('@')[0];
    if(cmd==='/cancelar'){this.pending.delete(key);return reply('Cancelado.');}
    const pending=this.pending.get(key);
    if(pending&&!raw.startsWith('/')) {
      if(pending.kind==='invite'){await this.invite(chat,...raw.split(/\s+/));this.pending.delete(key);return;}
      if(pending.kind==='logo'){
        if(!m.photo)return reply('Envía una foto.');
        const photo=m.photo.at(-1);if(photo.file_size>2*1024*1024)throw new Error('Logo máximo 2 MB.');
        const data=await this.download(photo.file_id);this.store.setConfig('logo',`data:image/jpeg;base64,${data.toString('base64')}`);
      } else this.edit(pending.kind,raw);
      this.pending.delete(key);return reply(`✅ Cambio guardado. Vista previa: ${this.config.url}`);
    }
    if(cmd==='/start'||cmd==='/menu')return this.send(chat,'WHATSAPP · Panel de administración',this.menu());
    if(cmd==='/comandos')return reply(this.help());
    if(cmd==='/cuentas')return this.accountsList(chat);
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
      return reply([...incidents,...messages].join('\n')||'Sin incidencias.');
    }
    if(m.reply_to_message){
      const route=this.store.getRoute(chat,m.reply_to_message.message_id);if(!route)return;
      const f=m.document||m.video||m.photo?.at(-1)||m.audio||m.voice;
      const media=f?{data:await this.download(f.file_id),name:f.file_name||'archivo',mime:f.mime_type||(m.photo?'image/jpeg':'application/octet-stream')}:null;
      if(!raw&&!m.caption&&!media)return reply('Formato no admitido.');
      await this.accounts.send(route.account,route.peer,raw||m.caption||'',media);return reply('✅ Enviado desde WhatsApp.');
    }
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
  async start() {
    this.running=true;
    while(this.running){
      try{
        const updates=await this.api('getUpdates',{offset:this.offset,timeout:25,allowed_updates:['message','callback_query']});
        for(const u of updates){
          this.offset=u.update_id+1;this.store.setConfig('telegram_offset',String(this.offset));
          try{await this.handle(u);}catch(e){const m=u.message||u.callback_query?.message;const actor=u.message?.from||u.callback_query?.from;if(m&&this.admins().has(String(actor?.id)))await this.send(m.chat.id,`⚠️ ${e.message}`).catch(()=>{});}
        }
      }catch {if(this.running)await sleep(3000);}
    }
  }
}
