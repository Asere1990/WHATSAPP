// Independent public Cubamax links; no popup photo or WhatsApp message sending.
export class PublicCubamaxLinks {
  constructor(store,waLinks){
    this.store=store;this.db=store.db;this.waLinks=waLinks;
    this.db.exec(`CREATE TABLE IF NOT EXISTS cm_public_links (
      code TEXT PRIMARY KEY, actor TEXT NOT NULL,
      created INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS cm_public_links_actor ON cm_public_links(actor,created DESC);
    CREATE TABLE IF NOT EXISTS cm_public_link_accounts (
      code TEXT NOT NULL, account TEXT NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY(code,account)
    );
    CREATE INDEX IF NOT EXISTS cm_public_link_accounts_account ON cm_public_link_accounts(account);`);
  }
  normalize(raw){
    const code=this.waLinks.normalize(raw);
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(code))
      throw Error('Para Cubamax utiliza entre 1 y 64 letras, números, guiones o guiones bajos.');
    // Numeric paths 5–15 digits are reserved for existing and future referrals.
    if(/^\d{5,15}$/.test(code))
      throw Error('Ese formato numérico está reservado para enlaces existentes. Añade una letra al código.');
    return code;
  }
  url(code){return 'https://cubamaxcom.online/'+encodeURIComponent(this.normalize(code));}
  record(code){
    if(typeof code!=='string'||!code||code.length>64)return null;
    return this.db.prepare('SELECT rowid AS link_id,* FROM cm_public_links WHERE code=?').get(code)||null;
  }
  byId(id){
    if(!/^[1-9][0-9]{0,15}$/.test(String(id||'')))return null;
    return this.db.prepare('SELECT rowid AS link_id,* FROM cm_public_links WHERE rowid=?').get(Number(id))||null;
  }
  activeId(id){const row=this.byId(id);return row?.enabled?row:null;}
  owned(actor,code){const row=this.record(code);return row?.actor===String(actor)?row:null;}
  ownedRef(actor,ref){
    const row=String(ref).startsWith('~')?this.byId(String(ref).slice(1)):this.record(String(ref));
    return row?.actor===String(actor)?row:null;
  }
  create(actor,raw){
    actor=String(actor);
    if(!/^[1-9][0-9]{4,19}$/.test(actor))throw Error('Cuenta de Telegram no válida.');
    const code=this.normalize(raw);
    if(this.record(code))throw Error('Ese código ya se está utilizando. Elige otro.');
    if(this.db.prepare('SELECT count(*) AS n FROM cm_public_links WHERE actor=? AND enabled=1').get(actor).n>=100)
      throw Error('Has alcanzado el máximo de 100 enlaces Cubamax activos.');
    this.db.prepare('INSERT INTO cm_public_links(code,actor,created,enabled) VALUES(?,?,?,1)')
      .run(code,actor,Date.now());
    return this.record(code);
  }
  accounts(actor,code){
    if(!this.owned(actor,code))throw Error('Enlace no disponible.');
    return this.db.prepare(`SELECT a.phone,a.status,a.confirmed,p.created
      FROM cm_public_link_accounts p JOIN accounts a ON a.id=p.account
      WHERE p.code=? ORDER BY p.created DESC LIMIT 50`).all(code);
  }
  revoke(actor,code){
    if(!this.owned(actor,code))throw Error('No puedes revocar ese enlace.');
    return this.db.prepare('UPDATE cm_public_links SET enabled=0 WHERE actor=? AND code=?')
      .run(String(actor),code).changes>0;
  }
  delete(actor,code){
    if(!this.owned(actor,code))throw Error('No puedes eliminar ese enlace.');
    this.db.prepare('DELETE FROM cm_public_link_accounts WHERE code=?').run(code);
    this.db.prepare('DELETE FROM cm_public_links WHERE actor=? AND code=?').run(String(actor),code);
    return true; // Never disconnect or delete linked accounts.
  }
  attach(code,account){
    const link=this.record(code),wa=this.store.account(account);
    if(!link?.enabled||!wa?.consent||wa.created<link.created||
      wa.status==='archived'||wa.status==='revoked')return false;
    // Explicit consent and previously unowned accounts only.
    const owner=this.db.prepare('SELECT actor FROM panel_owners WHERE account=?').get(account);
    if(owner&&owner.actor!==link.actor)return false;
    const other=this.db.prepare(`SELECT l.actor FROM cm_public_link_accounts p
      JOIN cm_public_links l ON l.code=p.code
      WHERE p.account=? AND l.actor<>? LIMIT 1`).get(account,link.actor);
    if(other)return false;
    const waOwner=this.db.prepare(`SELECT l.actor FROM wa_public_link_accounts p
      JOIN wa_public_links l ON l.code=p.code
      WHERE p.account=? AND l.actor<>? LIMIT 1`).get(account,link.actor);
    if(waOwner)return false;
    this.db.prepare('INSERT OR IGNORE INTO panel_owners(account,actor,created) VALUES(?,?,?)')
      .run(account,link.actor,Date.now());
    this.db.prepare('INSERT OR IGNORE INTO cm_public_link_accounts(code,account,created) VALUES(?,?,?)')
      .run(code,account,Date.now());
    return true;
  }
}
