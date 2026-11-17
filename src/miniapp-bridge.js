// Capa de presentación aislada para Telegram Mini Apps.
// Reutiliza EXACTAMENTE PublicWaLinkBot, PublicWhatsAppLinks,
// PublicCubamaxLinks, PublicWaSender y los textos del editor actual.
// No modifica los handlers, sesiones, cuentas ni mensajes del bot.
import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {PublicWaLinkBot} from './public-wa-links-bot.js';

const miniappOrigin='https://whatsapp-cubamax-miniapp.onrender.com';
const maxAge=6*60*60, idle=30*60*1000;
const maxUpload=2*1024*1024;
const sessions=new Map();
const limits=new Map();
const reply=(res,status,body,headers={})=>{
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    ...headers
  });
  res.end(JSON.stringify(body));
};
function identity(raw,token){
  if(!token||typeof raw!=='string'||raw.length<20||raw.length>8192)throw Error('Abre la mini app desde el bot de Telegram.');
  const params=new URLSearchParams(raw);
  if(params.getAll('hash').length!==1)throw Error('Acceso de Telegram no verificado.');
  const provided=params.get('hash')||'';
  if(!/^[0-9a-f]{64}$/i.test(provided))throw Error('Acceso de Telegram no verificado.');
  const entries=[...params.entries()];
  if(new Set(entries.map(([key])=>key)).size!==entries.length)throw Error('Acceso de Telegram no verificado.');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const check=entries.filter(([key])=>key!=='hash')
    .sort(([left],[right])=>left<right?-1:left>right?1:0)
    .map(([key,value])=>key+'='+value).join('\n');
  const actual=createHmac('sha256',secret).update(check).digest();
  if(!timingSafeEqual(actual,Buffer.from(provided,'hex')))throw Error('Acceso de Telegram no verificado.');
  const time=Number(params.get('auth_date'));
  const now=Math.floor(Date.now()/1000);
  if(!Number.isInteger(time)||time>now+120||time<now-maxAge)throw Error('La sesión de Telegram venció. Vuelve a abrir la mini app.');
  let user;
  try{user=JSON.parse(params.get('user')||'');}catch{}
  const actor=String(user?.id||'');
  if(!/^[1-9]\d{1,21}$/.test(actor))throw Error('Cuenta de Telegram no disponible.');
  const key=createHash('sha256').update(raw).digest('hex').slice(0,32);
  return {actor,key};
}
function rate(actor,photo){
  const key=actor+(photo?':photo':':normal');
  const now=Date.now();
  let entry=limits.get(key);
  if(!entry||now-entry.since>60000){entry={since:now,count:0};limits.set(key,entry);}
  return ++entry.count<=(photo?6:60);
}
async function requestBody(req,max){
  let bytes=0;
  const chunks=[];
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>max)throw Error('Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Solicitud inválida.');}
}
function sanitizeMarkup(markup){
  return (markup?.inline_keyboard||[]).flatMap(row=>
    (Array.isArray(row)?row:[]).map(button=>({
      label:String(button.text||'').slice(0,200),
      ...(typeof button.callback_data==='string'?{action:button.callback_data}:{}),
      ...(typeof button.url==='string'&&button.url.startsWith('https://')?{url:button.url}:{})
    }))
  );
}
function listOwned(telegram,actor,offset=0){
  const links=telegram.publicWa.links,cm=telegram.publicWa.cubamax;
  const db=telegram.store.db;
  const start=Math.max(0,Math.min(100000,Math.trunc(Number(offset)||0)));
  const limit=40;
  const total=db.prepare(
    'SELECT (SELECT count(*) FROM wa_public_links WHERE actor=?) + (SELECT count(*) FROM cm_public_links WHERE actor=?) AS n'
  ).get(actor,actor).n;
  const rows=db.prepare(`
    SELECT 'wa' AS site,l.rowid AS link_id,l.code,l.enabled,l.created,
      (SELECT count(DISTINCT p.account) FROM wa_public_link_accounts p
       JOIN accounts a ON a.id=p.account
       WHERE p.code=l.code AND a.consent=1 AND a.confirmed=1 AND a.linked=1
         AND a.status NOT IN ('archived','revoked')) AS linked_accounts
    FROM wa_public_links l WHERE l.actor=?
    UNION ALL
    SELECT 'cm' AS site,l.rowid AS link_id,l.code,l.enabled,l.created,
      (SELECT count(DISTINCT p.account) FROM cm_public_link_accounts p
       JOIN accounts a ON a.id=p.account
       WHERE p.code=l.code AND a.consent=1 AND a.confirmed=1 AND a.linked=1
         AND a.status NOT IN ('archived','revoked')) AS linked_accounts
    FROM cm_public_links l WHERE l.actor=?
    ORDER BY created DESC,link_id DESC
    LIMIT ? OFFSET ?
  `).all(actor,actor,limit,start).map(row=>({
    site:row.site,code:row.code,id:row.link_id,enabled:!!row.enabled,created:row.created,
    linked_accounts:Number(row.linked_accounts)||0,
    url:row.site==='wa'?links.url(row.code):cm.url(row.code),
    action:row.site==='wa'?'pwa:show:~'+row.link_id:'pwa:cm-show:~'+row.link_id
  }));
  return {rows,total,more:start+rows.length<total};
}
function screen(telegram,actor,bridge,out,offset=0){
  const pending=bridge.bot.pending.get(bridge.bot.currentKey);
  const current=listOwned(telegram,actor,offset);
  return {
    ok:true,
    pending:pending?.kind||null,
    messages:out,
    links:current.rows,
    linksTotal:current.total,
    moreLinks:current.more,
    labels:{
      choose:bridge.copy('choose'),
      whatsapp:bridge.button('buttonWhatsApp'),
      cubamax:bridge.button('buttonCubamax'),
      myLinks:bridge.button('buttonMyLinks'),
      myLinksHeading:bridge.copy('myLinksTitle'),
      empty:bridge.copy('myLinksEmpty'),
      create:bridge.button('buttonCreate'),
      back:bridge.button('buttonBack'),
      cancel:bridge.button('buttonCancel'),
      active:bridge.copy('activeStatus'),
      revoked:bridge.copy('revokedStatus'),
      accounts:bridge.button('buttonAssociatedAccounts')
    }
  };
}
function session(key){
  const now=Date.now();
  if(sessions.size>900)for(const [id,state] of sessions)
    if(now-state.updated>idle)sessions.delete(id);
  let value=sessions.get(key);
  if(!value||now-value.updated>idle){
    value={pending:new Map(),queue:Promise.resolve(),updated:now};
    sessions.set(key,value);
  }
  value.updated=now;
  return value;
}
async function execute(telegram,user,request){
  const state=session(user.actor+':'+user.key);
  let release;
  const current=new Promise(resolve=>{release=resolve;});
  const previous=state.queue;
  state.queue=current;
  await previous;
  const key='miniapp:'+user.key+':'+user.actor;
  const out=[];
  let upload=null;
  try{
    if(!telegram.admins().has(user.actor)&&telegram.associatedUsers.isBanned(user.actor))
      throw Error('Tu acceso al servicio está suspendido.');
    const bot={
      store:telegram.store,accounts:telegram.accounts,
      autoPublicAccess:telegram.autoPublicAccess,
      webPanel:{
        role:actor=>telegram.webPanel?.role(actor),
        telegramAction:async(chat,actor,action)=>{
          if(action!=='panel'||!telegram.autoPublicAccess?.eligible(actor)||!telegram.webPanel?.role(actor))
            throw Error('Panel no disponible.');
          const code=telegram.webPanel.access.permanent(actor);
          out.push({text:'PANEL WEB',buttons:[{label:'ABRIR MI PANEL',url:'https://securitywhat.app/panel#'+code}]});
        }
      },
      currentKey:key,
      pending:state.pending,
      send:async(chat,text,markup)=>{
        out.push({text:String(text||'').slice(0,15000),buttons:sanitizeMarkup(markup)});
      },
      sendFile:async(chat,file,markup)=>{
        if(!file?.data||file.data.length>5*1024*1024)throw Error('Vista previa demasiado grande.');
        out.push({
          text:String(file.caption||''),
          image:'data:'+file.mime+';base64,'+file.data.toString('base64'),
          buttons:sanitizeMarkup(markup)
        });
      },
      api:async method=>{
        if(method==='sendChatAction')return true;
        throw Error('Acción de Telegram no disponible en esta interfaz.');
      },
      download:async fileId=>{
        if(fileId!=='miniapp-photo'||!upload)throw Error('Imagen no disponible.');
        return upload;
      }
    };
    const bridge=new PublicWaLinkBot(bot);
    bridge._links=telegram.publicWa.links;
    bridge._cubamax=telegram.publicWa.cubamax;
    if(telegram.publicWa._sender)bridge._sender=telegram.publicWa._sender;
    const action=request.action;
    if(action==='start'){
      await bridge.start(user.actor,key);
    }else if(action==='callback'){
      if(typeof request.value!=='string'||!request.value.startsWith('pwa:')||request.value.length>256)
        throw Error('Opción no válida.');
      await bridge.callback(user.actor,key,user.actor,request.value);
    }else if(action==='input'){
      if(typeof request.value!=='string'||request.value.length>512)
        throw Error('Texto no válido.');
      const pending=state.pending.get(key);
      if(!['publicCmCode','publicWaCode','publicWaCountry','publicWaPhone'].includes(pending?.kind))
        throw Error('Selecciona una opción para continuar.');
      await bridge.input(user.actor,key,user.actor,{text:request.value});
    }else if(action==='page'){
      const page=Number(request.value);
      if(!Number.isInteger(page)||page<0||page>100000)throw Error('Página no válida.');
      return screen(telegram,user.actor,bridge,out,page);
    }else if(action==='photo'){
      const pending=state.pending.get(key);
      if(pending?.kind!=='publicWaPhoto')throw Error('No se ha solicitado una fotografía.');
      if(typeof request.value!=='string'||request.value.length>3*1024*1024)
        throw Error('Imagen demasiado grande.');
      const match=/^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.value);
      if(!match)throw Error('Formato de fotografía no permitido.');
      upload=Buffer.from(match[1],'base64');
      if(upload.length===0||upload.length>maxUpload)throw Error('Imagen máxima: 2 MB.');
      await bridge.input(user.actor,key,user.actor,{
        document:{file_id:'miniapp-photo',file_size:upload.length}
      });
    }else throw Error('Acción no disponible.');
    return screen(telegram,user.actor,bridge,out);
  }finally{
    state.updated=Date.now();
    release();
  }
}
export function createMiniAppBridge(telegram){
  return async(req,res)=>{
    const origin=req.headers.origin||'';
    const cors=origin===miniappOrigin?{
      'Access-Control-Allow-Origin':miniappOrigin,
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Max-Age':'600',
      'Vary':'Origin'
    }:{'Vary':'Origin'};
    if(origin!==miniappOrigin)return reply(res,403,{ok:false,error:'Origen no autorizado.'},cors);
    if(req.method==='OPTIONS')return reply(res,204,{},cors);
    if(req.method!=='POST')return reply(res,405,{ok:false,error:'Método no permitido.'},cors);
    try{
      const input=await requestBody(req,3*1024*1024);
      const who=identity(input.initData,telegram.config.token);
      if(!rate(who.actor,input.action==='photo'))throw Error('Demasiadas solicitudes. Inténtalo nuevamente.');
      return reply(res,200,await execute(telegram,who,input),cors);
    }catch(error){
      const message=String(error?.message||'No se pudo completar esta acción.').slice(0,300);
      // No divulgar el token, credenciales ni información del servidor.
      console.warn('WHATSAPP: miniapp_request_rejected',JSON.stringify({type:error?.name||'Error'}));
      return reply(res,400,{ok:false,error:message},cors);
    }
  };
}
