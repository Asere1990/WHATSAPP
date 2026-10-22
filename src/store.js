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
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.db = new DatabaseSync(`${dir}/manager.sqlite`);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, phone TEXT UNIQUE, name TEXT, consent INTEGER DEFAULT 0, paused INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created INTEGER);
      CREATE TABLE IF NOT EXISTS access(hash TEXT PRIMARY KEY, account TEXT, kind TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS routes(tg_chat TEXT, tg_message INTEGER, account TEXT, peer TEXT, PRIMARY KEY(tg_chat,tg_message));
      CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY, account TEXT, message TEXT, peer TEXT, body TEXT, media TEXT, state TEXT DEFAULT 'pending', created INTEGER, UNIQUE(account,message));
      CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY, account TEXT, keyword TEXT, reply TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, account TEXT, event TEXT, created INTEGER);`);
  }
  all() { return this.db.prepare('SELECT * FROM accounts ORDER BY created DESC').all(); }
  account(id) { return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }
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
    // Entering a phone number alone never grants access to an existing account.
    if(this.db.prepare('SELECT id FROM accounts WHERE phone=?').get(phone))return null;
    const invite=this.invite(phone,`Cuenta · ${phone.slice(-4)}`);
    return this.exchange(invite.secret);
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
    this.db.prepare('INSERT OR IGNORE INTO inbox(account,message,peer,body,created) VALUES(?,?,?,?,?)').run(account,msg.id._serialized,msg.from,(msg.body||'').slice(0,12000),Date.now());
    return this.db.prepare('SELECT * FROM inbox WHERE account=? AND message=?').get(account,msg.id._serialized);
  }
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
    this.db.prepare('DELETE FROM routes WHERE rowid NOT IN (SELECT rowid FROM routes ORDER BY rowid DESC LIMIT 10000)').run();
  }
}
