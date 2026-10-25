import {PanelAccess} from './panel-access.js';
import {BaileysStore} from './baileys-store.js';
import {toJid,describe} from './baileys.js';
const cookie=(req,key)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';
const fail=(status,message)=>{const e=Error(message);e.status=status;throw e;};
const peerOK=peer=>/^\d+@(s\.whatsapp\.net|lid|g\.us)$/.test(peer||'');
const publicId=value=>Buffer.from(value).toString('base64url');
const internalId=value=>{if(typeof value!=='string'||value.length>2000||!/^[\w-]+$/.test(value))fail(400,'Archivo no válido.');return Buffer.from(value,'base64url').toString();};
export class WebPanel{
 constructor(store,accounts,telegram,options){this.store=store;this.accounts=accounts;this.telegram=telegram;this.options=options;this.access=new PanelAccess(store,id=>telegram.admins().has(String(id))?'admin':telegram.permissions().has(String(id))?'operator':null);this.media=new Map();this.downloads=new Map();this.rates=new Map();}
 role(actor){return this.access.role(String(actor));}
 referral(req){return this.access.referral(cookie(req,'wa_referral'));}
 consent(account,req,reference){const ref=typeof reference==='string'?reference:'';if(ref)return this.access.attach(account,ref);return null;}
 async telegramMenu(chat,actor){const rows=this.access.accounts(actor),connected=rows.filter(a=>this.accounts.live.get(a.id)?.ready).length;return this.telegram.send(chat,`WHATSAPP · MI CUENTA\nCuentas vinculadas: ${rows.length}\nConectadas ahora: ${connected}`,{inline_keyboard:[[{text:'🤖 CUENTAS',callback_data:'op:accounts',style:'primary'}],[{text:'🔗 GENERAR ENLACE WEB',callback_data:'op:referral',style:'success'}],[{text:'🖥 ABRIR PANEL WEB',callback_data:'op:panel',style:'primary'}]]});}
 async telegramAction(chat,actor,action){
  if(action==='referral'){const code=this.access.token(actor,'referral');return this.telegram.send(chat,`TU ENLACE DE VINCULACIÓN\n\n${this.options.url}/vincular/${code}\n\nVálido 30 días. Las cuentas que autoricen el acceso desde este enlace quedarán asociadas a ti y podrán ser revisadas por los administradores. Generar otro enlace revoca el anterior. No modifica cuentas ya asignadas.`,{inline_keyboard:[[{text:'VOLVER',callback_data:'op:menu',style:'primary'}]]});}
  if(action==='panel'){const code=this.access.token(actor,'login');return this.telegram.send(chat,'PANEL WEB · Acceso personal, de un solo uso, válido 5 minutos. No lo compartas.',{inline_keyboard:[[{text:'🖥 ABRIR MI PANEL',url:this.options.url+'/panel#'+code,style:'primary'}]]});}
  if(action==='accounts'){const rows=this.access.accounts(actor);return this.telegram.send(chat,rows.length?rows.map((a,i)=>`${i+1}. ${this.store.profile(a.id,a.phone+'@c.us')?.name||a.name||'Cuenta'} · +${a.phone}\n${this.accounts.live.get(a.id)?.ready?'Conectada':'Desconectada'}`).join('\n\n'):'Aún no tienes cuentas vinculadas mediante tu enlace.',{inline_keyboard:[[{text:'ABRIR CUENTAS EN LA WEB',callback_data:'op:panel',style:'primary'}],[{text:'VOLVER',callback_data:'op:menu'}]]});}
  return this.telegramMenu(chat,actor);
 }
 limit(key,max=60){const now=Date.now();let item=this.rates.get(key);if(!item||now-item.at>60000){item={at:now,n:0};this.rates.set(key,item);}if(++item.n>max)fail(429,'Espera un momento antes de repetir.');if(this.rates.size>10000)for(const [key,value]of this.rates)if(now-value.at>60000)this.rates.delete(key);}
 account(actor,id){if(!/^[a-f0-9]{16}$/.test(id||'')||!this.access.allowed(actor,id))fail(404,'Cuenta no disponible.');return this.store.account(id);}
 storage(actor,id){this.account(actor,id);return new BaileysStore(this.store,id);}
 message(actor,id,encoded){const db=this.storage(actor,id),key=internalId(encoded),raw=db.get('message',key);if(!raw||!peerOK(toJid(raw.key?.remoteJid)))fail(404,'Archivo no disponible.');const d=describe(raw);if(d.ephemeral||d.viewOnce)fail(404,'Contenido protegido no disponible.');return {db,raw,d,key};}
 messages(actor,id,peer,before,media=false){
  const db=this.storage(actor,id);if(!peerOK(peer))fail(400,'Conversación no válida.');let at=Number.MAX_SAFE_INTEGER,row=Number.MAX_SAFE_INTEGER;
  if(before){try{[at,row]=JSON.parse(Buffer.from(before,'base64url').toString());}catch{fail(400,'Página no válida.');}if(!Number.isSafeInteger(at)||!Number.isSafeInteger(row))fail(400,'Página no válida.');}
  const filter=media?" AND (json_type(value,'$.message.imageMessage') IS NOT NULL OR json_type(value,'$.message.videoMessage') IS NOT NULL)":'';
  const rows=this.store.db.prepare("SELECT rowid,id,timestamp FROM baileys_data WHERE account=? AND kind='message' AND peer=? AND (timestamp<? OR (timestamp=? AND rowid<?))"+filter+' ORDER BY timestamp DESC,rowid DESC LIMIT 61').all(id,peer,at,at,row),page=rows.slice(0,60),items=[];
  for(const entry of page){const raw=db.get('message',entry.id),d=describe(raw);if(d.ephemeral||d.viewOnce)continue;items.push({id:publicId(entry.id),timestamp:Number(raw.messageTimestamp)||0,fromMe:!!raw.key.fromMe,sender:String(raw.pushName||raw.key.participant?.split('@')[0]||''),type:d.type,text:String(d.body).slice(0,16000),media:!!d.media,name:String(d.media?.fileName||d.type).slice(0,150),mime:String(d.media?.mimetype||''),size:Number(d.media?.fileLength)||0,thumbnail:!!d.media?.jpegThumbnail});}
  const last=page.at(-1);return {items:items.reverse(),next:rows.length>60?publicId(JSON.stringify([Number(last.timestamp),Number(last.rowid)])):null};
 }
 async mediaData(id,key,raw){
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
   if(route.startsWith('/vincular/')){const code=route.slice('/vincular/'.length);if(req.method!=='GET'||!this.access.referral(code))return json(410,{error:'Este enlace venció o fue revocado. Solicita uno nuevo en Telegram.'});res.writeHead(302,{...headers,'Set-Cookie':setCookie('wa_referral',code,86400),Location:'/cubamax'});res.end();return;}
   const mutate=req.method==='POST';if(mutate&&!this.options.allowedOrigins.has(req.headers.origin))return json(403,{error:'Origen no autorizado.'});
   if(route==='/api/panel/login'&&mutate){this.limit('login:'+req.socket.remoteAddress,15);const input=await readBody(req),session=this.access.login(input.token);if(!session)return json(401,{error:'El acceso venció o ya fue usado. Solicita otro desde Telegram.'});return json(200,{ok:true},{'Set-Cookie':setCookie('wa_panel',session.secret,7*86400)});}
   const value=cookie(req,'wa_panel'),session=this.access.session(value);if(!session)return json(401,{error:'Abre tu acceso personal desde el menú de Telegram.'});
   this.limit('user:'+session.actor,180);if(mutate&&req.headers['x-panel-csrf']!==session.csrf)return json(403,{error:'Recarga el panel para continuar.'});
   const url=new URL(req.url,'http://local'),id=url.searchParams.get('account'),peer=toJid(url.searchParams.get('peer')||'');
   if(route==='/api/panel/me'&&req.method==='GET')return json(200,{actor:session.actor,name:this.access.label(session.actor),role:session.role,csrf:session.csrf});
   if(route==='/api/panel/logout'&&mutate){this.access.logout(value);return json(200,{ok:true},{'Set-Cookie':setCookie('wa_panel','',0)});}
   if(route==='/api/panel/accounts'&&req.method==='GET')return json(200,{items:this.access.accounts(session.actor).map(a=>{const owner=this.access.owner(a.id);return {id:a.id,phone:a.phone,name:this.store.profile(a.id,a.phone+'@c.us')?.name||a.name||'Cuenta de WhatsApp',connected:!!this.accounts.live.get(a.id)?.ready,owner:owner?{id:owner,name:this.access.label(owner)}:null};})});
   if(route==='/api/panel/chats'&&req.method==='GET'){
    const db=this.storage(session.actor,id),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),query=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,80);
    const chats=db.list('chat',100000).filter(c=>peerOK(toJid(c.id))).map(c=>{const contact=db.get('contact',toJid(c.id))||{},profile=this.store.profile(id,toJid(c.id).replace('@s.whatsapp.net','@c.us'));return {peer:toJid(c.id),name:String(c.name||c.subject||contact.name||contact.notify||profile?.name||c.id.split('@')[0]),timestamp:Number(c.conversationTimestamp)||0,unread:Number(c.unreadCount)||0,group:c.id.endsWith('@g.us')};}).filter(c=>!query||(c.name+' '+c.peer).toLowerCase().includes(query));return json(200,{items:chats.slice(offset,offset+80),next:chats.length>offset+80?offset+80:null});
   }
   if((route==='/api/panel/messages'||route==='/api/panel/gallery')&&req.method==='GET')return json(200,this.messages(session.actor,id,peer,url.searchParams.get('before'),route.endsWith('gallery')));
   if((route==='/api/panel/media'||route==='/api/panel/thumb')&&req.method==='GET'){
    const {raw,d,key}=this.message(session.actor,id,url.searchParams.get('message'));if(!d.media)fail(404,'Sin archivo adjunto.');
    if(route.endsWith('thumb')){if(!d.media.jpegThumbnail){res.writeHead(204,headers);return res.end();}const data=Buffer.from(d.media.jpegThumbnail);if(data.length>256000)fail(413,'Vista previa no disponible.');res.writeHead(200,{...headers,'Content-Type':'image/jpeg','Content-Length':data.length});return res.end(data);}
    this.limit('media:'+session.actor,30);const media=await this.mediaData(id,key,raw);media.mime=String(media.mime||'application/octet-stream').split(';')[0].trim().toLowerCase();const allowed=/^(image\/(jpeg|png|gif|webp)|video\/mp4|audio\/(ogg|mpeg|mp4|aac|wav|webm))$/.test(media.mime),attachment=url.searchParams.get('download')==='1'||!allowed,name=String(media.name||'archivo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100),extra={...headers,'Content-Type':allowed?media.mime:'application/octet-stream','Content-Disposition':`${attachment?'attachment':'inline'}; filename="${name}"`,'Accept-Ranges':'bytes'};
    if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match)fail(416,'Rango no disponible.');const start=Number(match[1]),end=Math.min(media.data.length-1,match[2]?Number(match[2]):media.data.length-1);if(start>end||start>=media.data.length)fail(416,'Rango no disponible.');res.writeHead(206,{...extra,'Content-Range':`bytes ${start}-${end}/${media.data.length}`,'Content-Length':end-start+1});return res.end(media.data.subarray(start,end+1));}res.writeHead(200,{...extra,'Content-Length':media.data.length});return res.end(media.data);
   }
   if(route==='/api/panel/sync'&&mutate){const input=await readBody(req);this.account(session.actor,input.account);const target=toJid(input.peer);if(!peerOK(target))fail(400,'Conversación no válida.');this.limit('sync:'+input.account,3);const client=this.accounts.live.get(input.account)?.client;if(!this.accounts.live.get(input.account)?.ready||!client?.syncHistory)fail(409,'La cuenta no está conectada.');await client.syncHistory(target);return json(202,{ok:true,message:'Solicitud enviada. El historial se actualizará cuando WhatsApp lo entregue.'});}
   if(route==='/api/panel/send'&&mutate){const input=await readBody(req);this.account(session.actor,input.account);if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(toJid(input.peer))||typeof input.text!=='string'||!input.text.trim()||input.text.length>3000||!/^[a-f0-9]{32}$/.test(input.request||''))fail(400,'Mensaje no válido.');this.limit('send:'+session.actor,20);const claim=this.store.db.prepare("INSERT OR IGNORE INTO panel_sends VALUES(?,?,?,'sending',?)").run(session.actor,input.request,input.account,Date.now());if(!claim.changes)fail(409,'Este envío ya se procesó. Comprueba la conversación antes de repetir.');try{await this.accounts.send(input.account,toJid(input.peer).replace('@s.whatsapp.net','@c.us'),input.text.trim());this.store.db.prepare("UPDATE panel_sends SET state='sent' WHERE actor=? AND request=?").run(session.actor,input.request);}catch{this.store.db.prepare("UPDATE panel_sends SET state='review' WHERE actor=? AND request=?").run(session.actor,input.request);fail(409,'No se pudo confirmar el envío. Revisa la conversación antes de repetir.');}return json(200,{ok:true});}
   return json(404,{error:'Opción no disponible.'});
  }catch(error){if(!res.headersSent)return json(error.status||500,{error:error.status?error.message:'No se pudo completar la consulta. Vuelve a intentarlo.'});res.end();}
 }
}
