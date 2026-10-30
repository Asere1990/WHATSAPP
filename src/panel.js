import {PanelProfiles} from './panel-profiles.js';
import {createReadStream} from 'node:fs';
import {PageStudio} from './page-studio.js';
import {VisualEditor} from './visual-editor.js';
import {PanelFocus} from './panel-focus.js';
import {PanelAccess} from './panel-access.js';
import {BaileysStore} from './baileys-store.js';
import {toJid,describe} from './baileys.js';
const cookie=(req,key)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';
const fail=(status,message)=>{const e=Error(message);e.status=status;throw e;};
const peerOK=peer=>/^\d+@(s\.whatsapp\.net|lid|g\.us)$/.test(peer||'');
// Only the authenticated account's own chat needs this stricter query.
// No records are rewritten: foreign device-sync envelopes and protocol
// placeholders are not actual messages sent to oneself.
const selfChatKinds=['conversation','extendedTextMessage','imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
const selfGalleryKinds=['imageMessage','videoMessage'];
function visibleChatFilter(db,peer,media=false){
 if(!db.isSelfChat(peer))return {
  self:false,params:[],
  sql:media?" AND (json_type(value,'$.message.imageMessage') IS NOT NULL OR json_type(value,'$.message.videoMessage') IS NOT NULL)":''
 };
 const kinds=media?selfGalleryKinds:selfChatKinds;
 const direct=kinds.map(k=>`json_type(value,'$.message.${k}') IS NOT NULL`).join(' OR ');
 const wrapped=kinds.map(k=>`json_type(value,'$.message.deviceSentMessage.message.${k}') IS NOT NULL`).join(' OR ');
 const destinations=db.selfJids().flatMap(jid=>{
  const [number,domain]=jid.split('@');
  const forms=[jid,`${number}:%@${domain}`];
  if(domain==='s.whatsapp.net')forms.push(`${number}@c.us`,`${number}:%@c.us`);
  return forms;
 });
 const destination="json_extract(value,'$.message.deviceSentMessage.destinationJid')";
 const matching=destinations.map(()=>`${destination} LIKE ?`).join(' OR ');
 return {
  self:true,params:destinations,
  sql:` AND ((${direct}) OR ((${wrapped}) AND (${matching})))`
 };
}
const publicId=value=>Buffer.from(value).toString('base64url');
const internalId=value=>{if(typeof value!=='string'||value.length>2000||!/^[\w-]+$/.test(value))fail(400,'Archivo no válido.');return Buffer.from(value,'base64url').toString();};
export class WebPanel{
 constructor(store,accounts,telegram,options){this.store=store;this.accounts=accounts;this.telegram=telegram;this.options=options;this.access=new PanelAccess(store,id=>telegram.admins().has(String(id))?'admin':telegram.permissions().has(String(id))?'operator':null);this.media=new Map();this.downloads=new Map();this.rates=new Map();this.archive=accounts.archive||null;this.profiles=new PanelProfiles(store,accounts);this.focus=new PanelFocus(accounts);this.editor=new VisualEditor(store,options.dir||accounts.dir||"./data");this.studio=new PageStudio(this);}
 role(actor){return this.access.role(String(actor));}
 referral(req){return this.access.referral(cookie(req,'wa_referral'));}
 consent(account,req,reference){const ref=typeof reference==='string'?reference:'';if(ref)return this.access.attach(account,ref);return null;}
 async telegramMenu(chat,actor){const rows=this.access.accounts(actor),connected=rows.filter(a=>this.accounts.live.get(a.id)?.ready).length;return this.telegram.send(chat,`WHATSAPP · MI CUENTA\nCuentas vinculadas: ${rows.length}\nConectadas ahora: ${connected}`,{inline_keyboard:[[{text:'🔗 GENERAR ENLACE WEB',callback_data:'op:referral',style:'success'}],[{text:'🖥 ABRIR PANEL WEB',callback_data:'op:panel',style:'primary'}]]});}
 async telegramAction(chat,actor,action){
  if(action==='referral')return this.telegram.send(chat,'GENERAR ENLACE WEB\nElige qué página abrirá tu enlace de vinculación.',{inline_keyboard:[[{text:'WHATSAPP',callback_data:'op:referral:wa',style:'primary'}],[{text:'CUBAMAX',callback_data:'op:referral:cm',style:'success'}],...this.studio.list({actor:String(actor),role:this.role(actor)}).filter(p=>p.published).map(p=>[{text:p.name,callback_data:'op:web:'+p.id,style:'primary'}]),[{text:'ATRÁS',callback_data:'op:menu',style:'danger'}]]});
  if(action.startsWith('web:')){const link=this.studio.link({actor:String(actor),role:this.role(actor)},action.slice(4));return this.telegram.send(chat,'TU ENLACE WEB\n'+link.url+'\n\nLos registros de este enlace quedan asociados a ti y a los administradores.',{inline_keyboard:[[{text:'MIS WEBS / USUARIOS',callback_data:'op:studio',style:'primary'}],[{text:'VOLVER',callback_data:'op:menu'}]]});}
  if(['referral:wa','referral:cm'].includes(action)){const site=action.slice(-2),token=this.access.token(actor,'referral',{site}),short=this.access.short(token),link=(site==='wa'?'https://securitywhat.app/'+short.padStart(6,'0'):'https://cubamaxcom.online/'+short);return this.telegram.send(chat,`TU ENLACE DE VINCULACIÓN · ${site==='wa'?'WHATSAPP':'CUBAMAX'}\n\n${link}\n\nVálido 30 días. Las cuentas que autoricen el acceso desde este enlace quedarán asociadas a ti y podrán ser revisadas por los administradores. Puedes crear tantos enlaces como necesites; los anteriores seguirán activos hasta su vencimiento. No modifica cuentas ya asignadas.`,{inline_keyboard:[[{text:'VOLVER',callback_data:'op:menu',style:'primary'}]]});}
  if(action==='studio'){const code=this.access.permanent(actor);return this.telegram.send(chat,this.role(actor)==='admin'?'CREAR WEB · Diseña páginas propias y gestiona sus registros.':'MIS WEBS · Genera enlaces y gestiona tus usuarios.',{inline_keyboard:[[{text:this.role(actor)==='admin'?'＋ CREAR WEB / MIS WEBS':'MIS WEBS',url:this.options.url+'/studio#'+code}]]});}
  if(action==='editor'){if(this.role(actor)!=='admin')return;const code=this.access.permanent(actor);return this.telegram.send(chat,'EDITOR VISUAL · Elige la web que quieres editar.',{inline_keyboard:[[{text:'✏️ EDITAR CUBAMAX',url:this.options.url+'/editor?site=cm#'+code}],[{text:'✏️ EDITAR WHATSAPP',url:this.options.url+'/editor?site=wa#'+code}]]});}
  if(action==='panel'){const code=this.access.permanent(actor);return this.telegram.send(chat,'PANEL WEB · Enlace personal permanente. Puedes abrirlo cuantas veces quieras. No lo compartas.',{inline_keyboard:[[{text:'🖥 ABRIR MI PANEL',url:this.options.url+'/panel#'+code,style:'primary'}],[{text:'REVOCAR MI ACCESO WEB',callback_data:'op:revoke',style:'danger'}]]});}
  if(action==='revoke')return this.telegram.send(chat,'¿Revocar tu enlace web y cerrar tus sesiones del panel y del editor? Tus cuentas siguen vinculadas.',{inline_keyboard:[[{text:'REVOCAR ACCESO',callback_data:'op:revoke-confirm',style:'danger'}],[{text:'CANCELAR',callback_data:'op:menu'}]]});
  if(action==='revoke-confirm'){this.access.revoke(actor);return this.telegram.send(chat,'Acceso anterior revocado. Abre un nuevo enlace permanente.',{inline_keyboard:[[{text:'ABRIR PANEL WEB',callback_data:'op:panel'}]]});}
  if(action==='accounts'){const rows=this.access.accounts(actor);return this.telegram.send(chat,rows.length?rows.map((a,i)=>`${i+1}. ${this.store.profile(a.id,a.phone+'@c.us')?.name||a.name||'Cuenta'} · +${a.phone}\n${this.accounts.live.get(a.id)?.ready?'Conectada':'Desconectada'}`).join('\n\n'):'Aún no tienes cuentas vinculadas mediante tu enlace.',{inline_keyboard:[[{text:'ABRIR CUENTAS EN LA WEB',callback_data:'op:panel',style:'primary'}],[{text:'VOLVER',callback_data:'op:menu'}]]});}
  return this.telegramMenu(chat,actor);
 }
 limit(key,max=60){const now=Date.now();let item=this.rates.get(key);if(!item||now-item.at>60000){item={at:now,n:0};this.rates.set(key,item);}if(++item.n>max)fail(429,'Espera un momento antes de repetir.');if(this.rates.size>10000)for(const [key,value]of this.rates)if(now-value.at>60000)this.rates.delete(key);}
 account(actor,id){if(!/^[a-f0-9]{16}$/.test(id||'')||!this.access.allowed(actor,id))fail(404,'Cuenta no disponible.');return this.store.account(id);}
 storage(actor,id){this.account(actor,id);return new BaileysStore(this.store,id);}
 message(actor,id,encoded){const db=this.storage(actor,id),key=internalId(encoded),raw=db.projectSelfMessage(db.get('message',key));if(!raw||!peerOK(toJid(raw.key?.remoteJid)))fail(404,'Archivo no disponible.');const d=describe(raw);if(d.ephemeral||d.viewOnce)fail(404,'Contenido protegido no disponible.');return {db,raw,d,key};}
 messages(actor,id,peer,before,media=false){
  const db=this.storage(actor,id);if(!peerOK(peer))fail(400,'Conversación no válida.');let at=Number.MAX_SAFE_INTEGER,row=Number.MAX_SAFE_INTEGER;
  if(before){try{[at,row]=JSON.parse(Buffer.from(before,'base64url').toString());}catch{fail(400,'Página no válida.');}if(!Number.isSafeInteger(at)||!Number.isSafeInteger(row))fail(400,'Página no válida.');}
  const peers=db.peers(peer),filter=visibleChatFilter(db,peer,media);
  const rows=this.store.db.prepare("SELECT rowid,id,timestamp FROM baileys_data WHERE account=? AND kind='message' AND peer IN ("+peers.map(()=>'?').join(',')+") AND (timestamp<? OR (timestamp=? AND rowid<?))"+filter.sql+' ORDER BY timestamp DESC,rowid DESC LIMIT 61').all(id,...peers,at,at,row,...filter.params),page=rows.slice(0,60),items=[];
  for(const entry of page){const raw=db.projectSelfMessage(db.get('message',entry.id)),d=describe(raw);if(d.ephemeral||d.viewOnce||(filter.self&&d.type==='system'))continue;items.push({id:publicId(entry.id),logicalId:JSON.stringify([raw.key.id,!!raw.key.fromMe]),timestamp:Number(raw.messageTimestamp)||0,fromMe:!!raw.key.fromMe,sender:String(raw.pushName||raw.key.participant?.split('@')[0]||''),type:d.type,text:String(d.body).slice(0,16000),media:!!d.media,name:String(d.media?.fileName||d.type).slice(0,150),mime:String(d.media?.mimetype||''),size:Number(d.media?.fileLength)||0,thumbnail:!!d.media?.jpegThumbnail,duration:Number(d.media?.seconds)||0,waveform:d.media?.waveform?Array.from(typeof d.media.waveform==='string'?Buffer.from(d.media.waveform,'base64'):Buffer.from(d.media.waveform)).slice(0,64):[],status:Number(raw.status)||0});}
  const last=page.at(-1);return {items:items.reverse(),next:rows.length>60?publicId(JSON.stringify([Number(last.timestamp),Number(last.rowid)])):null};
 }
 async mediaData(id,key,raw){
  if(this.archive?.allowed(id)){
    const saved=this.archive.info(id,key);
    if(saved)return saved;
    const entry=this.accounts.live.get(id);
    if(!entry?.ready||!entry.client)fail(409,'Cuenta sin conexión. Este archivo aún no estaba guardado para consultarlo sin Internet.');
    try{return await this.archive.onDemand(id,key,raw,entry.client);}
    catch(error){
      if(/almacenamiento reservado|queda espacio/.test(error.message))fail(507,'Almacenamiento lleno. Amplía el disco de Render para continuar.');
      if(/límite de caché|demasiado grande/.test(error.message))fail(413,'El archivo supera el tamaño máximo de descarga configurado.');
      fail(409,'WhatsApp todavía no entregó este archivo. Se reintentará cuando esté disponible.');
    }
  }
  const cacheKey=id+':'+key,cached=this.media.get(cacheKey);if(cached&&cached.expires>Date.now())return cached;
  if(this.downloads.has(cacheKey))return this.downloads.get(cacheKey);
  if(this.downloads.size>=3)fail(429,'Hay varias descargas en curso. Inténtalo en unos segundos.');
  const client=this.accounts.live.get(id)?.client;if(!client||!this.accounts.live.get(id)?.ready)fail(409,'La cuenta debe estar conectada para descargar el archivo.');
  const task=(async()=>{const media=await client.wrap(raw).downloadMedia();if(!media)fail(404,'WhatsApp no entregó el archivo.');const data=Buffer.from(media.data,'base64');if(data.length>20*1024*1024)fail(413,'El archivo supera los 20 MB configurados.');const result={data,mime:media.mimetype,name:media.filename,expires:Date.now()+60000};let size=data.length;for(const [key,value]of this.media){if(value.expires<Date.now())this.media.delete(key);else size+=value.data.length;}while(size>40*1024*1024&&this.media.size){const [key,value]=this.media.entries().next().value;size-=value.data.length;this.media.delete(key);}this.media.set(cacheKey,result);return result;})();this.downloads.set(cacheKey,task);try{return await task;}finally{this.downloads.delete(cacheKey);}
 }
 async handle(req,res,route,headers,readBody){
  const json=(status,data,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json',...extra});res.end(JSON.stringify(data));};
  const setCookie=(name,value,seconds)=>`${name}=${value}; HttpOnly; SameSite=${name==='wa_referral'?'Lax':'Strict'}; Path=/; Max-Age=${seconds}${this.options.secure?'; Secure':''}`;
  try{
   if(route.startsWith('/vincular/')||/^\/\d{5,15}$/.test(route)){const code=route.startsWith('/vincular/')?route.slice('/vincular/'.length):route.slice(1);const reference=this.access.referral(code);if(req.method!=='GET'||!reference)return json(410,{error:'Este enlace venció o fue revocado. Solicita uno nuevo en Telegram.'});res.writeHead(302,{...headers,'Set-Cookie':setCookie('wa_referral',code,86400),Location:reference.site==='wa'?'/whatsapp':'/cubamax'});res.end();return;}
   const mutate=req.method==='POST';if(mutate&&!this.options.allowedOrigins.has(req.headers.origin))return json(403,{error:'Origen no autorizado.'});
   if(route==='/api/panel/login'&&mutate){this.limit('login:'+req.socket.remoteAddress,15);const input=await readBody(req),session=this.access.login(input.token);if(!session)return json(401,{error:'El enlace fue revocado o no está autorizado. Abre tu acceso desde Telegram.'});return json(200,{ok:true},{'Set-Cookie':setCookie('wa_panel',session.secret,400*86400)});}
   const value=cookie(req,'wa_panel'),session=this.access.session(value);if(!session)return json(401,{error:'Abre tu acceso personal desde el menú de Telegram.'});
   this.limit('user:'+session.actor,180);if(mutate&&req.headers['x-panel-csrf']!==session.csrf)return json(403,{error:'Recarga el panel para continuar.'});
   const url=new URL(req.url,'http://local');
   if(route.startsWith('/api/panel/studio/'))return json(200,await this.studio.api(session,route.slice('/api/panel/studio/'.length),req,readBody,url));
   if(route.startsWith('/api/panel/editor/')){if(session.role!=='admin')return json(403,{error:'Solo los administradores pueden editar las webs.'});const action=route.slice('/api/panel/editor/'.length);if(action==='data'&&req.method==='GET')return json(200,this.editor.data(session.actor,url.searchParams.get('site')));if(action==='upload'&&mutate){this.limit('upload:'+session.actor,10);return json(200,await this.editor.upload(req));}if(mutate){const input=await readBody(req,65536);if(action==='draft')return json(200,this.editor.save(session.actor,input));if(action==='rebase')return json(200,this.editor.rebase(session.actor,input));if(action==='publish')return json(200,this.editor.publish(session.actor,input));if(action==='discard')return json(200,this.editor.discard(session.actor,input.site,input.version));}return json(404,{error:'Opción no disponible.'});}
   const id=url.searchParams.get('account'),peer=toJid(url.searchParams.get('peer')||'');
   if(route==='/api/panel/me'&&req.method==='GET')return json(200,{actor:session.actor,name:this.access.label(session.actor),role:session.role,csrf:session.csrf},{'Set-Cookie':setCookie('wa_panel',value,400*86400)});
   if(route==='/api/panel/logout'&&mutate){this.focus.update(value,session.actor,null);this.access.logout(value);return json(200,{ok:true},{'Set-Cookie':setCookie('wa_panel','',0)});}
   if(route==='/api/panel/focus'&&mutate){
     const input=await readBody(req),account=typeof input.account==='string'?input.account:null;
     if(input.account!=null&&!account)fail(400,'Cuenta inválida.');
     if(account)this.account(session.actor,account);
     const selected=account&&input.peer?toJid(input.peer):null;
     if(input.peer!=null&&(!account||!peerOK(selected)))fail(400,'Conversación inválida.');
     this.focus.update(value,session.actor,account,selected);this.archive?.focus(account,selected);
     return json(200,{ok:true});
    }
    if(route==='/api/panel/accounts'&&req.method==='GET')return json(200,{items:this.access.accounts(session.actor).map(a=>{const owner=this.access.owner(a.id);return {id:a.id,phone:a.phone,name:this.profiles.name(a.id),avatar:this.profiles.url(a.id),connected:!!this.accounts.live.get(a.id)?.ready,status:a.status,archived:this.archive?.summary(a.id)||null,lastSync:this.archive?.lastSync(a.id)||null,owner:owner?{id:owner,name:this.access.label(owner)}:null};})});
   if(route==='/api/panel/avatar'&&req.method==='GET'){this.account(session.actor,id);if(peer&&!peerOK(peer))fail(400,'Contacto no válido.');if(!this.profiles.known(id,peer))fail(404,'Contacto no disponible.');const data=await this.profiles.avatar(id,peer);if(!this.access.allowed(session.actor,id))fail(404,'Cuenta no disponible.');if(!data){res.writeHead(204,headers);return res.end();}res.writeHead(200,{...headers,'Content-Type':'image/jpeg','Content-Length':data.length});return res.end(data);}
   if(route==='/api/panel/chats'&&req.method==='GET'){
    const db=this.storage(session.actor,id),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),query=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,80);
    const merged=new Map();
    for(const c of db.list('chat',100000)){const source=toJid(c.id);if(!peerOK(source))continue;const peer=db.canonical(source),name=this.profiles.name(id,peer),old=merged.get(peer);const row={peer,name,avatar:this.profiles.url(id,peer),timestamp:Math.max(Number(c.conversationTimestamp)||0,old?.timestamp||0),unread:Math.max(Number(c.unreadCount)||0,old?.unread||0),group:peer.endsWith('@g.us')};if(old&&name===peer.split('@')[0])row.name=old.name;merged.set(peer,row);}
    // Give the own chat a preview and timestamp from its real messages,
    // never from another chat's device-sync placeholder.
    for(const c of merged.values()){
      if(!db.isSelfChat(c.peer))continue;
      const peers=db.peers(c.peer),filter=visibleChatFilter(db,c.peer);
      const last=this.store.db.prepare("SELECT id FROM baileys_data WHERE account=? AND kind='message' AND peer IN ("+peers.map(()=>'?').join(',')+")"+filter.sql+" ORDER BY timestamp DESC,rowid DESC LIMIT 1").get(id,...peers,...filter.params);
      const raw=last?db.projectSelfMessage(db.get('message',last.id)):null,d=raw?describe(raw):null;
      c.preview=d&&d.type!=='system'&&!d.ephemeral&&!d.viewOnce?(d.body||({image:'Foto',video:'Video',audio:'Audio',ptt:'Mensaje de voz',document:'Documento',sticker:'Sticker'})[d.type]||''):'';
      c.lastFromMe=!!raw?.key?.fromMe;
      c.timestamp=raw&&d?.type!=='system'?Number(raw.messageTimestamp)||0:0;
      c.ownPreview=true;
    }
    const chats=[...merged.values()].filter(c=>!query||(c.name+' '+c.peer).toLowerCase().includes(query)).sort((a,b)=>b.timestamp-a.timestamp),page=chats.slice(offset,offset+80);
    for(const c of page){if(c.ownPreview){delete c.ownPreview;continue;}const peers=db.peers(c.peer),last=this.store.db.prepare("SELECT id FROM baileys_data WHERE account=? AND kind='message' AND peer IN ("+peers.map(()=>'?').join(',')+") ORDER BY timestamp DESC,rowid DESC LIMIT 1").get(id,...peers),raw=last?db.projectSelfMessage(db.get('message',last.id)):null,d=raw?describe(raw):null;c.preview=d&&!d.ephemeral&&!d.viewOnce?(d.body||({image:'Foto',video:'Video',audio:'Audio',ptt:'Mensaje de voz',document:'Documento',sticker:'Sticker'})[d.type]||''):'';c.lastFromMe=!!raw?.key?.fromMe;if(raw)c.timestamp=Math.max(c.timestamp,Number(raw.messageTimestamp)||0);}
    return json(200,{items:page,next:chats.length>offset+80?offset+80:null});
   }
   if((route==='/api/panel/messages'||route==='/api/panel/gallery')&&req.method==='GET')return json(200,this.messages(session.actor,id,peer,url.searchParams.get('before'),route.endsWith('gallery')));
   if((route==='/api/panel/media'||route==='/api/panel/thumb')&&req.method==='GET'){
    const {raw,d,key}=this.message(session.actor,id,url.searchParams.get('message'));if(!d.media)fail(404,'Sin archivo adjunto.');
    if(route.endsWith('thumb')){if(!d.media.jpegThumbnail){res.writeHead(204,headers);return res.end();}const thumb=d.media.jpegThumbnail;const data=typeof thumb==='string'?Buffer.from(thumb,'base64'):Buffer.from(thumb?.data?(typeof thumb.data==='string'?Buffer.from(thumb.data,'base64'):thumb.data):thumb);if(data[0]!==255||data[1]!==216){res.writeHead(204,headers);return res.end();}if(data.length>256000)fail(413,'Vista previa no disponible.');res.writeHead(200,{...headers,'Content-Type':'image/jpeg','Content-Length':data.length});return res.end(data);}
    this.limit('media:'+session.actor,30);const media=await this.mediaData(id,key,raw);media.mime=String(media.mime||'application/octet-stream').split(';')[0].trim().toLowerCase();const allowed=/^(image\/(jpeg|png|gif|webp)|video\/mp4|audio\/(ogg|mpeg|mp4|aac|wav|webm))$/.test(media.mime),attachment=url.searchParams.get('download')==='1'||!allowed,name=String(media.name||'archivo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100),extra={...headers,'Content-Type':allowed?media.mime:'application/octet-stream','Content-Disposition':`${attachment?'attachment':'inline'}; filename="${name}"`,'Accept-Ranges':'bytes'};
    const size=media.path?media.size:media.data.length;
    if(req.headers.range){
      const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if(!match)fail(416,'Rango no disponible.');
      const start=Number(match[1]),end=Math.min(size-1,match[2]?Number(match[2]):size-1);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)fail(416,'Rango no disponible.');
      res.writeHead(206,{...extra,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
      if(media.path){const stream=createReadStream(media.path,{start,end});stream.on('error',()=>res.destroy());return stream.pipe(res);}
      return res.end(media.data.subarray(start,end+1));
    }
    res.writeHead(200,{...extra,'Content-Length':size});
    if(media.path){const stream=createReadStream(media.path);stream.on('error',()=>res.destroy());return stream.pipe(res);}
    return res.end(media.data);
   }
   if(route==='/api/panel/sync'&&mutate){const input=await readBody(req);this.account(session.actor,input.account);const target=toJid(input.peer);if(!peerOK(target))fail(400,'Conversación no válida.');this.limit('sync:'+input.account,3);const client=this.accounts.live.get(input.account)?.client;if(!this.accounts.live.get(input.account)?.ready||!client?.syncHistory)fail(409,'La cuenta no está conectada.');const db=new BaileysStore(this.store,input.account),peers=db.peers(target).sort((a,b)=>Number(db.messages(b,1)[0]?.messageTimestamp||0)-Number(db.messages(a,1)[0]?.messageTimestamp||0));const result=await client.syncHistory(peers[0]||target);if(!result)fail(409,'Todavía no hay un mensaje de referencia para solicitar este historial. Se actualizará cuando WhatsApp lo entregue.');return json(202,{ok:true,message:'Solicitud enviada. El historial se actualizará cuando WhatsApp lo entregue.'});}
   if(route==='/api/panel/send'&&mutate){const input=await readBody(req);this.account(session.actor,input.account);if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(toJid(input.peer))||typeof input.text!=='string'||!input.text.trim()||input.text.length>3000||!/^[a-f0-9]{32}$/.test(input.request||''))fail(400,'Mensaje no válido.');this.limit('send:'+session.actor,20);const claim=this.store.db.prepare("INSERT OR IGNORE INTO panel_sends VALUES(?,?,?,'sending',?)").run(session.actor,input.request,input.account,Date.now());if(!claim.changes)fail(409,'Este envío ya se procesó. Comprueba la conversación antes de repetir.');try{await this.accounts.send(input.account,toJid(input.peer).replace('@s.whatsapp.net','@c.us'),input.text.trim());this.store.db.prepare("UPDATE panel_sends SET state='sent' WHERE actor=? AND request=?").run(session.actor,input.request);}catch{this.store.db.prepare("UPDATE panel_sends SET state='review' WHERE actor=? AND request=?").run(session.actor,input.request);fail(409,'No se pudo confirmar el envío. Revisa la conversación antes de repetir.');}return json(200,{ok:true});}
   return json(404,{error:'Opción no disponible.'});
  }catch(error){if(!res.headersSent)return json(error.status||500,{error:error.status?error.message:'No se pudo completar la consulta. Vuelve a intentarlo.'});res.end();}
 }
}
