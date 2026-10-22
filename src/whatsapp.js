import WA from 'whatsapp-web.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, statfsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { normalizeInbound } from './store.js';
import { AccountTools } from './manage.js';
import { personLink, escapeHTML, clippedHTML } from './identity.js';
const { Client, LocalAuth, MessageMedia }=WA;
export class Accounts {
  constructor(store,dir,notify,max=2) { this.store=store;this.dir=dir;this.notify=notify;this.max=max;this.live=new Map();this.stopping=false;this.tools=new AccountTools(this); }
  async start(id,pair=false) {
    const a=this.store.account(id);
    if (!a?.consent) throw new Error('Falta autorización del titular.');
    if(this.live.has(id)) return this.live.get(id);
    if(this.live.size>=this.max) throw new Error('Se alcanzó el límite de cuentas del servidor.');
    const client=new Client({
      authStrategy:new LocalAuth({clientId:id,dataPath:path.join(this.dir,'sessions')}),
      webVersionCache:{type:'local',path:path.join(this.dir,'web-cache')},
      ...(pair?{pairWithPhoneNumber:{phoneNumber:a.phone,showNotification:true,intervalMs:180000}}:{}),
      deviceName:'Gestor de mensajes autorizado',
      puppeteer:{headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']}
    });
    const entry={client,code:null,expires:0,ready:false,chain:Promise.resolve(),pending:0};
    this.live.set(id,entry);this.store.update(id,'status','connecting');
    client.on('code', code=>{entry.code=code;entry.expires=Date.now()+180000;});
    client.on('qr',()=>{
      if(!pair){this.store.update(id,'status','auth_failure');this.close(id).catch(()=>{});}
    });
    client.on('ready',()=>this.connected(id,entry).catch(()=>{}));
    client.on('auth_failure',()=>{entry.ready=false;entry.code=null;this.store.update(id,'status','auth_failure');});
    client.on('disconnected',()=>{
      entry.ready=false;entry.code=null;
      if(this.live.get(id)===entry) this.live.delete(id);
      if(this.store.account(id)?.consent) this.store.update(id,'status','disconnected');
      client.destroy().catch(()=>{});
    });
    client.on('message', msg=>{
      if(msg.fromMe || msg.isStatus || !/@(c\.us|lid)$/.test(msg.from) || this.store.account(id)?.paused) return;
      if(entry.pending>=200) {this.store.update(id,'paused',1);this.notify(`⚠️ Cuenta ${id} pausada por cola llena. Revisar volumen.`).catch(()=>{});return;}
      entry.pending++;
      entry.chain=entry.chain.then(()=>this.receive(id,msg)).catch(()=>{}).finally(()=>entry.pending--);
    });
    client.initialize().catch(async()=>{
      entry.ready=false;this.store.update(id,'status','error');
      await client.destroy().catch(()=>{});
      if(this.live.get(id)===entry)this.live.delete(id);
    });
    entry.timeout=setTimeout(()=>{
      if(!entry.ready) this.close(id).then(()=>this.store.update(id,'status','expired')).catch(()=>{});
    },600000);entry.timeout.unref();
    return entry;
  }
  async connected(id,entry) {
    const a=this.store.account(id);
    if(this.live.get(id)!==entry || entry.ready || !a?.consent || this.stopping)return;
    if(entry.client.info?.wid?.user!==a.phone) {await this.disconnect(id).catch(()=>{});return;}
    entry.ready=true;entry.code=null;this.store.update(id,'status','connected');
    this.store.audit(id,'connected');
    const profile=await this.tools.identity(id,`${a.phone}@c.us`,true);
    await this.notify(`✅ Cuenta conectada: ${personLink(profile)}\nPaís del número: ${escapeHTML(profile.country)}\nCuenta: ${id}`,null,{parse_mode:'HTML'}).catch(()=>{});
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
      const sent=await this.notify(header,null,{parse_mode:'HTML'});
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
                const copied=await this.notify(null,{data,name:path.basename(media.filename||'archivo'),mime:media.mimetype,caption,conversation,voice:msg.type==='ptt',...(conversation?{parse_mode:'HTML'}:{})});
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
  async close(id) {const e=this.live.get(id);if(e){clearTimeout(e.timeout);this.live.delete(id);await e.client.destroy().catch(()=>{});}}
  async disconnect(id) {
    const e=this.live.get(id);this.store.revoke(id);
    if(e) {clearTimeout(e.timeout);await e.client.logout().catch(()=>{});await this.close(id);}
    rmSync(path.join(this.dir,'sessions',`session-${id}`),{recursive:true,force:true});
  }
  async restore() {
    for(const a of this.store.all()) {
      if(a.consent && existsSync(path.join(this.dir,'sessions',`session-${a.id}`))) {
        await this.start(a.id).catch(()=>this.store.update(a.id,'status','capacity'));
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

