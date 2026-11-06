// Administración de usuarios que han creado enlaces públicos.
// Los bloqueos afectan al acceso del usuario y sus enlaces, nunca a sesiones WhatsApp.
const validId=id=>/^[1-9][0-9]{4,19}$/.test(String(id||''));
const phonePattern=/^\+?[1-9]\d{6,14}$/;
const sqlAccounts=`(
 SELECT p.account,l.actor FROM wa_public_link_accounts p
 JOIN wa_public_links l ON l.code=p.code
 UNION
 SELECT p.account,l.actor FROM cm_public_link_accounts p
 JOIN cm_public_links l ON l.code=p.code
)`;
const accountFilter="a.consent=1 AND a.confirmed=1 AND a.linked=1 AND a.status NOT IN ('archived','revoked')";

export class PublicAssociatedUsers {
 constructor(bot){
  this.bot=bot;this.store=bot.store;this.db=bot.store.db;
  // Store only identity supplied to the bot by Telegram, or contact shared by
  // the person themselves. Existing users without prior metadata stay unnamed.
  this.db.exec(`CREATE TABLE IF NOT EXISTS wa_public_actor_profiles(
   actor TEXT PRIMARY KEY,
   name TEXT NOT NULL DEFAULT '',
   username TEXT NOT NULL DEFAULT '',
   telegram_phone TEXT NOT NULL DEFAULT '',
   last_seen INTEGER NOT NULL DEFAULT 0,
   banned INTEGER NOT NULL DEFAULT 0
  );`);
 }
 remember(actor,contact){
  const id=String(actor?.id||'');
  if(!validId(id))return;
  const name=[actor.first_name,actor.last_name].filter(Boolean).join(' ').trim().slice(0,150);
  const username=String(actor.username||'').replace(/^@/,'').slice(0,80);
  const volunteered=String(contact?.user_id)===id&&phonePattern.test(String(contact.phone_number||''))
   ?String(contact.phone_number).replace(/^\+/,''):'';
  this.db.prepare(`INSERT INTO wa_public_actor_profiles(actor,name,username,telegram_phone,last_seen)
   VALUES(?,?,?,?,?)
   ON CONFLICT(actor) DO UPDATE SET
     name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE wa_public_actor_profiles.name END,
     username=excluded.username,
     telegram_phone=CASE WHEN excluded.telegram_phone<>'' THEN excluded.telegram_phone ELSE wa_public_actor_profiles.telegram_phone END,
     last_seen=excluded.last_seen`).run(id,name,username,volunteered,Date.now());
 }
 isBanned(actor){
  if(!validId(actor))return false;
  return !!this.db.prepare('SELECT banned FROM wa_public_actor_profiles WHERE actor=?').get(String(actor))?.banned;
 }
 summary(actor){
  actor=String(actor);
  if(!validId(actor))return null;
  const profile=this.db.prepare('SELECT name,username,telegram_phone,last_seen,banned FROM wa_public_actor_profiles WHERE actor=?').get(actor)||{};
  const wa=this.db.prepare('SELECT count(*) total,sum(enabled=1) active FROM wa_public_links WHERE actor=?').get(actor);
  const cm=this.db.prepare('SELECT count(*) total,sum(enabled=1) active FROM cm_public_links WHERE actor=?').get(actor);
  const accounts=this.db.prepare(`SELECT DISTINCT a.phone FROM ${sqlAccounts} linked
   JOIN accounts a ON a.id=linked.account WHERE linked.actor=? AND ${accountFilter}
   ORDER BY a.phone LIMIT 30`).all(actor).map(x=>x.phone);
  const total=Number(wa?.total||0)+Number(cm?.total||0);
  return {actor,name:profile.name||'',username:profile.username||'',
   telegram_phone:profile.telegram_phone||'',banned:!!profile.banned,
   links:total,active:Number(wa?.active||0)+Number(cm?.active||0),
   wa:Number(wa?.total||0),cm:Number(cm?.total||0),
   linked_accounts:accounts.length,phones:accounts};
 }
 page(offset=0,limit=8){
  const from=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
  const ids=this.db.prepare(`SELECT actor,MAX(created) AS recent FROM (
    SELECT actor,created FROM wa_public_links
    UNION ALL SELECT actor,created FROM cm_public_links
    UNION ALL SELECT actor,last_seen AS created FROM wa_public_actor_profiles WHERE banned=1
   ) GROUP BY actor ORDER BY recent DESC,actor DESC LIMIT ? OFFSET ?`).all(limit,from);
  const total=this.db.prepare(`SELECT count(*) total FROM (
    SELECT actor FROM wa_public_links
    UNION SELECT actor FROM cm_public_links
    UNION SELECT actor FROM wa_public_actor_profiles WHERE banned=1
   )`).get().total;
  return {total,rows:ids.map(x=>this.summary(x.actor)),offset:from};
 }
 changeAll(actor,active){
  actor=String(actor);
  if(!validId(actor))throw Error('Telegram ID inválido.');
  if(active&&this.isBanned(actor))throw Error('Primero debes desbanear al usuario.');
  const wa=this.db.prepare('UPDATE wa_public_links SET enabled=? WHERE actor=? AND enabled<>?')
   .run(active?1:0,actor,active?1:0).changes;
  const cm=this.db.prepare('UPDATE cm_public_links SET enabled=? WHERE actor=? AND enabled<>?')
   .run(active?1:0,actor,active?1:0).changes;
  return wa+cm;
 }
 ban(actor){
  actor=String(actor);
  if(!validId(actor))throw Error('Telegram ID inválido.');
  if(this.bot.admins().has(actor))throw Error('No puedes banear a un administrador.');
  this.db.prepare(`INSERT INTO wa_public_actor_profiles(actor,banned,last_seen) VALUES(?,1,?)
   ON CONFLICT(actor) DO UPDATE SET banned=1`).run(actor,Date.now());
  return this.changeAll(actor,false);
 }
 unban(actor){
  actor=String(actor);
  if(!validId(actor))throw Error('Telegram ID inválido.');
  this.db.prepare('UPDATE wa_public_actor_profiles SET banned=0 WHERE actor=?').run(actor);
 }
 async list(chat,offset=0){
  const page=this.page(offset);
  const items=page.rows.map((u,i)=>{
   const who=u.username?'@'+u.username:u.name||'Nombre no disponible';
   const phone=u.telegram_phone?'\nTeléfono compartido: +'+u.telegram_phone:u.phones[0]?'\nTeléfono vinculado: +'+u.phones[0]:'';
   return (page.offset+i+1)+'. '+who+'\nTelegram ID: '+u.actor+phone+
    '\nEnlaces: '+u.links+' ('+u.active+' activos) · Vinculaciones: '+u.linked_accounts+
    (u.banned?'\n🚫 BANEADO':'');
  });
  const numbers=page.rows.length?[page.rows.map((u,i)=>({
   text:String(page.offset+i+1),callback_data:'users:show:'+u.actor
  }))]:[];
  return this.bot.send(chat,'👥 USUARIOS ASOCIADOS\n'+page.total+' usuarios\n\n'+
   (items.join('\n\n')||'Nadie ha creado enlaces todavía.')+
   '\n\nSelecciona un número para administrar al usuario.',{inline_keyboard:[
    ...numbers,
    ...(page.offset>0?[[{text:'◀ ANTERIOR',callback_data:'users:list:'+Math.max(0,page.offset-8)}]]:[]),
    ...(page.offset+page.rows.length<page.total?[[{text:'SIGUIENTE ▶',callback_data:'users:list:'+(page.offset+8)}]]:[]),
    [{text:'ATRÁS AL MENÚ',callback_data:'users:menu'}]
   ]});
 }
 async show(chat,actor){
  const u=this.summary(actor);
  if(!u||(!u.links&&!u.banned))return this.bot.send(chat,'Usuario sin enlaces públicos registrados.');
  const phones=u.phones.length?u.phones.map((p,i)=>(i+1)+'. +'+p).join('\n'):'Sin teléfonos vinculados confirmados';
  return this.bot.send(chat,'👤 USUARIO ASOCIADO\n\nTelegram ID: '+u.actor+
   '\nNombre: '+(u.name||'No disponible')+
   '\nUsername: '+(u.username?'@'+u.username:'No disponible')+
   '\nTeléfono Telegram: '+(u.telegram_phone?'+'+u.telegram_phone:'No compartido')+
   '\n\nEnlaces creados (existentes): '+u.links+
   '\nWhatsApp: '+u.wa+' · Cubamax: '+u.cm+
   '\nEnlaces activos: '+u.active+
   '\nVinculaciones confirmadas: '+u.linked_accounts+
   '\nTeléfonos vinculados:\n'+phones+
   '\n\nEstado: '+(u.banned?'🚫 BANEADO':'✅ AUTORIZADO')+
   '\n\nRevocar enlaces o banear NO desconecta ninguna cuenta.',{
   inline_keyboard:[
    [{text:'🚫 REVOCAR TODOS LOS ENLACES',callback_data:'users:revoke:'+actor}],
    [{text:'✅ REACTIVAR TODOS LOS ENLACES',callback_data:'users:activate:'+actor}],
    [{text:u.banned?'✅ DESBANEAR TELEGRAM ID':'⛔ BANEAR TELEGRAM ID',
      callback_data:'users:'+(u.banned?'unban':'ban')+':'+actor}],
    [{text:'👥 VOLVER A USUARIOS',callback_data:'users:list:0'}]
   ]});
 }
 async callback(chat,data){
  if(!this.bot.admins().has(String(chat)))return;
  const parts=String(data||'').split(':'),verb=parts[1],id=parts[2]||'';
  if(verb==='menu')return this.bot.control.home(chat,chat);
  if(verb==='list')return this.list(chat,Number(id)||0);
  if(!validId(id))return this.bot.send(chat,'Telegram ID inválido.');
  const current=this.summary(id);
  if(!current||(!current.links&&!current.banned))return this.bot.send(chat,'Usuario no encontrado.');
  if(verb==='show')return this.show(chat,id);
  if(['revoke','activate','ban','unban'].includes(verb)){
   return this.bot.send(chat,'¿Confirmas '+({
    revoke:'revocar todos los enlaces',activate:'reactivar todos los enlaces',
    ban:'banear el Telegram ID y revocar sus enlaces',unban:'desbanear el Telegram ID'
   }[verb])+' de '+id+'?\n\nNo se desconectará ninguna cuenta.',{
    inline_keyboard:[
     [{text:'SÍ, CONFIRMAR',callback_data:'users:confirm-'+verb+':'+id}],
     [{text:'CANCELAR',callback_data:'users:show:'+id}]
    ]});
  }
  if(verb==='confirm-revoke')this.changeAll(id,false);
  else if(verb==='confirm-activate')this.changeAll(id,true);
  else if(verb==='confirm-ban')this.ban(id);
  else if(verb==='confirm-unban')this.unban(id);
  else return this.bot.send(chat,'Acción no disponible.');
  return this.show(chat,id);
 }
}
