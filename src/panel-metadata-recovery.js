import {BaileysStore} from './baileys-store.js';

// Recover display names already supplied by WhatsApp, independently of the
// browser. The existing SQLite database and authorization boundary are reused.
// No network requests, credential changes, media downloads or message rewrites.
const privatePeer=/^\d+@(s\.whatsapp\.net|lid)$/;
const unknownName=/^(nombre no disponible|sin nombre|cuenta(?: de whatsapp)?|whatsapp|contacto(?: sin identificar)?|\+?[0-9\s().-]+)$/i;

export function messageContactName(raw){
 const key=raw?.key;
 if(!key?.remoteJid||key.fromMe||key.participant||raw.message?.deviceSentMessage)return null;
 const peer=String(key.remoteJid).replace(/@c\.us$/,'@s.whatsapp.net');
 if(!privatePeer.test(peer))return null;
 const name=typeof raw.pushName==='string'?raw.pushName.trim().slice(0,120):'';
 if(!name||unknownName.test(name))return null;
 const timestamp=Number(raw.messageTimestamp)||0;
 return {peer,name,timestamp:Number.isSafeInteger(timestamp)&&timestamp>=0?timestamp:0};
}

export class PanelMetadataRecovery{
 constructor(store,{now=()=>Date.now(),batchSize=120,scanDelay=2500}={}){
  // The worker is created before WhatsApp sessions initialize; ensure the
  // existing Baileys tables exist before preparing any SELECT statements.
  new BaileysStore(store,'metadata-schema');
  this.store=store;this.db=store.db;this.now=now;
  this.batchSize=batchSize;this.scanDelay=scanDelay;this.started=false;this.closed=false;
  this.timer=null;this.timerAt=0;this.working=false;this.rotation=0;
  this.cursor=this.db.prepare('SELECT value FROM config WHERE key=?');
  this.rows=this.db.prepare("SELECT rowid,value FROM baileys_data WHERE account=? AND kind='message' AND rowid>? ORDER BY rowid ASC LIMIT ?");
  // A panel-name is only a fallback; original WhatsApp contact and chat
  // records always retain priority. Newer messages take precedence.
  this.upsert=this.db.prepare(`INSERT INTO baileys_data(account,kind,id,peer,timestamp,value)
    VALUES(?,'panel-name',?,?,?,?)
    ON CONFLICT(account,kind,id) DO UPDATE SET
    timestamp=excluded.timestamp,value=excluded.value
    WHERE excluded.timestamp>baileys_data.timestamp OR (excluded.timestamp=baileys_data.timestamp AND excluded.value!=baileys_data.value)`);
 }
 allowedAccounts(){
  const configs=this.store.config();
  return this.store.all().filter(a=>a.consent&&a.confirmed&&
   configs['portal:'+a.id]!=='cubamax-corporate'&&
   configs['engine:'+a.id]!=='webjs').map(a=>a.id);
 }
 start(){if(this.started||this.closed)return;this.started=true;this.wake(3000);}
 wake(delay=1500){
  if(!this.started||this.closed||this.working)return;
  const next=this.now()+delay;
  if(this.timer&&this.timerAt<=next)return;
  if(this.timer)clearTimeout(this.timer);
  this.timerAt=next;
  this.timer=setTimeout(()=>{
   this.timer=null;this.timerAt=0;
   try{this.step();}catch{
    // A failed background index must never interrupt WhatsApp sessions.
    this.wake(30000);
   }
  },delay);
  this.timer.unref?.();
 }
 step(){
  if(!this.started||this.closed||this.working)return;
  this.working=true;let nextDelay=15000;
  try{
   const accounts=this.allowedAccounts();
   if(accounts.length){
    const id=accounts[this.rotation++%accounts.length],key='panel:name-scan:v1:'+id;
    const old=Number(this.cursor.get(key)?.value||0),cursor=Number.isSafeInteger(old)&&old>=0?old:0;
    const rows=this.rows.all(id,cursor,this.batchSize);
    let saved=0,last=cursor;
    for(const row of rows){
     last=Number(row.rowid);
     try{
      const contact=messageContactName(JSON.parse(row.value));
      if(!contact)continue;
      this.upsert.run(id,contact.peer,contact.peer,contact.timestamp,JSON.stringify({name:contact.name}));
      saved++;
     }catch{ /* Skip a single malformed historical record. */ }
    }
    if(last!==cursor)this.store.setConfig(key,String(last));
    nextDelay=rows.length?this.scanDelay:10000;
   }
  }finally{this.working=false;this.wake(nextDelay);}
 }
 shutdown(){
  this.closed=true;this.started=false;
  if(this.timer)clearTimeout(this.timer);
  this.timer=null;this.timerAt=0;
 }
}
