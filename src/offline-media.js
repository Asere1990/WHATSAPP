import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,renameSync,rmSync,statSync,statfsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {BaileysStore} from './baileys-store.js';
import {describe} from './baileys.js';

const MB=1024*1024,GB=1024*MB;
const mediaTypes=new Set(['image','video','audio','ptt','document','sticker']);
const validAccount=/^[a-f0-9]{16}$/;
const safeMime=mime=>String(mime||'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0,100);
const fileName=value=>String(value||'archivo').replace(/[^a-z0-9._-]/gi,'_').slice(0,100)||'archivo';
const delay=attempt=>Math.min(6*3600000,30000*2**Math.min(attempt,8));
const persistedBytes=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

export class OfflineMediaArchive{
 constructor(store,dir){
  this.store=store;
  this.dir=path.join(dir,'offline-media');
  mkdirSync(this.dir,{recursive:true,mode:0o700});
  this.db=store.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS offline_media(
    account TEXT NOT NULL,message TEXT NOT NULL,peer TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',bytes INTEGER NOT NULL DEFAULT 0,
    mime TEXT NOT NULL DEFAULT '',filename TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,updated INTEGER NOT NULL,
    PRIMARY KEY(account,message));
    CREATE INDEX IF NOT EXISTS offline_media_due ON offline_media(account,status,next_try,created);`);
  this.accounts=null;this.timer=null;this.busy=false;this.closed=false;
  this.focusAccount=null;this.focusPeer=null;this.roundRobin=0;this.seedIds=new Set();
  this.maxFileBytes=Math.max(1,Math.min(100,Number(process.env.OFFLINE_MEDIA_MAX_MB)||80))*MB;
  this.quotaBytes=Math.max(1,Math.min(1000,Number(process.env.OFFLINE_MEDIA_QUOTA_GB)||40))*GB;
  this.fileSize=this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM offline_media WHERE status=?');
  this.newTask=this.db.prepare(`INSERT OR IGNORE INTO offline_media
   (account,message,peer,status,created,updated) VALUES(?,?,?,'pending',?,?)`);
  this.due=this.db.prepare(`SELECT account,message,peer,attempts FROM offline_media
   WHERE account=? AND status IN ('pending','retry') AND next_try<=?
   ORDER BY CASE WHEN peer=? THEN 0 ELSE 1 END,created DESC LIMIT 1`);
  this.read=this.db.prepare('SELECT * FROM offline_media WHERE account=? AND message=?');
  this.pending=new Map();
 }
 attach(accounts){this.accounts=accounts;}
 allowed(id){
  if(!validAccount.test(String(id)))return false;
  const a=this.store.account(id);
  return !!(a?.consent&&a.confirmed&&this.store.config()[`portal:${id}`]!=='cubamax-corporate');
 }
 keyFile(account,message){
  if(!validAccount.test(String(account)))throw Error('Cuenta de archivo inválida.');
  const hash=createHash('sha256').update(String(message)).digest('hex');
  return path.join(this.dir,account,hash+'.bin');
 }
 info(account,message){
  if(!this.allowed(account))return null;
  const row=this.read.get(account,message);
  if(!row||row.status!=='ready')return null;
  const filename=this.keyFile(account,message);
  try{
   const stat=statSync(filename);
   if(!stat.isFile()||stat.size!==row.bytes)return null;
   return {path:filename,size:stat.size,mime:safeMime(row.mime),name:fileName(row.filename)};
  }catch{return null;}
 }
 track(account,raw){
  if(this.closed||!this.allowed(account)||!raw?.key?.id||!raw.key.remoteJid)return false;
  const d=describe(raw);
  if(!mediaTypes.has(d.type)||!d.media||d.ephemeral||d.viewOnce)return false;
  const key=JSON.stringify([raw.key.remoteJid,raw.key.id,!!raw.key.fromMe,raw.key.participant||'']),now=Date.now();
  this.newTask.run(account,key,String(raw.key.remoteJid),now,now);
  this.wake(2500);
  return true;
 }
 focus(account,peer){
  this.focusAccount=this.allowed(account)?account:null;
  this.focusPeer=this.focusAccount&&typeof peer==='string'?peer:null;
  this.wake(200);
 }
 summary(account){
  if(!this.allowed(account))return {ready:0,pending:0,bytes:0};
  const row=this.db.prepare(`SELECT
    COALESCE(SUM(status='ready'),0) AS ready,
    COALESCE(SUM(status IN ('pending','retry')),0) AS pending,
    COALESCE(SUM(bytes),0) AS bytes
    FROM offline_media WHERE account=?`).get(account);
  return {ready:Number(row.ready),pending:Number(row.pending),bytes:Number(row.bytes)};
 }
 lastSync(account){return Number(this.store.config()['archive:last:'+account]||0);}
 markSync(account){
  if(!this.allowed(account))return;
  const last=this.lastSync(account),now=Date.now();
  if(now-last>=45000)this.store.setConfig('archive:last:'+account,String(now));
 }
 seed(account){
  if(!this.allowed(account))return;
  // Resume a bounded scan of media already indexed before this feature.
  const key='archive:seed:'+account;
  const saved=this.store.config()[key];
  if(saved==='done'){this.seedIds.delete(account);return;}
  const upper=saved?Number(saved):Number(this.db.prepare(
   "SELECT COALESCE(MAX(rowid),0) AS id FROM baileys_data WHERE account=? AND kind='message'"
  ).get(account)?.id||0);
  if(!upper){this.store.setConfig(key,'done');this.seedIds.delete(account);return;}
  const rows=this.db.prepare(`SELECT rowid,value FROM baileys_data
    WHERE account=? AND kind='message' AND rowid<=?
    ORDER BY rowid DESC LIMIT 120`).all(account,upper);
  for(const row of rows)try{this.track(account,JSON.parse(row.value, (k,v)=>v));}catch{}
  if(rows.length<120){this.store.setConfig(key,'done');this.seedIds.delete(account);}
  else {this.store.setConfig(key,String(Number(rows.at(-1).rowid)-1));this.seedIds.add(account);}
  this.wake(3000);
 }
 // Existing archive remains available during a network outage. Seeding does
 // not require connection, but downloads only run for authorized ready sessions.
 wake(ms=1000){
  if(this.closed||this.timer||this.busy)return;
  this.timer=setTimeout(()=>{
   this.timer=null;
   this.pump().catch(error=>console.error('WHATSAPP: archive_worker_error',error.code||error.message||'error'));
  },ms);this.timer.unref?.();
 }
 budget(expected=0){
  try{
   const disk=statfsSync(this.dir);
   const total=Number(disk.blocks)*Number(disk.bsize);
   const available=Number(disk.bavail)*Number(disk.bsize);
   const reserve=Math.max(128*MB,Math.min(512*MB,total*.08));
   const used=Number(this.fileSize.get('ready')?.bytes||0);
   return available-expected>reserve&&used+expected<=this.quotaBytes;
  }catch{return false;}
 }
 setStatus(row,status,extra={}){
  this.db.prepare(`UPDATE offline_media SET status=?,bytes=?,mime=?,filename=?,
   attempts=?,next_try=?,updated=? WHERE account=? AND message=?`).run(
    status,extra.bytes??row.bytes??0,extra.mime??row.mime??'',extra.filename??row.filename??'',
    extra.attempts??row.attempts??0,extra.next_try??row.next_try??0,Date.now(),row.account,row.message);
 }
 async obtain(account,message,raw,client){
  if(!this.allowed(account))throw Error('Cuenta no autorizada.');
  const existing=this.info(account,message);if(existing)return existing;
  const d=describe(raw);
  if(!d.media||!mediaTypes.has(d.type)||d.ephemeral||d.viewOnce)throw Error('Archivo no disponible para guardar.');
  const row=this.read.get(account,message)||{
   account,message,peer:raw.key.remoteJid,bytes:0,attempts:0,next_try:0
  };
  if(!this.read.get(account,message))this.newTask.run(account,message,row.peer,Date.now(),Date.now());
  const declared=Number(d.media.fileLength||0);
  if(declared>this.maxFileBytes){
   this.setStatus(row,'oversize',{next_try:0});
   throw Error('Archivo superior al límite de caché multimedia.');
  }
  if(!this.budget(declared||this.maxFileBytes)){
   this.setStatus(row,'retry',{next_try:Date.now()+300000});
   throw Error('Espacio de almacenamiento reservado. Amplía el disco o revisa la capacidad.');
  }
  const key=account+':'+message;
  if(this.pending.has(key))return this.pending.get(key);
  const job=(async()=>{
   const filename=this.keyFile(account,message),folder=path.dirname(filename);
   mkdirSync(folder,{recursive:true,mode:0o700});
   const temp=filename+'.part-'+randomBytes(6).toString('hex');
   let output;
   try{
    if(typeof client.downloadMediaFile==='function'){
     output=await client.downloadMediaFile(raw,temp,this.maxFileBytes);
    }else{
     // Supports older clients in a controlled fallback; the Baileys path above
     // streams to disk and does not buffer large video payloads in memory.
     const downloaded=await client.wrap(raw).downloadMedia();
     if(!downloaded)throw Error('WhatsApp no entregó el archivo.');
     const bytes=Buffer.from(downloaded.data,'base64');
     if(bytes.length>this.maxFileBytes)throw Error('Archivo demasiado grande.');
     writeFileSync(temp,bytes,{flag:'wx',mode:0o600});
     output={bytes:bytes.length,mime:downloaded.mimetype,name:downloaded.filename};
    }
    const stat=statSync(temp);
    if(!stat.isFile()||stat.size===0||stat.size>this.maxFileBytes)throw Error('Archivo incompleto o demasiado grande.');
    if(!this.allowed(account))throw Error('Cuenta revocada durante la descarga.');
    if(!this.budget(stat.size))throw Error('No queda espacio reservado para guardar el archivo.');
    renameSync(temp,filename);
    this.setStatus(row,'ready',{bytes:stat.size,mime:safeMime(output.mime||d.media.mimetype),
     filename:fileName(output.name||d.media.fileName||d.type),attempts:0,next_try:0});
    return this.info(account,message);
   }catch(error){
    rmSync(temp,{force:true});
    const attempts=Number(row.attempts||0)+1;
    const status=/demasiado grande|límite de caché/.test(error.message)?'oversize':'retry';
    this.setStatus(row,status,{attempts,next_try:Date.now()+delay(attempts)});
    throw error;
   }
  })();
  this.pending.set(key,job);
  try{return await job;}finally{this.pending.delete(key);}
 }
 async onDemand(account,message,raw,client){
  return this.obtain(account,message,raw,client);
 }
 async pump(){
  if(this.busy||this.closed)return;
  this.busy=true;
  try{
   // Re-index existing history in short, resumable batches before fetching.
   const seed=[...this.seedIds].find(id=>this.allowed(id));
   if(seed)this.seed(seed);
   const entries=[...(this.accounts?.live||new Map()).entries()]
    .filter(([id,entry])=>entry?.ready&&this.allowed(id));
   if(!entries.length)return;
   const ids=entries.map(([id])=>id);
   const prioritized=this.focusAccount&&ids.includes(this.focusAccount)?[this.focusAccount]:[];
   const candidates=[...prioritized,...ids.slice(this.roundRobin%ids.length),...ids.slice(0,this.roundRobin%ids.length)]
    .filter((id,index,list)=>list.indexOf(id)===index);
   this.roundRobin++;
   for(const account of candidates){
    const row=this.due.get(account,Date.now(),account===this.focusAccount?this.focusPeer||'':'');
    if(!row)continue;
    const raw=new BaileysStore(this.store,account).get('message',row.message);
    if(!raw||describe(raw).ephemeral||describe(raw).viewOnce){
     this.setStatus(row,'unavailable',{next_try:0});continue;
    }
    try{await this.obtain(account,row.message,raw,this.accounts.live.get(account).client);}
    catch(error){
     // Do not log private media or message identifiers. Retrying is persisted.
     console.warn('WHATSAPP: archive_media_retry',JSON.stringify({
       status:row.status,error:String(error.code||error.name||'DOWNLOAD_FAILED').slice(0,50)
     }));
    }
    break;
   }
  }finally{
   this.busy=false;
   if(!this.closed){
    // Keep the queue durable. A reconnect immediately wakes it again.
    this.wake(18000);
   }
  }
 }
 async shutdown(){
  this.closed=true;
  if(this.timer)clearTimeout(this.timer);
  this.timer=null;
  await Promise.allSettled([...this.pending.values()]);
 }
}
