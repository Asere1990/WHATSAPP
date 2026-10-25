import {randomBytes,createHash} from 'node:crypto';
const secret=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
export class PanelAccess{
 constructor(store,role){this.store=store;this.role=role;store.db.exec(`
 CREATE TABLE IF NOT EXISTS panel_tokens(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_sessions(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_owners(account TEXT PRIMARY KEY,actor TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS panel_owners_actor ON panel_owners(actor);
 CREATE TABLE IF NOT EXISTS panel_people(actor TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS panel_sends(actor TEXT,request TEXT,account TEXT,state TEXT,created INTEGER,PRIMARY KEY(actor,request));`);store.setConfig('panel_archive','1');}
 remember(actor,name){this.store.db.prepare('INSERT OR REPLACE INTO panel_people VALUES(?,?)').run(String(actor),String(name||'Usuario autorizado').slice(0,100));}
 label(actor){return this.store.db.prepare('SELECT name FROM panel_people WHERE actor=?').get(String(actor))?.name||'Telegram '+actor;}
 token(actor,kind){actor=String(actor);if(!this.role(actor))throw Error('Acceso no autorizado.');const value=secret(),now=Date.now();this.store.db.prepare('DELETE FROM panel_tokens WHERE expires<?').run(now);if(kind==='referral')this.store.db.prepare("DELETE FROM panel_tokens WHERE actor=? AND kind='referral'").run(actor);this.store.db.prepare('INSERT INTO panel_tokens VALUES(?,?,?,?)').run(hash(value),actor,kind,now+(kind==='login'?300000:30*86400000));return value;}
 referral(value){if(!/^[\w-]{43}$/.test(value||''))return null;const row=this.store.db.prepare("SELECT actor FROM panel_tokens WHERE hash=? AND kind='referral' AND expires>?").get(hash(value),Date.now());return row&&this.role(row.actor)?{actor:row.actor,name:this.label(row.actor)}:null;}
 login(value){if(!/^[\w-]{43}$/.test(value||''))return null;const now=Date.now(),row=this.store.db.prepare("SELECT actor FROM panel_tokens WHERE hash=? AND kind='login' AND expires>?").get(hash(value),now);if(!row||!this.role(row.actor))return null;const valueSession=secret(),csrf=secret();this.store.db.exec('BEGIN IMMEDIATE');try{this.store.db.prepare('DELETE FROM panel_tokens WHERE hash=?').run(hash(value));this.store.db.prepare('DELETE FROM panel_sessions WHERE expires<?').run(now);this.store.db.prepare('INSERT INTO panel_sessions VALUES(?,?,?,?)').run(hash(valueSession),row.actor,csrf,now+7*86400000);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}return {secret:valueSession,actor:row.actor,csrf};}
 session(value){if(!/^[\w-]{43}$/.test(value||''))return null;const row=this.store.db.prepare('SELECT actor,csrf FROM panel_sessions WHERE hash=? AND expires>?').get(hash(value),Date.now());return row&&this.role(row.actor)?{...row,role:this.role(row.actor)}:null;}
 logout(value){this.store.db.prepare('DELETE FROM panel_sessions WHERE hash=?').run(hash(value));}
 owner(account){return this.store.db.prepare('SELECT actor FROM panel_owners WHERE account=?').get(account)?.actor||null;}
 attach(account,referral){const who=this.referral(referral);if(!who)throw Error('El enlace de vinculación venció o fue revocado. Solicita uno nuevo en Telegram.');const old=this.owner(account);if(old&&old!==who.actor)throw Error('La cuenta ya está asignada a otro usuario.');this.store.db.prepare('INSERT OR IGNORE INTO panel_owners VALUES(?,?,?)').run(account,who.actor,Date.now());return who;}
 allowed(actor,account){const a=this.store.account(account);return !!a?.consent&&!!a.confirmed&&a.status!=='archived'&&(this.role(String(actor))==='admin'||this.role(String(actor))==='operator'&&this.owner(account)===String(actor));}
 accounts(actor){return this.store.all().filter(a=>this.allowed(actor,a.id));}
}
