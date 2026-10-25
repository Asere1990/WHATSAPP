import {isSystemAccount} from './system-config.js';
import WA from 'whatsapp-web.js';
import { BaileysClient } from './baileys.js';
import { BaileysStore } from './baileys-store.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, statfsSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { normalizeInbound } from './store.js';
import { AccountTools } from './manage.js';
import { personLink, escapeHTML, clippedHTML } from './identity.js';
import { releaseStaleLock, connectionErrorCode } from './session.js';
const { Client, LocalAuth, MessageMedia }=WA;
export class Accounts {
  constructor(store,dir,notify,_legacyMax=Infinity,createClient=null) { this.store=store;this.dir=dir;this.notify=notify;this.max=Infinity;this.live=new Map();this.stopping=false;this.tools=new AccountTools(this);this.customClient=!!createClient;this.createClient=createClient||(options=>new Client(options));this.pairingTimeoutMs=120000; }
  lifecycle(id,event,code){console.log('WHATSAPP: session',JSON.stringify({account:id,event,...(code?{code}:{})}));}
  async connectionFailed(id,entry,error){
    if(this.live.get(id)!==entry||this.stopping)return;
    const code=connectionErrorCode(error);clearTimeout(entry.timeout);clearTimeout(entry.codeTimeout);clearTimeout(entry.probeTimeout);entry.ready=false;entry.code=null;
    this.store.update(id,'status','error');this.lifecycle(id,'initialize_failed',code);
    try{this.store.recordIncident(id,'conexion',{code});}catch{}
    await this.close(id);
    await this.notify(`⚠️ No se pudo iniciar la conexión de la cuenta ${id} (${code}). La autorización y la sesión guardada se conservan. Revisa /pendientes o pulsa RECUPERAR CONEXIÓN.`).catch(()=>{});
  }
  pairingRetryAfter(id){
    const row=this.store.db.prepare("SELECT MAX(created) AS created FROM incidents WHERE account=? AND code='WA_PAIRING_RATE_LIMIT'").get(id);
    const until=Number(row?.created||0)+1800000;
    return until>Date.now()?until:0;
  }
  async start(id,pair=false) {
    const a=this.store.account(id);
    if (!a?.consent) throw new Error('Falta autorización del titular.');
    if(this.live.has(id)) return this.live.get(id);
    if(this.engine(id)==='baileys')return this.startBaileys(id,pair);
    if(pair&&this.pairingRetryAfter(id)){const error=new Error('WhatsApp limitó las solicitudes de códigos. El sistema ha pausado los intentos de este número durante 30 minutos.');error.code='WA_PAIRING_RATE_LIMIT';throw error;}
    const folder=path.join(this.dir,'sessions',`session-${id}`);
    // A retry before any successful link must not reuse an unfinished browser state.
    // Preserve it separately; confirmed account profiles are never moved.
    if(pair&&!a.linked&&existsSync(folder)&&!this.store.db.prepare("SELECT 1 FROM audit WHERE account=? AND event='connected' LIMIT 1").get(id)){
      renameSync(folder,`${folder}.unfinished-${Date.now()}-${randomBytes(3).toString('hex')}`);
      this.lifecycle(id,'unfinished_profile_isolated');
    }

    if(releaseStaleLock(folder))this.lifecycle(id,'stale_browser_lock_removed');
    this.lifecycle(id,pair?'pairing_started':'restore_started');
    const client=this.createClient({
      authStrategy:new LocalAuth({clientId:id,dataPath:path.join(this.dir,'sessions')}),
      webVersionCache:{type:'local',path:path.join(this.dir,'web-cache')},
      ...(pair?{pairWithPhoneNumber:{phoneNumber:a.phone,showNotification:true,intervalMs:180000}}:{}),
      deviceName:'Gestor de mensajes autorizado',
      puppeteer:{headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']}
    });
    const entry={client,code:null,expires:0,ready:false,chain:Promise.resolve(),pending:0};
    this.live.set(id,entry);this.store.update(id,'status','connecting');
    // The pinned client launches this async method without awaiting its promise.
    // Handle rejection here so a refused pairing request cannot crash every account.
    if(typeof client.requestPairingCode==='function'){
      const requestCode=client.requestPairingCode.bind(client);
      client.requestPairingCode=async(...args)=>{
        try{
          this.lifecycle(id,'code_request_started');
          if(client.pupPage)await client.pupPage.evaluate(()=>{
            const utils=window.AuthStore?.PairingCodeLinkUtils;if(!utils||window.__managerPairingInstrumented)return;
            window.__managerPairingInstrumented=true;
            for(const method of ['initializeAltDeviceLinking','startAltLinkingFlow']){
              const original=utils[method];if(typeof original!=='function')continue;
              utils[method]=async function(...values){
                try{return await original.apply(this,values);}
                catch(error){
                  const candidates=[error,error?.type,error?.type?.value,error?.data,error?.cause,error?.response].filter(x=>x&&typeof x==='object');
                  const numbers=[];for(const item of candidates)for(const key of ['code','status','statusCode','errorCode'])if(Number.isInteger(item[key]))numbers.push(item[key]);
                  const message=String(error?.message||'');
                  window.__managerPairingFailure={stage:method,type:String(error?.name||'unknown').replace(/[^A-Za-z]/g,'').slice(0,30),detailType:String(error?.type?.name||'').replace(/[^A-Za-z_]/g,'').slice(0,60),fields:Object.keys(error||{}).slice(0,20),numbers,rateLimited:/too many|rate.?limit|over.?limit|429/i.test(message)||numbers.includes(429)};
                  throw error;
                }
              };
            }
          }).catch(()=>{});
          return await requestCode(...args);
        }
        catch(cause){
          let diagnostic;
          if(client.pupPage)try{diagnostic=await client.pupPage.evaluate(()=>window.__managerPairingFailure||null);}catch{}
          this.lifecycle(id,'pairing_failure_detail',JSON.stringify(diagnostic||{stage:'browser_call'}));
          const error=new Error('WhatsApp no pudo generar el código de vinculación.',{cause});error.code=diagnostic?.rateLimited?'WA_PAIRING_RATE_LIMIT':'WA_PAIRING_CODE';
          await this.connectionFailed(id,entry,error).catch(()=>{});
          return null;
        }
      };
    }

    client.on('code', code=>{if(this.live.get(id)!==entry)return;clearTimeout(entry.codeTimeout);entry.code=code;entry.expires=Date.now()+180000;this.lifecycle(id,'pairing_code_received');});
    client.on('qr',()=>{
      if(this.live.get(id)!==entry)return;
      if(!pair){this.store.update(id,'status','needs_pairing');this.lifecycle(id,'authorization_needed');this.close(id).catch(()=>{});this.notify(`⚠️ WhatsApp solicita volver a vincular la cuenta ${id}. La sesión guardada no fue eliminada por el gestor.`).catch(()=>{});}
    });
    client.on('authenticated',()=>{if(this.live.get(id)!==entry||!this.store.account(id)?.consent)return;this.store.update(id,'linked',1);clearTimeout(entry.codeTimeout);this.lifecycle(id,'authenticated');});
    client.on('loading_screen',percent=>this.lifecycle(id,'syncing',String(Number(percent)||0)));
    client.on('ready',()=>this.connected(id,entry).catch(error=>this.connectionFailed(id,entry,error)));
    client.on('auth_failure',()=>{if(this.live.get(id)!==entry)return;entry.ready=false;entry.code=null;clearTimeout(entry.timeout);this.store.update(id,'status','auth_failure');this.lifecycle(id,'auth_failure');this.close(id).catch(()=>{});});
    client.on('disconnected',reason=>{
      if(this.live.get(id)!==entry)return;
      entry.ready=false;entry.code=null;clearTimeout(entry.timeout);clearTimeout(entry.codeTimeout);clearTimeout(entry.probeTimeout);
      const loggedOut=reason==='LOGOUT';
      if(loggedOut&&this.store.account(id)?.consent)this.store.revoke(id);
      this.lifecycle(id,loggedOut?'logged_out':'disconnected');
      if(this.live.get(id)===entry) this.live.delete(id);
      if(this.store.account(id)?.consent) this.store.update(id,'status','disconnected');
      client.destroy().catch(()=>{}).finally(()=>{if(loggedOut)rmSync(path.join(this.dir,'sessions',`session-${id}`),{recursive:true,force:true});});
    });
    client.on('message', msg=>{
      if(msg.fromMe || msg.isStatus || !/@(c\.us|lid)$/.test(msg.from) || this.store.account(id)?.paused) return;
      if(entry.pending>=200) {this.store.update(id,'paused',1);this.notify(`⚠️ Cuenta ${id} pausada por cola llena. Revisar volumen.`).catch(()=>{});return;}
      entry.pending++;
      entry.chain=entry.chain.then(()=>this.receive(id,msg)).catch(()=>{}).finally(()=>entry.pending--);
    });
    entry.timeout=setTimeout(()=>{
      if(this.live.get(id)===entry&&!entry.ready){this.lifecycle(id,'initialize_timeout');this.store.update(id,'status','expired');this.close(id).catch(()=>{});this.notify(`⚠️ La cuenta ${id} no terminó de iniciar. Pulsa RECUPERAR CONEXIÓN en su ficha.`).catch(()=>{});}
    },600000);entry.timeout.unref();
    
    if(pair){
      entry.codeTimeout=setTimeout(()=>{
        if(this.live.get(id)!==entry||entry.ready||entry.code)return;
        const error=new Error('WhatsApp no entregó un código dentro del plazo.');error.code='WA_PAIRING_TIMEOUT';
        this.connectionFailed(id,entry,error).catch(()=>{});
      },this.pairingTimeoutMs);entry.codeTimeout.unref();
      entry.probeTimeout=setTimeout(async()=>{
        if(this.live.get(id)!==entry||entry.ready||entry.code)return;
        try{
          const probe=client.pupPage?await client.pupPage.evaluate(()=>({state:String(window.AuthStore?.AppState?.state||window.require?.('WAWebSocketModel')?.Socket?.state||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,30),tools:!!window.AuthStore?.PairingCodeLinkUtils,loaded:!!window.Debug?.VERSION})): {state:'BROWSER_STARTING'};
          this.lifecycle(id,'pairing_wait',JSON.stringify(probe));
        }catch{this.lifecycle(id,'pairing_wait','PAGE_NOT_READY');}
      },15000);entry.probeTimeout.unref();
    }
    entry.initializing=Promise.resolve().then(()=>client.initialize()).catch(error=>this.connectionFailed(id,entry,error));
    return entry;
  }
  engine(id){
    const saved=this.store.db.prepare('SELECT value FROM config WHERE key=?').get(`engine:${id}`)?.value;
    const engine=saved||(this.customClient?'webjs':process.env.WA_ENGINE||'baileys');
    if(!['baileys','webjs'].includes(engine))throw Error('Motor de WhatsApp inválido.');
    return engine;
  }
  async prepareBaileys(id){
    const a=this.store.account(id);if(!a?.consent)throw Error('Cuenta no autorizada.');
    if(this.live.get(id)?.client?.kind==='baileys'&&this.live.get(id).ready)return;
    await this.close(id);this.store.setConfig(`engine:${id}`,'baileys');
    if(!new BaileysStore(this.store,id).registered())this.store.update(id,'status','needs_pairing');
  }
  async startBaileys(id,pair,clientFactory=options=>new BaileysClient(options)){
    const a=this.store.account(id);
    if(this.pairingRetryAfter(id)&&pair){const error=new Error('WhatsApp limitó las solicitudes de códigos.');error.code='WA_PAIRING_RATE_LIMIT';throw error;}
    const client=clientFactory({store:this.store,id,phone:a.phone,pair});
    const entry={client,code:null,expires:0,ready:false,chain:Promise.resolve(),pending:0};
    this.live.set(id,entry);this.store.update(id,'status','connecting');this.lifecycle(id,pair?'baileys_pairing_started':'baileys_restore_started');
    client.on('code',code=>{if(this.live.get(id)!==entry)return;clearTimeout(entry.codeTimeout);entry.code=code;entry.expires=Date.now()+180000;this.lifecycle(id,'pairing_code_received');});
    client.on('qr',()=>{if(this.live.get(id)!==entry)return;this.store.update(id,'status','needs_pairing');this.close(id).catch(()=>{});});
    client.on('authenticated',()=>{if(this.live.get(id)===entry&&this.store.account(id)?.consent)this.store.update(id,'linked',1);});
    client.on('loading_screen',percent=>this.lifecycle(id,'syncing',String(percent)));
    client.on('ready',()=>this.connected(id,entry).catch(error=>this.connectionFailed(id,entry,error)));
    client.on('reconnecting',()=>{if(this.live.get(id)!==entry)return;entry.ready=false;entry.code=null;this.store.update(id,'status','connecting');});
    client.on('transport_error',error=>this.connectionFailed(id,entry,error).catch(()=>{}));
    client.on('disconnected',reason=>{
      if(this.live.get(id)!==entry)return;
      entry.ready=false;entry.code=null;
      if(reason==='LOGOUT')this.store.revoke(id);else this.store.update(id,'status','disconnected');
      this.lifecycle(id,reason==='LOGOUT'?'logged_out':'disconnected');this.close(id).catch(()=>{});
    });
    client.on('message',msg=>{
      if(this.live.get(id)!==entry||this.stopping||!entry.ready||msg.fromMe||msg.isStatus||this.store.account(id)?.paused)return;
      if(entry.pending>=200){this.store.update(id,'paused',1);return;}
      entry.pending++;entry.chain=entry.chain.then(()=>this.receive(id,msg)).catch(()=>{}).finally(()=>entry.pending--);
    });
    entry.timeout=setTimeout(()=>{if(this.live.get(id)===entry&&!entry.ready){this.store.update(id,'status','expired');this.close(id).catch(()=>{});}},600000);entry.timeout.unref();
    if(pair){entry.codeTimeout=setTimeout(()=>{if(this.live.get(id)!==entry||entry.ready||entry.code)return;const error=new Error('WhatsApp no entregó el código.');error.code='WA_PAIRING_TIMEOUT';this.connectionFailed(id,entry,error).catch(()=>{});},this.pairingTimeoutMs);entry.codeTimeout.unref();}
    entry.initializing=Promise.resolve().then(()=>client.initialize()).catch(error=>this.connectionFailed(id,entry,error));
    return entry;
  }
  async connected(id,entry) {
    const a=this.store.account(id);
    if(this.live.get(id)!==entry || entry.ready || !a?.consent || this.stopping)return;
    if(entry.client.info?.wid?.user!==a.phone) {await this.disconnect(id).catch(()=>{});return;}
    entry.ready=true;entry.code=null;clearTimeout(entry.timeout);clearTimeout(entry.codeTimeout);clearTimeout(entry.probeTimeout);this.store.update(id,'status','connected');this.lifecycle(id,'ready');
    this.store.audit(id,'connected');
    const profile=await this.tools.identity(id,`${a.phone}@c.us`,true);
    const corporate=this.store.db.prepare('SELECT value FROM config WHERE key=?').get(`portal:${id}`)?.value==='cubamax-corporate';
    await this.notify(`✅ Cuenta conectada: ${personLink(profile)}\nPaís del número: ${escapeHTML(profile.country)}\nCuenta: ${id}${corporate?'\nOrigen: Cubamax · Teléfono corporativo':''}`,null,{parse_mode:'HTML',account:id}).catch(()=>{});
    if(entry.client.pupPage)await this.tools.profilePhoto(id);
    // Read-only production probe: log counts, never names, phones or messages.
    if(entry.client.getChats)try{
      const chats=await this.tools.list(id);this.lifecycle(id,'chat_list_verified',`${chats.length}:${this.tools.listProblems.get(id)||0}`);
    }catch(error){this.lifecycle(id,'chat_list_failed',error.code||'WA_CHAT_READ');this.store.recordIncident(id,'consulta_chats',error);}
    if(entry.client.pupPage)try{
      const gallery=await this.tools.gallery(id,`${a.phone}@c.us`),counts=gallery.counts||this.tools.counts(gallery.messages);
      this.lifecycle(id,'gallery_verified',JSON.stringify({...counts,complete:gallery.complete,pages:gallery.pages}));
      const photo=gallery.messages.slice().reverse().find(m=>m.type==='image'&&m.hasMedia&&!m.isEphemeral&&!m.rawData?.isViewOnce&&Number(m.rawData?.size)>0&&Number(m.rawData?.size)<2*1024*1024);
      if(photo){const media=await photo.downloadMedia();this.lifecycle(id,'media_read_verified',media?`${media.mimetype}:${Buffer.byteLength(media.data,'base64')}`:'unavailable');}
    }catch(error){this.lifecycle(id,'gallery_probe_failed',error.code||'WA_MEDIA_READ');}

  }
  async receive(id,msg) {
    const a=this.store.account(id);
    if(!a?.consent||a.paused||this.stopping) return;
    let item=null,stage='validacion';
    try {
      const normalized=normalizeInbound(msg);if(!normalized)return;
      const body=normalized.body;
      stage='registro';
      item=this.store.enqueue(id,normalized);
      if(!item || item.state!=='pending')return;
      // Never automatically resend after an uncertain external delivery.
      this.store.db.prepare("UPDATE inbox SET state='processing' WHERE id=?").run(item.id);
      stage='envio_panel';
      const sender=await this.tools.identity(id,msg.from),receiver=await this.tools.identity(id,`${a.phone}@c.us`);
      const header=`📩 Escribe: ${personLink(sender)}\nRecibe: ${personLink(receiver)}\nPaís del número receptor: ${escapeHTML(receiver.country)}\nCuenta: ${id} · Registro: ${item.id}\n\n${clippedHTML(body||'['+(msg.type||'archivo')+']')}\n\nHaz reply para responder con texto, fotos, videos o audio.`;
      const sent=await this.notify(header,null,{parse_mode:'HTML',account:id,peer:msg.from});
      this.store.route(sent.chat.id,sent.message_id,id,msg.from);
      if(msg.hasMedia && !msg.isEphemeral && !msg.rawData?.isViewOnce) {
        stage='archivo';
        const advertised=Number(msg.rawData?.size||msg.rawData?.fileSize||0);
        const cap=Number(process.env.MAX_MEDIA_MB||20)*1024*1024;
        const disk=statfsSync(this.dir);
        if(disk.bavail*disk.bsize<100*1024*1024)throw new Error('Disco sin espacio disponible');
        if(advertised>0&&advertised<=cap) {
          const media=await msg.downloadMedia();
          if(media) {
            const data=Buffer.from(media.data,'base64');
            if(data.length<=cap) {
              const folder=path.join(this.dir,'files',id);mkdirSync(folder,{recursive:true,mode:0o700});
              const filename=path.join(folder,randomBytes(12).toString('hex'));
              writeFileSync(filename,data,{mode:0o600});
              this.store.db.prepare('UPDATE inbox SET media=? WHERE id=?').run(filename,item.id);
              if(this.store.claimExport(id,normalized.id._serialized))try {
                const conversation=['audio','ptt'].includes(msg.type);
                const caption=conversation?`Escribe: ${personLink({...sender,name:sender.name.slice(0,32)})}\nRecibe: ${personLink({...receiver,name:receiver.name.slice(0,32)})}\n\n${clippedHTML(body,220)}\nRegistro: ${item.id}`:`${body.slice(0,500)}\n\nEscribe: ${sender.name}${sender.phone?' (+'+sender.phone+')':''}\nRecibe: ${receiver.name} (+${a.phone})\nID: ${id}\nRegistro: ${item.id}`;
                const copied=await this.notify(null,{data,name:path.basename(media.filename||'archivo'),mime:media.mimetype,caption,conversation,systemReply:isSystemAccount(this.store,a),voice:msg.type==='ptt',...(conversation?{parse_mode:'HTML'}:{})},{account:id,peer:msg.from});
                this.store.finishExport(id,normalized.id._serialized,'done');
                this.store.route(copied.chat.id,copied.message_id,id,msg.from);
              } catch {this.store.finishExport(id,normalized.id._serialized,'review');await this.notify(`Archivo guardado. Registro ${item.id}. No se pudo enviar a Telegram; revisar antes de reintentar.`);}
            } else await this.notify(`Registro ${item.id}: archivo supera el límite de descarga configurado.`);
          } else await this.notify(`Registro ${item.id}: WhatsApp no entregó el archivo.`);
        } else await this.notify(`Registro ${item.id}: archivo no descargado; tamaño desconocido o superior al límite configurado.`);
      }
      const rule=this.store.rules(id).find(r=>body.toLowerCase().trim()===r.keyword);
      if(rule && !this.store.account(id).paused) {
        stage='respuesta';
        await this.send(id,msg.from,rule.reply);
        await this.notify(`✅ Regla aplicada · ${id} · Registro ${item.id}`);
      }
      this.store.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(item.id);
    } catch(error) {
      if(item)try{this.store.db.prepare("UPDATE inbox SET state='review' WHERE id=?").run(item.id);}catch{}
      await this.reportFailure(id,error,msg,stage);
      throw error;
    }
  }
  async reportFailure(id,error,msg,stage) {
    let incident=null;
    const reference=typeof msg?.id==='string'?msg.id:msg?.id?._serialized;
    try{incident=this.store.recordIncident(id,stage,error,reference);}catch{}
    // Log only classifications and stack frames, never message content or credentials.
    console.error('WHATSAPP: inbound_failed',JSON.stringify({account:id,stage,code:incident?.code||String(error?.name||'Error'),frames:String(error?.stack||'').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,4)}));
    const text=incident
      ?`⚠️ Incidencia #${incident.id} · Cuenta ${id} · ${stage} (${incident.code}). Guardada para revisión en /pendientes.`
      :`⚠️ Error en la cuenta ${id}. No se pudo guardar la incidencia; revisar los registros del servicio.`;
    await this.notify(text).catch(()=>{});
  }
  async send(id,peer,text,media) {
    const a=this.store.account(id), entry=this.live.get(id);
    if(!a?.consent||a.paused||!entry?.ready) throw new Error('Cuenta desconectada o pausada.');
    if(!/^[0-9]+@(c\.us|lid)$/.test(peer)) throw new Error('Contacto inválido');
    const sent=await entry.client.sendMessage(peer,media?new MessageMedia(media.mime,media.data.toString('base64'),media.name):text,media?{caption:text||'',...(media.voice?{sendAudioAsVoice:true}:{})}:{});
    this.store.audit(id,'sent');return sent;
  }
  async close(id) {const e=this.live.get(id);if(e){clearTimeout(e.timeout);clearTimeout(e.codeTimeout);clearTimeout(e.probeTimeout);this.live.delete(id);await e.client.destroy().catch(()=>{});}}
  async disconnect(id) {
    const e=this.live.get(id);this.store.revoke(id);
    if(e) {clearTimeout(e.timeout);await e.client.logout().catch(()=>{});await this.close(id);}
    if(this.engine(id)==='baileys')new BaileysStore(this.store,id).clearCredentials();
    rmSync(path.join(this.dir,'sessions',`session-${id}`),{recursive:true,force:true});
  }
  async restore() {
    for(const a of this.store.all()) {
      if(!a.consent)continue;
      if(this.engine(a.id)==='baileys'){
        if(new BaileysStore(this.store,a.id).registered())await this.start(a.id).catch(error=>this.lifecycle(a.id,'restore_failed',connectionErrorCode(error)));
        else {this.store.update(a.id,'status','needs_pairing');this.lifecycle(a.id,'baileys_link_required');}
        continue;
      }
      if(existsSync(path.join(this.dir,'sessions',`session-${a.id}`))) {
        const resumePairing=!a.linked&&a.status==='connecting'&&!this.pairingRetryAfter(a.id)&&!this.store.db.prepare("SELECT 1 FROM audit WHERE account=? AND event='connected' LIMIT 1").get(a.id);
        await this.start(a.id,resumePairing).catch(error=>{this.store.update(a.id,'status','error');this.lifecycle(a.id,'restore_failed',connectionErrorCode(error));});
      }else{
        this.store.update(a.id,'status','needs_pairing');this.lifecycle(a.id,'session_directory_missing');
      }
    }
  }
  cleanupFiles() {
    for(const r of this.store.db.prepare('SELECT id,media,created FROM inbox WHERE media IS NOT NULL').all()) {
      if(r.created<Date.now()-7*86400000) {rmSync(r.media,{force:true});this.store.db.prepare('UPDATE inbox SET media=NULL WHERE id=?').run(r.id);}
    }
  }
  async shutdown(){this.stopping=true;await Promise.race([Promise.allSettled([...this.live.values()].map(e=>e.chain)),new Promise(r=>setTimeout(r,15000))]);await Promise.allSettled([...this.live.keys()].map(id=>this.close(id)));}
}

