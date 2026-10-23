import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
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
  list(kind,limit=10000){return this.db.prepare('SELECT value FROM baileys_data WHERE account=? AND kind=? ORDER BY timestamp DESC LIMIT ?').all(this.account,kind,limit).map(r=>decode(r.value));}
  deleteChatMessages(peer){this.db.prepare("DELETE FROM baileys_data WHERE account=? AND kind='message' AND peer=?").run(this.account,peer);}
  clearCredentials(){this.db.prepare('DELETE FROM baileys_auth WHERE account=?').run(this.account);}
}
