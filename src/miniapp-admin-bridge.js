// ADMINISTRACIÓN MINI APP — adaptador independiente.
// Solo IDs administradores verificados por Telegram. Nunca altera el motor,
// los callbacks ni los editores Web existentes.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {AssociatedPopupBot} from './associated-popup-bot.js';
import {OperatorPopupBot} from './operator-popup-bot.js';
import {PublicAssociatedUsers} from './public-associated-users.js';
import {SystemMessages} from './system-messages.js';
import {userMiniappEditorData,updateUserMiniappLabel} from './miniapp-user-editor.js';
import {publicWaCopyCatalog,publicWaCopyDefaults} from './public-wa-copy.js';
import {publicWaSenderNumbers} from './public-wa-send.js';

const origin='https://whatsapp-cubamax-miniapp.onrender.com';
const ageLimit=6*3600,idle=30*60000,sessions=new Map(),rates=new Map();
const response=(res,status,data,headers={})=>{
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin',
    ...headers
  });
  res.end(status===204?'':JSON.stringify(data));
};
function verify(data,token){
  if(typeof data!=='string'||data.length<20||data.length>8192||!token)
    throw Error('Abre Administración desde tu bot de Telegram.');
  const p=new URLSearchParams(data);
  if(p.getAll('hash').length!==1)throw Error('Firma de Telegram inválida.');
  const entries=[...p.entries()];
  if(new Set(entries.map(([key])=>key)).size!==entries.length)throw Error('Firma de Telegram inválida.');
  const hash=p.get('hash')||'';
  if(!/^[a-f0-9]{64}$/i.test(hash))throw Error('Firma de Telegram inválida.');
  const list=entries.filter(([key])=>key!=='hash')
    .sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,value])=>key+'='+value).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  if(!timingSafeEqual(createHmac('sha256',secret).update(list).digest(),Buffer.from(hash,'hex')))
    throw Error('Firma de Telegram inválida.');
  const date=Number(p.get('auth_date')),now=Math.floor(Date.now()/1000);
  if(!Number.isInteger(date)||date>now+120||date<now-ageLimit)
    throw Error('Acceso vencido. Abre de nuevo la mini app desde Telegram.');
  let info;
  try{info=JSON.parse(p.get('user')||'');}catch{}
  const actor=String(info?.id||'');
  if(!/^[1-9]\d{1,21}$/.test(actor))throw Error('Telegram ID inválido.');
  return actor;
}
async function parseBody(req,max){
  const chunks=[];let total=0;
  for await(const part of req){total+=part.length;if(total>max)throw Error('Solicitud demasiado grande.');chunks.push(part);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Solicitud no válida.');}
}
function throttle(actor,upload=false){
  const key=actor+(upload?':upload':':normal'),now=Date.now();
  let current=rates.get(key);
  if(!current||now-current.start>60000){current={start:now,count:0};rates.set(key,current);}
  return ++current.count<=(upload?8:70);
}
function buttons(markup){
  return (markup?.inline_keyboard||[]).flatMap(row=>(Array.isArray(row)?row:[]).map(btn=>({
    label:String(btn.text||'').slice(0,180),
    ...(typeof btn.callback_data==='string'?{action:btn.callback_data}:{}),
    ...(typeof btn.url==='string'&&/^https:\/\//.test(btn.url)?{url:btn.url}:{})
  })));
}
function cleanup(now){
  for(const [key,value]of sessions)if(now-value.updated>idle)sessions.delete(key);
  for(const [key,value]of rates)if(now-value.start>60000)rates.delete(key);
}
class AdminSession {
  constructor(telegram,actor){
    this.telegram=telegram;this.actor=actor;this.updated=Date.now();
    this.chain=Promise.resolve();this.messages=[];this.uploads=new Map();this.pending=new Map();
    const self=this;
    const bot={
      store:telegram.store,accounts:telegram.accounts,config:telegram.config,
      permissionFile:telegram.permissionFile,autoPublicAccess:telegram.autoPublicAccess,
      webPanel:telegram.webPanel,pending:this.pending,
      admins:()=>telegram.admins(),permissions:()=>telegram.permissions(),
      menu:()=>telegram.menu(),help:()=>telegram.help(),
      send:async(chat,text,markup)=>self.capture(text,markup),
      sendFile:async(chat,file,markup)=>{
        const data=file?.data;
        if(!Buffer.isBuffer(data)||data.length>8*1024*1024)throw Error('Imagen de vista previa demasiado grande.');
        const mime=String(file.mime||'image/jpeg');
        self.messages.push({
          text:String(file.caption||''),image:'data:'+mime+';base64,'+data.toString('base64'),
          buttons:buttons(markup)
        });
        return {chat:{id:chat},message_id:self.messages.length};
      },
      api:async(method,input)=>{
        if(method==='sendMessage'||method==='editMessageText')
          return self.capture(input.text,input.reply_markup);
        if(method==='sendChatAction')return true;
        throw Error('Utiliza el panel original para esta operación de Telegram.');
      },
      download:async fileId=>{
        const file=self.uploads.get(fileId);
        if(!file)throw Error('Archivo no disponible. Selecciona el archivo nuevamente.');
        return file.data;
      },
      invite:async(chat,phone,...name)=>{
        if(!phone||!name.length)throw Error('Escribe número con código de país y nombre.');
        const {account,secret}=telegram.store.invite(phone,name.join(' '));
        return self.capture('Enlace privado de '+account.name+' · válido 24 horas y de un solo uso:\n'+telegram.config.url+'/#'+secret);
      },
      deliver:async(message,account,peer)=>{
        const f=message.photo?.at(-1)||message.video||message.audio||message.voice||message.document;
        let media=null;
        if(f){
          const data=await bot.download(f.file_id);
          media={data,mime:f.mime_type||(message.photo?'image/jpeg':message.voice?'audio/ogg':'application/octet-stream'),
            name:f.file_name||(message.photo?'foto.jpg':message.video?'video.mp4':'archivo'),
            voice:!!message.voice};
        }
        await telegram.accounts.send(account,peer,message.text||message.caption||'',media);
        return {ok:true};
      },
      control:{home:async()=>self.capture('MENÚ ADMINISTRADOR',self.safeMenu())},
      profilePhoto:(url)=>telegram.profilePhoto(url)
    };
    this.bot=bot;
    this.users=new PublicAssociatedUsers(bot);
    this.associated=new AssociatedPopupBot(bot);
    this.operatorPopup=new OperatorPopupBot(bot);
    this.systemMessages=new SystemMessages(bot);
    bot.control=bot.control;
  }
  capture(text,markup){
    this.messages.push({text:String(text||'').slice(0,15000),buttons:buttons(markup)});
    return {chat:{id:this.actor},message_id:this.messages.length};
  }
  safeMenu(){
    const disallowed=new Set(['accounts','design','op:panel','op:editor','op:studio','op:referral','help']);
    const rows=this.telegram.menu().inline_keyboard
      .map(row=>row.filter(button=>!disallowed.has(button.callback_data)&&!button.web_app))
      .filter(row=>row.length);
    return {inline_keyboard:rows};
  }
  links(){
    const code=this.telegram.webPanel.access.permanent(this.actor);
    const base='https://securitywhat.app';
    return {
      panel:base+'/panel#'+code,
      editorWA:base+'/editor?site=wa#'+code,
      editorCM:base+'/editor?site=cm#'+code,
      studio:base+'/studio#'+code,
      user:origin+'/',
      admin:origin+'/admin.html'
    };
  }
  stats(){
    const all=this.telegram.store.all(),db=this.telegram.store.db;
    const count=sql=>db.prepare(sql).get().n||0;
    const connected=all.filter(x=>x.consent&&this.telegram.accounts.live.get(x.id)?.ready).length;
    return {
      connected,accounts:all.filter(x=>x.consent).length,
      users:count('SELECT count(DISTINCT actor) AS n FROM (SELECT actor FROM wa_public_links UNION SELECT actor FROM cm_public_links)'),
      whatsapp:count('SELECT count(*) AS n FROM wa_public_links'),
      cubamax:count('SELECT count(*) AS n FROM cm_public_links'),
      incidents:this.telegram.store.openIncidents().length
    };
  }
  state(data={}){
    return {
      ok:true,admin:true,role:'admin',actor:this.actor,
      messages:this.messages,
      pending:this.pending.get(this.actor+':'+this.actor)||null,
      editors:userMiniappEditorData(this.telegram.store,this.telegram.publicWa.links.texts()),
      links:this.links(),stats:this.stats(),
      numbers:publicWaSenderNumbers(this.telegram.store).map(number=>{
        const account=this.telegram.store.db.prepare('SELECT id,consent,confirmed,paused FROM accounts WHERE phone=?').get(number);
        return {phone:'+'+number,connected:!!account?.consent&&!!account.confirmed&&!account.paused&&!!this.telegram.accounts.live.get(account.id)?.ready};
      }),
      ...data
    };
  }
  async run(data){
    this.messages=[];
    const chat=this.actor,key=chat+':'+chat,action=data.action||'home',value=data.value;
    if(action==='home'){
      this.pending.delete(key);
      this.capture('Bienvenido a Administración. Solo se muestran funciones que tu cuenta administra. Los editores Web y las cuentas conservan sus interfaces originales.');
    }else if(action==='dashboard'){
      this.pending.delete(key);
      this.capture('HERRAMIENTAS ADMINISTRATIVAS',this.safeMenu());
    }else if(action==='editor-users'){
      this.capture('Editor Usuarios · Personaliza textos visibles en la mini app. Deja un campo vacío para recuperar el texto original. Los procesos y botones conservan su función.');
    }else if(action==='save-user-text'){
      if(typeof data.key!=='string'||typeof value!=='string')throw Error('Campo no válido.');
      if(data.key.startsWith('flow:')){
        const name=data.key.slice(5);
        if(!Object.hasOwn(publicWaCopyCatalog,name))throw Error('Campo de texto no válido.');
        this.telegram.publicWa.links.updateText(name,value.trim()||publicWaCopyDefaults[name]);
      }else updateUserMiniappLabel(this.telegram.store,data.key,value);
      this.capture('✅ Texto de la mini app de usuarios guardado. Se mostrará al volver a abrir la mini app.');
    }else if(action==='numbers'){
      this.capture('Números emisores del sistema: utiliza el Panel Web original para consultar, agregar, cambiar o reconectar números. No se ha modificado su funcionamiento.');
    }else if(action==='accounts'){
      this.capture('Cuentas y conversaciones: utiliza el Panel Web original. Allí se conservan la vinculación, búsqueda, chat, descargas y controles actuales.');
    }else if(action==='incidents'){
      const items=[
        ...this.telegram.store.openIncidents().slice(0,30).map(x=>'Incidencia #'+x.id+' · '+x.stage+' · '+x.code),
        ...this.telegram.store.db.prepare("SELECT id,state FROM inbox WHERE state!='done' ORDER BY id DESC LIMIT 30").all().map(x=>'Mensaje #'+x.id+' · '+x.state)
      ];
      this.capture(items.join('\n')||'Sin incidencias pendientes.');
    }else if(action==='callback'){
      if(typeof value!=='string'||value.length>256)throw Error('Acción inválida.');
      if(value.startsWith('users:'))await this.users.callback(chat,value);
      else if(value.startsWith('assoc:'))await this.associated.callback(chat,key,value);
      else if(value.startsWith('operator-popup:'))await this.operatorPopup.callback(chat,key,value);
      else if(value.startsWith('sys:'))await this.systemMessages.callback(chat,key,value);
      else if(value==='system-message')await this.systemMessages.list(chat,key);
      else if(value==='permissions-file'){
        this.pending.set(key,{kind:'permissionIds'});
        this.capture('permisos.txt · Envía uno o varios Telegram ID separados por espacios o comas. Los IDs existentes no se borran.');
      }else if(value==='invite'){
        this.pending.set(key,{kind:'invite'});
        this.capture('Envía el número con código de país seguido del nombre. Ejemplo: +12025550123 María');
      }else if(value==='help')this.capture(this.telegram.help());
      else if(value==='accounts')return this.run({action:'accounts'});
      else if(value==='design'||value==='op:editor')this.capture('Editor Web · Abre uno de los dos editores originales.',{
        inline_keyboard:[
          [{text:'Editor Web · WhatsApp',url:this.links().editorWA}],
          [{text:'Editor Web · Cubamax',url:this.links().editorCM}]
        ]
      });
      else if(value==='op:panel')this.capture('Panel web original.',{inline_keyboard:[[{text:'Abrir Panel Web',url:this.links().panel}]]});
      else if(value==='op:studio')this.capture('Crear Web / Mis Webs original.',{inline_keyboard:[[{text:'Abrir Mis Webs',url:this.links().studio}]]});
      else if(value==='op:referral')this.capture('Generar enlace Web: elige la página.',{
        inline_keyboard:[[{text:'WHATSAPP',callback_data:'op:referral:wa'}],[{text:'CUBAMAX',callback_data:'op:referral:cm'}]]
      });
      else if(value==='op:referral:wa'||value==='op:referral:cm'){
        const site=value.endsWith(':wa')?'wa':'cm',access=this.telegram.webPanel.access;
        const token=access.token(chat,'referral',{site}),short=access.short(token);
        const link=(site==='wa'?'https://securitywhat.app/'+short.padStart(6,'0'):'https://cubamaxcom.online/'+short);
        this.capture('Enlace de vinculación Web para '+(site==='wa'?'WhatsApp':'Cubamax')+':\n'+link);
      }else if(value==='pwa:menu')this.capture('La mini app de usuarios conserva el flujo de enlaces original.',{
        inline_keyboard:[[{text:'Abrir Mini App Usuarios',url:origin+'/'}]]
      });
      else if(value==='guide'||value.startsWith('guide:')||value.startsWith('pg:')||value==='cm'||value.startsWith('cm:')||value.startsWith('edit:'))
        this.capture('Abre el Editor Web existente. Se conservan todos sus textos y fotos.',{
          inline_keyboard:[[{text:'Editor Web WhatsApp',url:this.links().editorWA}],[{text:'Editor Web Cubamax',url:this.links().editorCM}]]
        });
      else throw Error('Opción disponible en el menú Telegram original, no en esta vista.');
    }else if(action==='input'){
      if(typeof value!=='string'||value.length>4000)throw Error('Texto no válido.');
      const p=this.pending.get(key);
      if(!p)throw Error('Selecciona primero una herramienta.');
      const message={text:value};
      if(p.kind==='associated')await this.associated.input(chat,key,p,message);
      else if(p.kind==='operatorPopup')await this.operatorPopup.input(chat,key,p,message);
      else if(p.kind==='systemMessage')await this.systemMessages.input(chat,key,p,message);
      else if(p.kind==='permissionIds'){
        const result=this.bot.permissionFile.add(value);
        this.telegram.autoPublicAccess?.manual(value);
        this.pending.delete(key);
        this.capture(result.added.length?'Permisos guardados: '+result.added.length+' nuevos IDs.':'Esos IDs ya tenían permisos.');
      }else if(p.kind==='invite'){
        const [phone,...names]=value.trim().split(/\s+/);
        await this.bot.invite(chat,phone,...names);this.pending.delete(key);
      }else throw Error('Operación no disponible.');
    }else if(action==='upload'){
      const p=this.pending.get(key);
      if(!p||!['associated','operatorPopup','systemMessage'].includes(p.kind))
        throw Error('Primero selecciona un campo de fotografía.');
      if(typeof value!=='string'||value.length>28*1024*1024)throw Error('Archivo demasiado grande.');
      const match=/^data:(image\/(?:png|jpeg|gif|webp)|video\/mp4|audio\/(?:ogg|mpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if(!match)throw Error('Formato no admitido.');
      const buffer=Buffer.from(match[2],'base64');
      if(!buffer.length||buffer.length>20*1024*1024)throw Error('Archivo máximo 20 MB.');
      if(p.kind!=='systemMessage'&&buffer.length>2*1024*1024)throw Error('Imagen máxima 2 MB.');
      const fid='admin-upload-'+randomBytes(10).toString('hex');
      this.uploads.set(fid,{data:buffer,mime:match[1]});
      if(this.uploads.size>10)this.uploads.delete(this.uploads.keys().next().value);
      const kind=match[1].startsWith('image/')?'photo':match[1].startsWith('video/')?'video':'audio';
      const file={file_id:fid,file_size:buffer.length,mime_type:match[1],file_name:kind+'.'+match[1].split('/')[1]};
      const m=kind==='photo'?{photo:[file]}:{[kind]:file};
      if(p.kind==='associated')await this.associated.input(chat,key,p,m);
      else if(p.kind==='operatorPopup')await this.operatorPopup.input(chat,key,p,m);
      else await this.systemMessages.input(chat,key,p,m);
    }else if(action==='cancel'){
      this.systemMessages.cancel(key);
      this.pending.delete(key);
      this.capture('Cancelado.');
    }else throw Error('Acción no disponible.');
    return this.state();
  }
}
export function createAdminMiniAppBridge(telegram){
  return async(req,res)=>{
    const source=req.headers.origin||'';
    const cors=source===origin?{
      'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Allow-Methods':'OPTIONS, POST',
      'Access-Control-Max-Age':'600'
    }:{};
    if(source!==origin)return response(res,403,{ok:false,error:'Origen no autorizado.'},cors);
    if(req.method==='OPTIONS')return response(res,204,null,cors);
    if(req.method!=='POST')return response(res,405,{ok:false,error:'Método no permitido.'},cors);
    let actor='';
    try{
      const data=await parseBody(req,29*1024*1024);
      actor=verify(data.initData,telegram.config.token);
      if(!telegram.admins().has(actor))return response(res,403,{ok:false,error:'Acceso reservado a administradores.'},cors);
      if(!throttle(actor,data.action==='upload'))return response(res,429,{ok:false,error:'Demasiadas solicitudes.'},cors);
      cleanup(Date.now());
      let session=sessions.get(actor);
      if(!session||session.telegram!==telegram){session=new AdminSession(telegram,actor);sessions.set(actor,session);}
      session.updated=Date.now();
      let release;const next=new Promise(done=>{release=done;});
      const prev=session.chain;session.chain=next;
      await prev;
      try{return response(res,200,await session.run(data),cors);}
      finally{session.updated=Date.now();release();}
    }catch(error){
      console.warn('WHATSAPP: admin_miniapp_error',JSON.stringify({kind:error?.name||'Error'}));
      return response(res,400,{ok:false,error:String(error?.message||'No se pudo completar la solicitud.').slice(0,250)},cors);
    }
  };
}
