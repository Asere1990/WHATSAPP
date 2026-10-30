import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import {authenticatedSelfJids,normalizedPrivateJid,projectAuthenticatedSelfMessage} from './self-chat.js';
const encode=value=>JSON.stringify(value,BufferJSON.replacer);
const decode=value=>value?JSON.parse(value,BufferJSON.reviver):undefined;
export class BaileysStore {
  constructor(store,account){
    this.db=store.db;this.account=account;
    this.db.exec(`CREATE TABLE IF NOT EXISTS baileys_auth(account TEXT,kind TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(account,kind,id));
      CREATE TABLE IF NOT EXISTS baileys_data(account TEXT,kind TEXT,id TEXT,peer TEXT,timestamp INTEGER,value TEXT NOT NULL,PRIMARY KEY(account,kind,id));
      CREATE INDEX IF NOT EXISTS baileys_peer ON baileys_data(account,kind,peer,timestamp);`);
    this.readAuth=this.db.prepare('SELECT value FROM baileys_auth WHERE account=? AND kind=? AND id=?');
    this.writeAuth=this.db.prepare('INSERT OR REPLACE INTO baileys_auth VALUES(?,?,?,?)');
    this.deleteAuth=this.db.prepare('DELETE FROM baileys_auth WHERE account=? AND kind=? AND id=?');
    this.readData=this.db.prepare('SELECT value FROM baileys_data WHERE account=? AND kind=? AND id=?');
    this.writeData=this.db.prepare('INSERT OR REPLACE INTO baileys_data VALUES(?,?,?,?,?,?)');
  }
  enableArchive(){
    if(this.get('archive-init','v2'))return;
    for(const {peer}of this.db.prepare("SELECT DISTINCT peer FROM baileys_data WHERE account=? AND kind='message' AND peer IS NOT NULL").all(this.account)){
      const latest=this.messages(peer,1)[0],oldest=this.get('cursor',peer)||this.oldestMessage(peer);
      if(latest&&oldest){this.put('archive-backfill',peer,{cursor:{key:latest.key,messageTimestamp:Number(latest.messageTimestamp)},boundary:Number(oldest.messageTimestamp),active:true});this.remove('history-sync',peer);}
    }
    this.put('archive-init','v2',{created:Date.now()});
  }
  primeArchive(msg){const peer=msg.key.remoteJid;if(this.get('archive-live-anchor-v2',peer))return;const old=this.peers(peer).map(p=>this.get('cursor',p)||this.oldestMessage(p)).filter(Boolean).sort((a,b)=>Number(a.messageTimestamp)-Number(b.messageTimestamp))[0];if(old&&Number(msg.messageTimestamp)>Number(old.messageTimestamp)){this.put('archive-backfill',peer,{cursor:{key:msg.key,messageTimestamp:Number(msg.messageTimestamp)},boundary:Number(old.messageTimestamp),active:true});this.remove('history-sync',peer);}this.put('archive-live-anchor-v2',peer,{created:Date.now()});}
  advanceArchive(msg){const backfill=this.get('archive-backfill',msg.key.remoteJid);if(backfill?.active&&Number(msg.messageTimestamp)<Number(backfill.cursor.messageTimestamp)){backfill.cursor={key:msg.key,messageTimestamp:Number(msg.messageTimestamp)};if(Number(msg.messageTimestamp)<=backfill.boundary)backfill.active=false;this.put('archive-backfill',msg.key.remoteJid,backfill);}}
  // Only credentials authenticated to this account supply the self-chat alias.
  selfJids(){
    // Cubamax and ordinary contact mapping retain their existing behavior.
    if(this.db.prepare('SELECT value FROM config WHERE key=?').get('portal:'+this.account)?.value==='cubamax-corporate')return [];
    const account=this.db.prepare('SELECT phone FROM accounts WHERE id=?').get(this.account);
    return authenticatedSelfJids(account?.phone,this.authValue('creds','self')?.me);
  }
  isSelfChat(peer){return this.selfJids().includes(normalizedPrivateJid(peer));}
  projectSelfMessage(raw){
    // Normal chats and already-decoded self messages take the original fast
    // path, without an extra database lookup for every displayed message.
    if(!raw?.message?.deviceSentMessage)return raw;
    return projectAuthenticatedSelfMessage(raw,this.selfJids());
  }
  peers(peer){
    if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(peer))return [peer];
    const own=this.selfJids();
    // Use only independently authenticated self aliases: a stale or
    // incorrect mapping must never drag a different contact into self-chat.
    if(own.includes(peer)&&own.length>1)return [...new Set([peer,...own])];
    const result=new Set([peer]),pn=this.get('mapping',peer);
    if(typeof pn==='string'&&/^\d+@s\.whatsapp\.net$/.test(pn)&&!own.includes(pn))result.add(pn);
    for(const row of this.db.prepare("SELECT id FROM baileys_data WHERE account=? AND kind='mapping' AND json_extract(value,'$')=?").all(this.account,pn||peer))
      if(/^\d+@lid$/.test(row.id)&&!own.includes(row.id))result.add(row.id);
    return [...result];
  }
  canonical(peer){return this.peers(peer).find(p=>p.endsWith('@s.whatsapp.net'))||peer;}
  authValue(kind,id){return decode(this.readAuth.get(this.account,kind,id)?.value);}
  registered(){const c=this.authValue('creds','self');return !!(c?.registered||c?.me?.id);}
  auth(){
    const creds=this.authValue('creds','self')||initAuthCreds();
    const saveCreds=()=>this.writeAuth.run(this.account,'creds','self',encode(creds));
    const keys={get:async(type,ids)=>Object.fromEntries(ids.map(id=>{let value=this.authValue(type,id);if(type==='app-state-sync-key'&&value)value=proto.Message.AppStateSyncKeyData.fromObject(value);return [id,value];})),set:async data=>{
      this.db.exec('BEGIN IMMEDIATE');try{for(const [kind,items]of Object.entries(data))for(const [id,value]of Object.entries(items)){
        if(value==null)this.deleteAuth.run(this.account,kind,id);else this.writeAuth.run(this.account,kind,id,encode(value));
      }this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    }};
    saveCreds();return {state:{creds,keys},saveCreds};
  }
  get(kind,id){return decode(this.readData.get(this.account,kind,id)?.value);}
  put(kind,id,value,{peer=null,timestamp=0,merge=false}={}){
    if(!id)return;
    if(merge)value={...this.get(kind,id),...value};
    this.writeData.run(this.account,kind,id,peer,Number(timestamp)||0,encode(value));
  }
  remove(kind,id){this.db.prepare('DELETE FROM baileys_data WHERE account=? AND kind=? AND id=?').run(this.account,kind,id);}
  messageKey(key){return JSON.stringify([key.remoteJid,key.id,!!key.fromMe,key.participant||'']);}
  message(msg){if(msg.key?.remoteJid&&msg.key.id)this.put('message',this.messageKey(msg.key),msg,{peer:msg.key.remoteJid,timestamp:msg.messageTimestamp});}
  messages(peer,limit=500){return this.db.prepare("SELECT value FROM baileys_data WHERE account=? AND kind='message' AND peer=? ORDER BY timestamp DESC,rowid DESC LIMIT ?").all(this.account,peer,limit).map(r=>decode(r.value)).reverse();}
  galleryPage(peer,offset=0,limit=100){return this.db.prepare("SELECT value FROM baileys_data WHERE account=? AND kind='message' AND peer=? AND (json_type(value,'$.message.imageMessage') IS NOT NULL OR json_type(value,'$.message.videoMessage') IS NOT NULL) ORDER BY timestamp DESC,id DESC LIMIT ? OFFSET ?").all(this.account,peer,limit,offset).map(r=>decode(r.value));}
  galleryCounts(peer){const row=this.db.prepare("SELECT COALESCE(SUM(json_type(value,'$.message.imageMessage') IS NOT NULL),0) AS photos,COALESCE(SUM(json_type(value,'$.message.videoMessage') IS NOT NULL),0) AS videos FROM baileys_data WHERE account=? AND kind='message' AND peer=?").get(this.account,peer);return row;}
  oldestMessage(peer){return decode(this.db.prepare("SELECT value FROM baileys_data WHERE account=? AND kind='message' AND peer=? ORDER BY timestamp ASC,id ASC LIMIT 1").get(this.account,peer)?.value);}
  rememberOldest(msg){const old=this.get('cursor',msg.key.remoteJid);if(!old||Number(msg.messageTimestamp)<Number(old.messageTimestamp))this.put('cursor',msg.key.remoteJid,{key:msg.key,messageTimestamp:Number(msg.messageTimestamp)});}
  list(kind,limit=10000){return this.db.prepare('SELECT value FROM baileys_data WHERE account=? AND kind=? ORDER BY timestamp DESC LIMIT ?').all(this.account,kind,limit).map(r=>decode(r.value));}
  deleteChatMessages(peer){this.db.prepare("DELETE FROM baileys_data WHERE account=? AND kind='message' AND peer=?").run(this.account,peer);}
  clearCredentials(){this.db.prepare('DELETE FROM baileys_auth WHERE account=?').run(this.account);}
}
