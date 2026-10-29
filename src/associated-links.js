import {randomBytes} from 'node:crypto';
import {phoneNumber} from './store.js';

const goodImage=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
const goodToken=/^[A-Za-z0-9_-]{43}$/;
const fresh=()=>randomBytes(32).toString('base64url');
export const associatedUrl=token=>'https://securitywhat.app/asociado/'+token;

// These are informational links, not account invitations or proof of phone ownership.
export class AssociatedLinks {
 constructor(store){
  this.store=store;
  store.db.exec("CREATE TABLE IF NOT EXISTS wa_associated_links(phone TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,kind TEXT NOT NULL DEFAULT 'none',content TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL,updated INTEGER NOT NULL);");
 }
 normalize(phone){return phoneNumber(phone);}
 validate(kind,value){
  if(kind==='text'){
   if(typeof value!=='string'||!value.trim()||value.trim().length>1000)throw Error('Escribe un texto entre 1 y 1000 caracteres.');
   return value.trim();
  }
  if(kind==='photo'){
   if(typeof value!=='string'||!goodImage.test(value))throw Error('Envía una foto válida.');
   return value;
  }
  throw Error('Selecciona un texto o una foto para el popup.');
 }
 get(phone){return this.store.db.prepare('SELECT * FROM wa_associated_links WHERE phone=?').get(this.normalize(phone))||null;}
 find(token){if(!goodToken.test(token||''))return null;return this.store.db.prepare('SELECT * FROM wa_associated_links WHERE token=? AND active=1').get(token)||null;}
 list(offset=0,limit=10){
  const n=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
  const cap=Math.max(1,Math.min(20,Math.floor(Number(limit)||10)));
  return {total:this.store.db.prepare('SELECT count(*) AS n FROM wa_associated_links').get().n,
   rows:this.store.db.prepare('SELECT * FROM wa_associated_links ORDER BY updated DESC,phone LIMIT ? OFFSET ?').all(cap,n)};
 }
 linked(phone){
  return !!this.store.db.prepare("SELECT 1 AS linked FROM accounts WHERE phone=? AND consent=1 AND linked=1 AND confirmed=1 AND status NOT IN ('revoked','archived')").get(this.normalize(phone));
 }
 save(phone,kind,value){
  phone=this.normalize(phone);value=this.validate(kind,value);
  const now=Date.now(),prior=this.get(phone);
  // Overwriting content on an active number preserves its permanent URL.
  // A previously revoked URL never becomes valid again.
  const token=prior?.active?prior.token:fresh();
  this.store.db.prepare("INSERT INTO wa_associated_links(phone,token,kind,content,active,created,updated) VALUES(?,?,?,?,1,?,?) ON CONFLICT(phone) DO UPDATE SET token=excluded.token,kind=excluded.kind,content=excluded.content,active=1,updated=excluded.updated").run(phone,token,kind,value,prior?.created||now,now);
  return this.get(phone);
 }
 clear(phone){
  phone=this.normalize(phone);return this.store.db.prepare("UPDATE wa_associated_links SET kind='none',content='',updated=? WHERE phone=?").run(Date.now(),phone).changes>0;
 }
 revoke(phone){
  phone=this.normalize(phone);return this.store.db.prepare("UPDATE wa_associated_links SET active=0,updated=? WHERE phone=? AND active=1").run(Date.now(),phone).changes>0;
 }
 renew(phone){
  phone=this.normalize(phone);const previous=this.get(phone);
  if(!previous)throw Error('No hay enlace asociado para ese número.');
  // Rotating invalidates the old URL, regardless of current popup content.
  this.store.db.prepare('UPDATE wa_associated_links SET token=?,active=1,updated=? WHERE phone=?').run(fresh(),Date.now(),phone);
  return this.get(phone);
 }
 popup(token){
  const row=this.find(token);
  if(!row||row.kind==='none'||this.linked(row.phone))return null;
  // Only the content is returned to the browser, never the phone or owner.
  return row.kind==='photo'?{kind:'photo',photo:row.content}:{kind:'text',text:row.content};
 }
}
