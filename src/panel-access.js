import {randomBytes,createHash,createHmac} from 'node:crypto';
import {credentialFor,credentialFingerprint,verifyWebPassword} from './web-credentials.js';
const secret=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
export class PanelAccess{
 constructor(store,role,operatorFile){this.store=store;this.role=role;this.operatorFile=operatorFile;store.db.exec(`
 CREATE TABLE IF NOT EXISTS panel_tokens(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_referral_sites(hash TEXT PRIMARY KEY,site TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_referral_short(id INTEGER PRIMARY KEY AUTOINCREMENT,hash TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS panel_sessions(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_owners(account TEXT PRIMARY KEY,actor TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS panel_owners_actor ON panel_owners(actor);
 CREATE TABLE IF NOT EXISTS panel_people(actor TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_sends(actor TEXT,request TEXT,account TEXT,state TEXT,created INTEGER,PRIMARY KEY(actor,request));
 CREATE TABLE IF NOT EXISTS panel_web_sessions(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL,fingerprint TEXT NOT NULL);`);store.db.prepare("UPDATE panel_tokens SET kind='panel',expires=0 WHERE kind='login'").run();store.db.prepare('UPDATE panel_sessions SET expires=0').run();store.setConfig('panel_archive','1');}
 remember(actor,name){this.store.db.prepare('INSERT OR REPLACE INTO panel_people VALUES(?,?)').run(String(actor),String(name||'Usuario autorizado').slice(0,100));}
 label(actor){return this.store.db.prepare('SELECT name FROM panel_people WHERE actor=?').get(String(actor))?.name||'Telegram '+actor;}
 token(actor,kind,{site='cm'}={}){actor=String(actor);if(!this.role(actor))throw Error('Acceso no autorizado.');if(kind==='referral'&&!['wa','cm'].includes(site))throw Error('Página no disponible.');const value=secret(),now=Date.now();this.store.db.prepare('DELETE FROM panel_tokens WHERE expires>0 AND expires<?').run(now);this.store.db.prepare('DELETE FROM panel_referral_sites WHERE hash NOT IN (SELECT hash FROM panel_tokens)').run();this.store.db.prepare("DELETE FROM panel_referral_short WHERE hash NOT IN (SELECT hash FROM panel_tokens WHERE kind='referral')").run();const digest=hash(value);this.store.db.prepare('INSERT INTO panel_tokens VALUES(?,?,?,?)').run(digest,actor,kind,now+(kind==='login'?300000:30*86400000));if(kind==='referral')this.store.db.prepare('INSERT INTO panel_referral_sites VALUES(?,?)').run(digest,site);return value;}
 short(value){if(!/^[\w-]{43}$/.test(value||''))throw Error('Enlace no válido.');const digest=hash(value);if(!this.store.db.prepare("SELECT hash FROM panel_tokens WHERE hash=? AND kind='referral' AND expires>?").get(digest,Date.now()))throw Error('Enlace no válido.');this.store.db.prepare('INSERT OR IGNORE INTO panel_referral_short(hash) VALUES (?)').run(digest);return String(this.store.db.prepare('SELECT id FROM panel_referral_short WHERE hash=?').get(digest).id).padStart(5,'0');}
 referral(value){const digest=/^[\w-]{43}$/.test(value||'')?hash(value):/^\d{5,15}$/.test(value||'')?this.store.db.prepare('SELECT hash FROM panel_referral_short WHERE id=?').get(Number(value))?.hash:null;if(!digest)return null;const row=this.store.db.prepare("SELECT actor,COALESCE(s.site,'cm') AS site FROM panel_tokens t LEFT JOIN panel_referral_sites s ON s.hash=t.hash WHERE t.hash=? AND kind='referral' AND expires>?").get(digest,Date.now());return row&&this.role(row.actor)?{actor:row.actor,name:this.label(row.actor),site:row.site}:null;}
 permanent(actor){actor=String(actor);if(!this.role(actor))throw Error('Acceso no autorizado.');let key=this.store.config().panel_link_key;if(!key){key=randomBytes(32).toString('hex');this.store.setConfig('panel_link_key',key);}const generation=this.store.config()['panel_link_version:'+actor]||'0',value=createHmac('sha256',key).update(actor+':'+generation).digest('base64url');this.store.db.prepare("INSERT OR IGNORE INTO panel_tokens VALUES(?,?,'panel',0)").run(hash(value),actor);return value;}
 revoke(actor){actor=String(actor);if(!this.role(actor))throw Error('Acceso no autorizado.');this.store.db.prepare("DELETE FROM panel_tokens WHERE actor=? AND kind IN ('panel','login')").run(actor);this.store.db.prepare('DELETE FROM panel_sessions WHERE actor=?').run(actor);this.store.db.prepare('DELETE FROM panel_web_sessions WHERE actor=?').run(actor);this.store.setConfig('panel_link_version:'+actor,secret());}
 login(value){if(!/^[\w-]{43}$/.test(value||''))return null;const now=Date.now(),row=this.store.db.prepare("SELECT actor,kind FROM panel_tokens WHERE hash=? AND kind IN ('login','panel') AND (expires=0 OR expires>?)").get(hash(value),now);if(!row||!this.role(row.actor))return null;const valueSession=secret(),csrf=secret();this.store.db.exec('BEGIN IMMEDIATE');try{if(row.kind==='login')this.store.db.prepare('DELETE FROM panel_tokens WHERE hash=?').run(hash(value));this.store.db.prepare('DELETE FROM panel_sessions WHERE expires>0 AND expires<?').run(now);this.store.db.prepare('INSERT INTO panel_sessions VALUES(?,?,?,?)').run(hash(valueSession),row.actor,csrf,0);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}return {secret:valueSession,actor:row.actor,csrf};}
 webLogin(actor,password){
  actor=String(actor||'');
  const role=this.role(actor),record=credentialFor(actor,role,this.operatorFile);
  if(!record||!verifyWebPassword(password,record))return null;
  const value=secret(),csrf=secret(),now=Date.now();
  this.store.db.prepare('DELETE FROM panel_web_sessions WHERE expires<?').run(now);
  this.store.db.prepare('INSERT INTO panel_web_sessions(hash,actor,csrf,expires,fingerprint) VALUES(?,?,?,?,?)')
    .run(hash(value),actor,csrf,now+7*86400000,credentialFingerprint(record));
  return {secret:value,actor,csrf};
 }
 session(value){
  if(!/^[\w-]{43}$/.test(value||''))return null;
  const row=this.store.db.prepare('SELECT actor,csrf FROM panel_sessions WHERE hash=? AND (expires=0 OR expires>?)').get(hash(value),Date.now());
  if(row&&this.role(row.actor))return {...row,role:this.role(row.actor)};
  const passwordSession=this.store.db.prepare('SELECT actor,csrf,fingerprint FROM panel_web_sessions WHERE hash=? AND expires>?').get(hash(value),Date.now());
  if(!passwordSession)return null;
  const role=this.role(passwordSession.actor);
  const current=credentialFor(passwordSession.actor,role,this.operatorFile);
  if(!current||credentialFingerprint(current)!==passwordSession.fingerprint)return null;
  return {actor:passwordSession.actor,csrf:passwordSession.csrf,role};
 }
 logout(value){this.store.db.prepare('DELETE FROM panel_sessions WHERE hash=?').run(hash(value));this.store.db.prepare('DELETE FROM panel_web_sessions WHERE hash=?').run(hash(value));}
 owner(account){return this.store.db.prepare('SELECT actor FROM panel_owners WHERE account=?').get(account)?.actor||null;}
 attach(account,referral){const who=this.referral(referral);if(!who)throw Error('El enlace de vinculación venció o fue revocado. Solicita uno nuevo en Telegram.');const old=this.owner(account);if(old&&old!==who.actor)throw Error('La cuenta ya está asignada a otro usuario.');this.store.db.prepare('INSERT OR IGNORE INTO panel_owners VALUES(?,?,?)').run(account,who.actor,Date.now());return who;}
 allowed(actor,account){const a=this.store.account(account);return !!a?.consent&&!!a.confirmed&&a.status!=='archived'&&(this.role(String(actor))==='admin'||this.role(String(actor))==='operator'&&this.owner(account)===String(actor));}
 accounts(actor){return this.store.all().filter(a=>this.allowed(actor,a.id));}
}
