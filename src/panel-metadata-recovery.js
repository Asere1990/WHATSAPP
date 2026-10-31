import {BaileysStore} from './baileys-store.js';
import {receivedContactMetadata,acceptedContactMapping} from './received-contact-metadata.js';
import {receivedHistoryAnchor,oldestChatHistoryAnchor} from './history-recovery-anchors.js';

// Recover display names and explicit contact associations already supplied by
// WhatsApp, independently of the browser. Never invent missing identity data.
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
 constructor(store,{now=()=>Date.now(),batchSize=120,scanDelay=2500,onAnchorRecovered=()=>{}}={}){
  new BaileysStore(store,'metadata-schema');
  this.store=store;this.db=store.db;this.now=now;this.onAnchorRecovered=onAnchorRecovered;
  this.batchSize=batchSize;this.scanDelay=scanDelay;this.started=false;this.closed=false;
  this.timer=null;this.timerAt=0;this.working=false;this.rotation=0;this.contactRotation=0;this.anchorRotation=0;
  this.cursor=this.db.prepare('SELECT value FROM config WHERE key=?');
  this.rows=this.db.prepare("SELECT rowid,value FROM baileys_data WHERE account=? AND kind='message' AND rowid>? ORDER BY rowid ASC LIMIT ?");
  this.contactRows=this.db.prepare("SELECT rowid,kind,id,value FROM baileys_data WHERE account=? AND kind IN ('chat','contact','mapping') AND rowid>? ORDER BY rowid ASC LIMIT ?");
  // A third, independent cursor ensures histories already examined by older
  // versions are revisited for authentic message keys, in bounded disk reads.
  this.anchorRows=this.db.prepare("SELECT rowid,kind,value FROM baileys_data WHERE account=? AND kind IN ('chat','message') AND rowid>? ORDER BY rowid ASC LIMIT ?");
  this.readAnchor=this.db.prepare("SELECT value FROM baileys_data WHERE account=? AND kind='cursor' AND id=?");
  this.hasSavedMessage=this.db.prepare("SELECT 1 FROM baileys_data WHERE account=? AND kind='message' AND peer=? LIMIT 1");
  this.writePriority=this.db.prepare(`INSERT OR IGNORE INTO baileys_data(account,kind,id,peer,timestamp,value)
    VALUES(?,'history-priority',?,NULL,0,?)`);
  this.writeAnchor=this.db.prepare(`INSERT INTO baileys_data(account,kind,id,peer,timestamp,value)
    VALUES(?,'cursor',?,NULL,0,?)
    ON CONFLICT(account,kind,id) DO UPDATE SET value=excluded.value`);
  this.readMapping=this.db.prepare("SELECT value FROM baileys_data WHERE account=? AND kind='mapping' AND id=?");
  this.writeMapping=this.db.prepare(`INSERT INTO baileys_data(account,kind,id,peer,timestamp,value)
    VALUES(?,'mapping',?,NULL,0,?) ON CONFLICT(account,kind,id)
    DO UPDATE SET value=excluded.value WHERE baileys_data.value!=excluded.value`);
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
   try{this.step();}catch{this.wake(30000);}
  },delay);
  this.timer.unref?.();
 }
 recoverContacts(accounts){
  if(!accounts.length)return false;
  let selected=null;
  for(let i=0;i<accounts.length;i++){
   const index=(this.contactRotation+i)%accounts.length,id=accounts[index];
   const key='panel:contact-scan:v1:'+id;
   const prior=Number(this.cursor.get(key)?.value||0),cursor=Number.isSafeInteger(prior)&&prior>=0?prior:0;
   const rows=this.contactRows.all(id,cursor,this.batchSize);
   if(rows.length){selected={id,key,rows};this.contactRotation=(index+1)%accounts.length;break;}
  }
  if(!selected)return false;
  const {id,key,rows}=selected,own=new BaileysStore(this.store,id).selfJids();
  let last=0;
  for(const row of rows){
   last=Number(row.rowid);
   let value;
   try{value=JSON.parse(row.value);}catch{continue;}
   const {mapping,name}=receivedContactMetadata(row.kind,row.id,value);
   if(mapping){
    let old;
    try{old=JSON.parse(this.readMapping.get(id,mapping.lid)?.value||'null');}catch{old=null;}
    if(acceptedContactMapping(mapping,old,own))this.writeMapping.run(id,mapping.lid,JSON.stringify(mapping.pn));
   }
   if(name)this.upsert.run(id,name.peer,name.peer,name.timestamp,JSON.stringify({name:name.name}));
  }
  // Persist only after a complete batch. A failed batch is safely retried.
  if(last)this.store.setConfig(key,String(last));
  return true;
 }
 recoverAnchors(accounts){
  if(!accounts.length)return false;
  let selected=null;
  for(let i=0;i<accounts.length;i++){
   const index=(this.anchorRotation+i)%accounts.length,id=accounts[index];
   const key='panel:history-anchor-scan:v1:'+id;
   const old=Number(this.cursor.get(key)?.value||0);
   const cursor=Number.isSafeInteger(old)&&old>=0?old:0;
   const rows=this.anchorRows.all(id,cursor,this.batchSize);
   if(rows.length){selected={id,key,rows};this.anchorRotation=(index+1)%accounts.length;break;}
  }
  if(!selected)return false;
  const {id,key,rows}=selected;
  let last=0,updated=0;
  for(const row of rows){
   last=Number(row.rowid);
   let raw;
   try{raw=JSON.parse(row.value);}catch{continue;}
   const anchor=row.kind==='chat'?oldestChatHistoryAnchor(raw):receivedHistoryAnchor(raw);
   if(!anchor)continue;
   const jid=anchor.key.remoteJid;
   let current;
   try{current=JSON.parse(this.readAnchor.get(id,jid)?.value||'null');}catch{current=null;}
   const previous=Number(current?.messageTimestamp)||0;
   if(previous>0&&previous<=anchor.messageTimestamp)continue;
   this.writeAnchor.run(id,jid,JSON.stringify(anchor));updated++;
   if(row.kind==='chat'&&!this.hasSavedMessage.get(id,jid))
     this.writePriority.run(id,jid,JSON.stringify({peer:jid,created:Date.now()}));
  }
  if(last)this.store.setConfig(key,String(last));
  // The active account's existing scheduler handles all requests, cooldowns
  // and retries; this worker itself never contacts WhatsApp.
  if(updated)this.onAnchorRecovered(id);
  return true;
 }
 step(){
  if(!this.started||this.closed||this.working)return;
  this.working=true;let nextDelay=15000;
  try{
   const accounts=this.allowedAccounts();
   if(this.recoverContacts(accounts))nextDelay=this.scanDelay;
   if(this.recoverAnchors(accounts))nextDelay=this.scanDelay;
   if(accounts.length){
    let selected=null;
    for(let i=0;i<accounts.length;i++){
     const index=(this.rotation+i)%accounts.length,id=accounts[index];
     const key='panel:name-scan:v1:'+id;
     const old=Number(this.cursor.get(key)?.value||0);
     const cursor=Number.isSafeInteger(old)&&old>=0?old:0;
     const rows=this.rows.all(id,cursor,this.batchSize);
     if(rows.length){selected={id,key,cursor,rows};this.rotation=(index+1)%accounts.length;break;}
    }
    if(selected){
     const {id,key,cursor,rows}=selected;
     let last=cursor;
     for(const row of rows){
      last=Number(row.rowid);
      let raw;
      try{raw=JSON.parse(row.value);}catch{continue;}
      const contact=messageContactName(raw);
      if(contact)this.upsert.run(id,contact.peer,contact.peer,contact.timestamp,JSON.stringify({name:contact.name}));
     }
     if(last!==cursor)this.store.setConfig(key,String(last));
     nextDelay=this.scanDelay;
    }
   }
  }finally{this.working=false;this.wake(nextDelay);}
 }
 shutdown(){
  this.closed=true;this.started=false;
  if(this.timer)clearTimeout(this.timer);
  this.timer=null;this.timerAt=0;
 }
}
