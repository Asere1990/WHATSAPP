import {createHash} from 'node:crypto';
import {publicWaCopyCatalog,publicWaCopyDefaults} from './public-wa-copy.js';

const reserved=new Set(['whatsapp','cubamax','panel','editor','studio','api','start','menu','login','acceso','web','health','favicon','asociado','vincular','portal-media','reset']);
const photoPattern=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
const defaults=publicWaCopyDefaults;
const maxCodeLength=256; // Límite técnico para URLs y cookies, no un formato obligatorio.
const viewerRegex=/^[A-Za-z0-9_-]{43}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');

export class PublicWhatsAppLinks {
  constructor(store){
    this.store=store;
    this.db=store.db;
    // These are new, independent records. No WhatsApp session, account,
    // consent, existing referral or old associated-link table is migrated.
    this.db.exec(`CREATE TABLE IF NOT EXISTS wa_public_links (
      code TEXT PRIMARY KEY, actor TEXT NOT NULL, photo TEXT NOT NULL,
      created INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS wa_public_links_actor ON wa_public_links(actor,created DESC);
    CREATE TABLE IF NOT EXISTS wa_public_first_visits (
      code TEXT PRIMARY KEY, viewer_hash TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_public_link_accounts (
      code TEXT NOT NULL, account TEXT NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY(code,account)
    );
    CREATE INDEX IF NOT EXISTS wa_public_link_accounts_account ON wa_public_link_accounts(account);`);
  }
  texts(){
    let saved={};try{saved=JSON.parse(this.store.config().wa_public_link_texts||'{}');}catch{}
    if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
    const values={...defaults};
    for(const [name,meta] of Object.entries(publicWaCopyCatalog)){
      if(typeof saved[name]==='string'&&saved[name].trim()&&saved[name].length<=meta.max)
       values[name]=saved[name].trim();
    }
    return values;
  }
  updateText(field,value){
    if(!Object.hasOwn(publicWaCopyCatalog,field)||typeof value!=='string'||!value.trim()||
       value.length>publicWaCopyCatalog[field].max)throw Error('Texto no válido.');
    const data={...this.texts(),[field]:value.trim()};
    this.store.setConfig('wa_public_link_texts',JSON.stringify(data));return data;
  }
  sourcePhoto(){
    const specified=this.store.config().wa_public_link_popup_photo;
    if(photoPattern.test(specified||''))return specified;
    // Reuse the already configured WhatsApp photo without changing that
    // popup, its settings or the Cubamax version.
    let welcome={};try{welcome=JSON.parse(this.store.config().wa_welcome_popup||'{}');}catch{}
    return photoPattern.test(welcome?.photo||'')?welcome.photo:'';
  }
  setSourcePhoto(value){
    if(typeof value!=='string'||(value&&!photoPattern.test(value)))throw Error('Debes seleccionar una foto del editor de WhatsApp.');
    this.store.setConfig('wa_public_link_popup_photo',value);
  }
  normalize(code){
    const value=String(code||'').normalize('NFKC').trim().toLowerCase();
    if(!value||value.length>maxCodeLength||/[\u0000-\u001f\u007f]/.test(value))
      throw Error('Escribe el código que quieras, incluso si contiene solo números.');
    if(value==='.'||value==='..'||reserved.has(value))throw Error('Ese código corresponde a una página existente. Elige otro.');
    return value;
  }
  url(code){return 'https://securitywhat.app/'+encodeURIComponent(this.normalize(code));}
  record(code){if(typeof code!=='string'||!code||code.length>maxCodeLength)return null;return this.db.prepare('SELECT rowid AS link_id,* FROM wa_public_links WHERE code=?').get(code)||null;}
  byId(id){if(!/^[1-9][0-9]{0,15}$/.test(String(id||'')))return null;return this.db.prepare('SELECT rowid AS link_id,* FROM wa_public_links WHERE rowid=?').get(Number(id))||null;}
  activeId(id){const row=this.byId(id);return row?.enabled?row:null;}
  callbackRef(code){const row=this.record(code);return row?'~'+row.link_id:String(code);}
  ownedRef(actor,ref){const row=String(ref).startsWith('~')?this.byId(String(ref).slice(1)):this.record(String(ref));return row?.actor===String(actor)?row:null;}
  active(code){const row=this.record(code);return row?.enabled?row:null;}
  owned(actor,code){const row=this.record(code);return row?.actor===String(actor)?row:null;}
  create(actor,code,photo){
    actor=String(actor);
    if(!/^\d{2,22}$/.test(actor))throw Error('Cuenta de Telegram no válida.');
    code=this.normalize(code);
    if(!photoPattern.test(photo||''))throw Error('Primero debes configurar la foto del popup WhatsApp.');
    if(this.record(code))throw Error('Ese código ya existe. Elige otro.');
    // No apropiarse de enlaces numéricos antiguos ni códigos de invitación.
    if(/^\d+$/.test(code)){
      const existing=this.db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'wa_associated_links\'').get();
      if(existing&&this.db.prepare('SELECT 1 FROM wa_associated_links WHERE phone=?').get(code))throw Error('Ese código ya corresponde a un enlace existente. Elige otro.');
      const short=this.db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'panel_referral_short\'').get();
      if(short&&code.length<=15&&this.db.prepare('SELECT 1 FROM panel_referral_short WHERE id=?').get(Number(code)))throw Error('Ese código ya corresponde a un enlace existente. Elige otro.');
    }
    if(this.db.prepare('SELECT count(*) n FROM wa_public_links WHERE actor=? AND enabled=1').get(actor).n>=100)
      throw Error('Has alcanzado el máximo de 100 enlaces activos.');
    this.db.prepare('INSERT INTO wa_public_links(code,actor,photo,created,enabled) VALUES(?,?,?,?,1)').run(code,actor,photo,Date.now());
    return this.record(code);
  }
  list(actor,offset=0){
    const n=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
    return this.db.prepare('SELECT rowid AS link_id,code,actor,created,enabled FROM wa_public_links WHERE actor=? ORDER BY created DESC LIMIT 12 OFFSET ?').all(String(actor),n);
  }
  summary(actor,offset=0,limit=5){
    const who=String(actor),start=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
    const size=Math.max(1,Math.min(8,Math.floor(Number(limit)||5)));
    const total=this.db.prepare('SELECT count(*) AS n FROM wa_public_links WHERE actor=?').get(who).n;
    const rows=this.db.prepare(`SELECT l.rowid AS link_id,l.code,l.enabled,l.created,
      (SELECT count(DISTINCT p.account) FROM wa_public_link_accounts p
       JOIN accounts a ON a.id=p.account
       WHERE p.code=l.code AND a.consent=1 AND a.confirmed=1 AND a.linked=1
         AND a.status NOT IN ('archived','revoked')) AS linked_accounts
      FROM wa_public_links l WHERE l.actor=?
      ORDER BY l.created DESC,l.rowid DESC LIMIT ? OFFSET ?`).all(who,size,start);
    return {total,rows};
  }
  accounts(actor,code){
    if(!this.owned(actor,code))throw Error('Enlace no disponible.');
    return this.db.prepare(`SELECT a.phone,a.status,a.confirmed,p.created
      FROM wa_public_link_accounts p JOIN accounts a ON a.id=p.account
      WHERE p.code=? ORDER BY p.created DESC LIMIT 50`).all(code);
  }
  revoke(actor,code){
    if(!this.owned(actor,code))throw Error('No puedes revocar ese enlace.');
    return this.db.prepare('UPDATE wa_public_links SET enabled=0 WHERE code=? AND actor=?').run(code,String(actor)).changes>0;
  }
  delete(actor,code){
    if(!this.owned(actor,code))throw Error('No puedes eliminar ese enlace.');
    this.db.prepare('DELETE FROM wa_public_first_visits WHERE code=?').run(code);
    this.db.prepare('DELETE FROM wa_public_link_accounts WHERE code=?').run(code);
    this.db.prepare('DELETE FROM wa_public_links WHERE code=? AND actor=?').run(code,String(actor));
    return true;
  }
  adminUsers(){
    return this.db.prepare(`SELECT actor,count(*) links,
     sum(enabled) active, max(created) latest
     FROM wa_public_links GROUP BY actor ORDER BY latest DESC LIMIT 200`).all();
  }
  adminDeleteActor(actor){
    actor=String(actor);
    const rows=this.db.prepare('SELECT code FROM wa_public_links WHERE actor=?').all(actor);
    for(const row of rows){
      this.db.prepare('DELETE FROM wa_public_first_visits WHERE code=?').run(row.code);
      this.db.prepare('DELETE FROM wa_public_link_accounts WHERE code=?').run(row.code);
    }
    this.db.prepare('DELETE FROM wa_public_links WHERE actor=?').run(actor);
    return rows.length; // Never disconnects or deletes an existing WhatsApp account.
  }
  claimFirst(code,viewer){
    const row=this.active(code);
    if(!row||!viewerRegex.test(viewer||''))return null;
    const viewerHash=hash(viewer);
    this.db.prepare('INSERT OR IGNORE INTO wa_public_first_visits(code,viewer_hash,created) VALUES(?,?,?)').run(code,viewerHash,Date.now());
    const winner=this.db.prepare('SELECT viewer_hash FROM wa_public_first_visits WHERE code=?').get(code);
    return winner?.viewer_hash===viewerHash?{kind:'photo',photo:row.photo}:null;
  }
  attach(code,account){
    const link=this.active(code),wa=this.store.account(account);
    if(!link||!wa||!wa.consent||wa.created<link.created||wa.status==='archived'||wa.status==='revoked')return false;
    // A public link may assign only a new, previously unowned account.
    // Preserve all legacy referral owners; never transfer access silently.
    const owner=this.db.prepare('SELECT actor FROM panel_owners WHERE account=?').get(account);
    if(owner&&owner.actor!==link.actor)return false;
    const existing=this.db.prepare('SELECT l.actor FROM wa_public_link_accounts p JOIN wa_public_links l ON l.code=p.code WHERE p.account=? AND l.actor<>? LIMIT 1').get(account,link.actor);
    if(existing)return false;
    this.db.prepare('INSERT OR IGNORE INTO panel_owners(account,actor,created) VALUES(?,?,?)').run(account,link.actor,Date.now());
    this.db.prepare('INSERT OR IGNORE INTO wa_public_link_accounts(code,account,created) VALUES(?,?,?)').run(code,account,Date.now());
    return true;
  }
}
