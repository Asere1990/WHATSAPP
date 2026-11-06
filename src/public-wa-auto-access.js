// Public WhatsApp links: permission only after an associated account really
// connected. This file never reads, replaces or restarts WhatsApp credentials.
const validActor=value=>/^[1-9][0-9]{4,19}$/.test(String(value||''));
const qualified=`a.consent=1 AND a.confirmed=1 AND
 a.status NOT IN ('archived','revoked')`;

// Both sites count equally, but only confirmed, consenting accounts grant access.
const publicAssociations=`(
 SELECT p.account,l.actor,p.created FROM wa_public_link_accounts p
 JOIN wa_public_links l ON l.code=p.code
 UNION ALL
 SELECT p.account,l.actor,p.created FROM cm_public_link_accounts p
 JOIN cm_public_links l ON l.code=p.code
)`;

export class PublicWaAutomaticAccess {
 constructor(store,permissionFile){
  this.store=store;this.db=store.db;this.permissions=permissionFile;
  this.db.exec(`CREATE TABLE IF NOT EXISTS wa_public_auto_permissions(
   actor TEXT PRIMARY KEY,created INTEGER NOT NULL
  );`);
  this.check=this.db.prepare(`
    SELECT 1 FROM ${publicAssociations} links
    JOIN accounts a ON a.id=links.account
    JOIN panel_owners own ON own.account=a.id AND own.actor=links.actor
    WHERE links.actor=? AND ${qualified}
    LIMIT 1`);
  this.automaticCheck=this.db.prepare(
   'SELECT 1 FROM wa_public_auto_permissions WHERE actor=?');
 }
 automatic(actor){return !!this.automaticCheck.get(String(actor));}
 eligible(actor){return validActor(actor)&&!!this.check.get(String(actor));}
 // A previously auto-enrolled user cannot access the panel after losing the
 // last confirmed associated account. Existing manually granted operators are
 // not affected.
 filterPermissions(ids){
  const list=new Set(ids);
  for(const {actor} of this.db.prepare('SELECT actor FROM wa_public_auto_permissions').all()){
   if(!this.eligible(actor))list.delete(actor);
  }
  return list;
 }
 manual(ids){
  for(const actor of String(ids||'').split(/[\s,;]+/)){
   if(validActor(actor))this.db.prepare(
    'DELETE FROM wa_public_auto_permissions WHERE actor=?').run(actor);
  }
 }
 // Old associated-link records may predate automatic operator enrollment.
 // Assign an unowned account only when exactly ONE public-link actor is tied
 // to it; never overwrite ownership from legacy referrals or other users.
 reconcileOwners(){
  const rows=this.db.prepare(`
    SELECT links.account,MIN(links.actor) actor,MIN(links.created) created
    FROM ${publicAssociations} links
    JOIN accounts a ON a.id=links.account
    WHERE ${qualified}
    GROUP BY links.account
    HAVING COUNT(DISTINCT links.actor)=1
  `).all();
  const insert=this.db.prepare(
   'INSERT OR IGNORE INTO panel_owners(account,actor,created) VALUES(?,?,?)');
  for(const row of rows)if(validActor(row.actor))
   insert.run(row.account,row.actor,row.created);
 }
 sync(){
  if(!this.db||!this.permissions)return 0;
  this.reconcileOwners();
  const actors=this.db.prepare(`
    SELECT DISTINCT links.actor FROM ${publicAssociations} links
    JOIN accounts a ON a.id=links.account
    JOIN panel_owners own ON own.account=a.id AND own.actor=links.actor
    WHERE ${qualified}
  `).all();
  let added=0;
  for(const {actor} of actors){
   if(!validActor(actor)||!this.eligible(actor))continue;
   const already=this.permissions.read().has(actor);
   if(already)continue; // Never turn a preexisting manual user into auto-only.
   const result=this.permissions.add(actor);
   if(result.added.includes(actor)){
    this.db.prepare('INSERT OR IGNORE INTO wa_public_auto_permissions(actor,created) VALUES(?,?)')
     .run(actor,Date.now());
    added++;
   }
  }
  return added;
 }
}
