import WA from 'whatsapp-web.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, statfsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const { Client, LocalAuth, MessageMedia }=WA;
export class Accounts {
  constructor(store,dir,notify,max=2) { this.store=store;this.dir=dir;this.notify=notify;this.max=max;this.live=new Map();this.stopping=false; }
  async start(id,pair=false) {
    const a=this.store.account(id);
    if (!a?.consent) throw new Error('Falta autorización del titular.');
    if(this.live.has(id)) return this.live.get(id);
    if(this.live.size>=this.max) throw new Error('Se alcanzó el límite de cuentas del servidor.');
    const client=new Client({
      authStrategy:new LocalAuth({clientId:id,dataPath:path.join(this.dir,'sessions')}),
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
    client.on('ready',async()=>{
      if(client.info?.wid?.user!==a.phone) {await this.disconnect(id).catch(()=>{});return;}
      entry.ready=true;entry.code=null;this.store.update(id,'status','connected');
      this.store.audit(id,'connected');
      await this.notify(`✅ Cuenta conectada: ${a.name} · ${id}`).catch(()=>{});
    });
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
      entry.chain=entry.chain.then(()=>this.receive(id,msg)).catch(()=>this.notify(`⚠️ Error procesando un mensaje de ${id}. Revisar /pendientes.`).catch(()=>{})).finally(()=>entry.pending--);
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
  async receive(id,msg) {
    const a=this.store.account(id);
    if(!a?.consent||a.paused||this.stopping) return;
    const item=this.store.enqueue(id,msg);
    if(item.state!=='pending') return;
    // Mark before external effects: ambiguous network outcomes are reviewed, never blindly resent.
    this.store.db.prepare("UPDATE inbox SET state='processing' WHERE id=?").run(item.id);
    try {
      const header=`📩 ${a.name} · Cuenta ${id}\nContacto: ${msg.from}\nRegistro: ${item.id}\n\n${(msg.body||'[archivo]').slice(0,3000)}\n\nResponde a este mensaje para contestar desde WhatsApp.`;
      const sent=await this.notify(header);
      this.store.route(sent.chat.id,sent.message_id,id,msg.from);
      if(msg.hasMedia && !msg.isEphemeral && !msg.rawData?.isViewOnce) {
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
              try {
                const caption=`${(msg.body||'').slice(0,600)}\n\nCuenta: ${a.name} (+${a.phone})\nID: ${id}\nContacto de origen: ${msg.from}\nRegistro: ${item.id}`;
                const copied=await this.notify(null,{data,name:path.basename(media.filename||'archivo'),mime:media.mimetype,caption});
                this.store.route(copied.chat.id,copied.message_id,id,msg.from);
              } catch {await this.notify(`Archivo guardado. Registro ${item.id}. No se pudo enviar a Telegram.`);}
            } else await this.notify(`Registro ${item.id}: archivo supera el límite de descarga configurado.`);
          } else await this.notify(`Registro ${item.id}: WhatsApp no entregó el archivo.`);
        } else await this.notify(`Registro ${item.id}: archivo no descargado; tamaño desconocido o superior al límite configurado.`);
      }
      const rule=this.store.rules(id).find(r=>(msg.body||'').toLowerCase().trim()===r.keyword);
      if(rule && !this.store.account(id).paused) {
        await this.send(id,msg.from,rule.reply);
        await this.notify(`✅ Regla aplicada · ${id} · Registro ${item.id}`);
      }
      this.store.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(item.id);
    } catch {
      this.store.db.prepare("UPDATE inbox SET state='review' WHERE id=?").run(item.id);throw new Error('Revisión requerida');
    }
  }
  async send(id,peer,text,media) {
    const a=this.store.account(id), entry=this.live.get(id);
    if(!a?.consent||a.paused||!entry?.ready) throw new Error('Cuenta desconectada o pausada.');
    if(!/^[0-9]+@(c\.us|lid)$/.test(peer)) throw new Error('Contacto inválido');
    const sent=await entry.client.sendMessage(peer,media?new MessageMedia(media.mime,media.data.toString('base64'),media.name):text,media?{caption:text||''}:{});
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
