import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function phoneNumber(value) {
  const p = String(value || '').replace(/[ +()-]/g, '');
  if (!/^[1-9][0-9]{7,14}$/.test(p)) throw new Error('Usa el número completo con código de país.');
  return p;
}
export function normalizeInbound(msg) {
  if(!msg || msg.fromMe || msg.isStatus || msg.broadcast) return null;
  if(typeof msg.from!=='string' || !/^[0-9]+@(c\.us|lid)$/.test(msg.from)) return null;
  const supported=new Set(['chat','image','video','audio','ptt','document','sticker']);
  if(msg.type && !supported.has(msg.type)) return null;
  const id=typeof msg.id==='string'?msg.id:msg.id?._serialized;
  if(typeof id!=='string' || !id.trim()) {
    const error=new TypeError('El mensaje no tiene un identificador válido.');
    error.code='INVALID_MESSAGE_ID';throw error;
  }
  return {id:{_serialized:id},from:msg.from,body:typeof msg.body==='string'?msg.body:'',type:msg.type||'chat'};
}
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.db = new DatabaseSync(`${dir}/manager.sqlite`);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, phone TEXT UNIQUE, name TEXT, consent INTEGER DEFAULT 0, paused INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created INTEGER);
      CREATE TABLE IF NOT EXISTS account_archives(account TEXT PRIMARY KEY, metadata TEXT NOT NULL, archived INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS access(hash TEXT PRIMARY KEY, account TEXT, kind TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS routes(tg_chat TEXT, tg_message INTEGER, account TEXT, peer TEXT, PRIMARY KEY(tg_chat,tg_message));
      CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY, account TEXT, message TEXT, peer TEXT, body TEXT, media TEXT, state TEXT DEFAULT 'pending', created INTEGER, UNIQUE(account,message));
      CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY, account TEXT, keyword TEXT, reply TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, account TEXT, event TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY, account TEXT, reference TEXT, stage TEXT, code TEXT, state TEXT DEFAULT 'open', created INTEGER, UNIQUE(account,reference,stage));
      CREATE TABLE IF NOT EXISTS profiles(account TEXT, peer TEXT, name TEXT, phone TEXT, PRIMARY KEY(account,peer));
      CREATE TABLE IF NOT EXISTS export_receipts(account TEXT, message TEXT, tg_chat TEXT, tg_message INTEGER, PRIMARY KEY(account,message));
      CREATE TABLE IF NOT EXISTS media_exports(account TEXT, message TEXT, state TEXT, created INTEGER, PRIMARY KEY(account,message));`);
  }
  all() { return this.db.prepare("SELECT * FROM accounts WHERE status!='archived' ORDER BY created DESC").all(); }
  account(id) { return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }
  profile(account,peer) {return this.db.prepare('SELECT * FROM profiles WHERE account=? AND peer=?').get(account,peer);}
  saveProfile(account,peer,name,phone) {this.db.prepare('INSERT OR REPLACE INTO profiles VALUES(?,?,?,?)').run(account,peer,String(name||'Sin nombre').slice(0,120),String(phone||''));}
  exportState(account,message) {return this.db.prepare('SELECT state FROM media_exports WHERE account=? AND message=?').get(account,message)?.state;}
  claimExport(account,message) {return this.db.prepare("INSERT OR IGNORE INTO media_exports VALUES(?,?,'processing',?)").run(account,message,Date.now()).changes>0;}
  receipt(account,message) {return this.db.prepare('SELECT * FROM export_receipts WHERE account=? AND message=?').get(account,message);}
  resetUnverifiedExport(account,message) {return this.db.prepare("DELETE FROM media_exports WHERE account=? AND message=? AND state='done' AND NOT EXISTS(SELECT 1 FROM export_receipts r WHERE r.account=media_exports.account AND r.message=media_exports.message)").run(account,message).changes>0;}
  exportReceipt(account,message,chat,tgMessage) {this.db.prepare('INSERT OR REPLACE INTO export_receipts VALUES(?,?,?,?)').run(account,message,String(chat),tgMessage);}
  finishExport(account,message,state) {this.db.prepare('UPDATE media_exports SET state=? WHERE account=? AND message=?').run(state,account,message);}
  update(id, key, value) {
    if (!['consent','paused','status'].includes(key)) throw new Error('Campo inválido');
    this.db.prepare(`UPDATE accounts SET ${key}=? WHERE id=?`).run(value,id);
  }
  invite(phone, name) {
    phone = phoneNumber(phone);
    let a = this.db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
    if (!a) {
      const id = randomBytes(8).toString('hex');
      this.db.prepare('INSERT INTO accounts(id,phone,name,created) VALUES(?,?,?,?)').run(id,phone,name.slice(0,80),Date.now());
      a = this.account(id);
    }
    this.db.prepare("DELETE FROM access WHERE account=? AND kind='invite'").run(a.id);
    const secret = token();
    this.db.prepare('INSERT INTO access VALUES(?,?,?,?)').run(digest(secret),a.id,'invite',Date.now()+86400000);
    return { account:a, secret };
  }
  exchange(secret) {
    const row=this.db.prepare("SELECT * FROM access WHERE hash=? AND kind='invite' AND expires>?").get(digest(secret),Date.now());
    if (!row) return null;
    this.db.prepare('DELETE FROM access WHERE hash=?').run(row.hash);
    const session=token();
    this.db.prepare('INSERT INTO access VALUES(?,?,?,?)').run(digest(session),row.account,'browser',Date.now()+86400000*30);
    return session;
  }
  register(phone) {
    phone=phoneNumber(phone);
    const existing=this.db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
    // A revoked account may start again with fresh credentials and a fresh account ID.
    // An active account can never be claimed by merely entering its phone number.
    if(existing&&(existing.consent||existing.status!=='revoked'))return null;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(existing){
        this.db.prepare('INSERT OR REPLACE INTO account_archives VALUES(?,?,?)').run(existing.id,JSON.stringify(existing),Date.now());
        this.db.prepare('DELETE FROM access WHERE account=?').run(existing.id);
        this.db.prepare("UPDATE accounts SET phone=NULL,status='archived',consent=0 WHERE id=?").run(existing.id);
        this.audit(existing.id,'archived_after_revocation');
      }
      const invite=this.invite(phone,'Cuenta de WhatsApp'),secret=this.exchange(invite.secret);
      this.db.exec('COMMIT');return secret;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  browser(secret) {
    if (!secret) return null;
    const row=this.db.prepare("SELECT account FROM access WHERE hash=? AND kind='browser' AND expires>?").get(digest(secret),Date.now());
    return row && this.account(row.account);
  }
  revoke(id) { this.db.prepare('DELETE FROM access WHERE account=?').run(id); this.update(id,'consent',0); this.update(id,'status','revoked'); this.audit(id,'revoked'); }
  config() { return Object.fromEntries(this.db.prepare('SELECT key,value FROM config').all().map(x=>[x.key,x.value])); }
  setConfig(key,value) { this.db.prepare('INSERT OR REPLACE INTO config VALUES(?,?)').run(key,value); }
  audit(id,event) { this.db.prepare('INSERT INTO audit(account,event,created) VALUES(?,?,?)').run(id,event,Date.now()); }
  route(chat,message,account,peer) { this.db.prepare('INSERT OR REPLACE INTO routes VALUES(?,?,?,?)').run(String(chat),message,account,peer); }
  getRoute(chat,message) { return this.db.prepare('SELECT * FROM routes WHERE tg_chat=? AND tg_message=?').get(String(chat),message); }
  enqueue(account,msg) {
    msg=normalizeInbound(msg);
    if(!msg)return null;
    this.db.prepare('INSERT OR IGNORE INTO inbox(account,message,peer,body,created) VALUES(?,?,?,?,?)').run(account,msg.id._serialized,msg.from,(msg.body||'').slice(0,12000),Date.now());
    return this.db.prepare('SELECT * FROM inbox WHERE account=? AND message=?').get(account,msg.id._serialized);
  }
  recordIncident(account,stage,error,reference=null) {
    const code=typeof error?.code==='string'?error.code.slice(0,80):String(error?.name||'Error').slice(0,80);
    reference=typeof reference==='string'?reference:null;
    this.db.prepare('INSERT OR IGNORE INTO incidents(account,reference,stage,code,created) VALUES(?,?,?,?,?)').run(account,reference,stage,code,Date.now());
    return reference?this.db.prepare("SELECT * FROM incidents WHERE account=? AND reference=? AND stage=?").get(account,reference,stage):this.db.prepare("SELECT * FROM incidents WHERE id=last_insert_rowid()").get();
  }
  openIncidents() { return this.db.prepare("SELECT id,account,stage,code FROM incidents WHERE state='open' ORDER BY id DESC LIMIT 30").all(); }
  setRule(account,keyword,reply) {
    this.db.prepare('DELETE FROM rules WHERE account=? AND keyword=?').run(account,keyword);
    this.db.prepare('INSERT INTO rules(account,keyword,reply) VALUES(?,?,?)').run(account,keyword.toLowerCase(),reply);
  }
  rules(account) { return this.db.prepare('SELECT * FROM rules WHERE account=? ORDER BY id').all(account); }
  cleanup() {
    const cutoff=Date.now()-7*86400000;
    this.db.prepare('DELETE FROM access WHERE expires<?').run(Date.now());
    this.db.prepare('DELETE FROM inbox WHERE created<?').run(cutoff);
    this.db.prepare('DELETE FROM audit WHERE created<?').run(Date.now()-90*86400000);
    this.db.prepare('DELETE FROM incidents WHERE created<?').run(Date.now()-90*86400000);
    this.db.prepare('DELETE FROM routes WHERE rowid NOT IN (SELECT rowid FROM routes ORDER BY rowid DESC LIMIT 10000)').run();
  }
}

