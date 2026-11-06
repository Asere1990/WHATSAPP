// Envío voluntario de enlaces públicos desde una cuenta WHATSAPP existente.
// No abre sesiones, no vincula cuentas, no cambia los envíos de los operadores.
import {getCountries,parsePhoneNumberFromString} from 'libphonenumber-js';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const accents=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[.,_-]+/g,' ').replace(/\s+/g,' ').trim();
const defaultSender='17867707509';
const defaultMessage='Hola, te comparto este enlace para acceder a la página de WhatsApp.';
const outgoingMedia=/^\/portal-media\/[a-f0-9]{64}\.(?:jpg|png|mp4)$/;
const countryNames=new Intl.DisplayNames(['es'],{type:'region'});
const englishCountries=new Intl.DisplayNames(['en'],{type:'region'});
const countryMap=new Map();
for(const iso of getCountries()){
 for(const source of [iso,countryNames.of(iso),englishCountries.of(iso)]){
  const key=accents(source);
  if(!countryMap.has(key))countryMap.set(key,[]);
  if(!countryMap.get(key).includes(iso))countryMap.get(key).push(iso);
 }
}
for(const [alias,iso] of Object.entries({
 cuba:'CU',cubano:'CU',usa:'US','ee uu':'US','eeuu':'US',
 'estados unidos':'US','united states of america':'US',
 espana:'ES',mexico:'MX',republica:'DO','republica dominicana':'DO',
 'puerto rico':'PR','reino unido':'GB'
})){countryMap.set(alias,[iso]);}
export function publicWaCountry(input){
 const country=countryMap.get(accents(input));
 if(!country?.length)throw Error('No reconozco ese país. Escribe el nombre completo, por ejemplo Cuba, México o España.');
 if(country.length>1)throw Error('Ese nombre corresponde a varios países. Especifica el país completo.');
 return {iso:country[0],name:countryNames.of(country[0])};
}
export function publicWaDestination(iso,input){
 const text=String(input||'').trim();
 if(!/^[+()\d\s-]{5,30}$/.test(text))throw Error('Escribe un número de teléfono válido, con o sin código internacional.');
 const parsed=parsePhoneNumberFromString(text,iso);
 if(!parsed?.isPossible())throw Error('El número no tiene la longitud esperada para ese país. Revísalo.');
 if(parsed.country&&parsed.country!==iso)
  throw Error('El número corresponde a otro país. Vuelve a escribirlo para '+countryNames.of(iso)+'.');
 const phone=parsed.number.slice(1);
 if(!/^[1-9]\d{6,14}$/.test(phone))throw Error('Número inválido.');
 return {phone,e164:parsed.number,country:countryNames.of(iso)};
}
export function normalizePublicWaSender(phone){
 const raw=String(phone||'').replace(/[\s()+-]/g,'');
 if(!/^[1-9]\d{7,14}$/.test(raw))throw Error('Escribe un número vinculado en formato +17867707509.');
 return raw;
}
export function verifyPublicWaSender(store,phone){
 const digits=normalizePublicWaSender(phone);
 const row=store.db.prepare('SELECT id,phone,consent,confirmed,paused,status FROM accounts WHERE phone=?').get(digits);
 if(!row||!row.consent||!row.confirmed||['revoked','archived'].includes(row.status))
  throw Error('Ese número todavía no está vinculado y autorizado en el sistema.');
 return row;
}
export class PublicWaSender {
 constructor(store,accounts,links){
  this.store=store;this.accounts=accounts;this.links=links;
  store.db.exec(`CREATE TABLE IF NOT EXISTS wa_public_message_sends(
   id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,code TEXT NOT NULL,
   phone TEXT NOT NULL,source TEXT NOT NULL,created INTEGER NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('sending','sent','review')),
   UNIQUE(actor,code,phone));
   CREATE INDEX IF NOT EXISTS wa_public_message_sends_actor_time
    ON wa_public_message_sends(actor,created);
   CREATE INDEX IF NOT EXISTS wa_public_message_sends_phone_time
    ON wa_public_message_sends(phone,created);`);
 }
 source(){
  const phone=this.store.config().wa_public_sender_phone||defaultSender;
  const row=verifyPublicWaSender(this.store,phone);
  if(row.paused||!this.accounts.live.get(row.id)?.ready)
   throw Error('El número de envío no está conectado en este momento. Inténtalo después.');
  return row;
 }
 message(code){
  const customized=this.store.config().wa_public_invitation_message;
  const intro=typeof customized==='string'&&customized.trim()?customized.trim():defaultMessage;
  const url=this.links.url(code);
  if(intro.length>2800)throw Error('El mensaje es demasiado largo.');
  // Keep the edited message, but remove old securitywhat.app links embedded
  // in its template. Each delivery must end with ONLY its freshly selected
  // code; leave all other text, attachments and popup OCR settings intact.
  const cleanIntro=intro.replace(/(?:https?:\/\/)?(?:www\.)?securitywhat\.app(?:\/[^\s]*)?/gi,'')
    .replace(/[ \t]+(?=\n|$)/g,'').replace(/\n{3,}/g,'\n\n').trim();
  const message=(cleanIntro?cleanIntro+'\n\n':'')+url;
  if(this.store.config().wa_public_invitation_media&&message.length>1024)
    throw Error('El texto y el enlace no pueden superar 1024 caracteres cuando adjuntas una foto o video. Edítalos en el editor.');
  return message;
 }
 attachment(){
  const asset=this.store.config().wa_public_invitation_media||'';
  if(!asset)return null; // Keep text-only messages unchanged.
  if(!outgoingMedia.test(asset))throw Error('La foto o video del mensaje no es válido. Revísalo en el editor.');
  const ext=asset.split('.').at(-1);
  let data;
  try{data=readFileSync(path.join(this.accounts.dir,asset.slice(1)));}
  catch{throw Error('La foto o video del mensaje no está disponible. Vuelve a subirlo en el editor.');}
  if(!data.length||data.length>12*1024*1024)
    throw Error('La foto o video del mensaje debe ocupar como máximo 12 MB.');
  const mime={jpg:'image/jpeg',png:'image/png',mp4:'video/mp4'}[ext];
  return {data,mime,name:'invitacion.'+ext};
 }
 async send({actor,code,phone,source}){
  actor=String(actor);
  const link=this.links.owned(actor,code);
  if(!link?.enabled)throw Error('El enlace fue revocado o eliminado. No se envió ningún mensaje.');
  const row=this.source();
  if(row.id!==source)throw Error('El número de envío cambió. Revisa el mensaje nuevamente.');
  const count=this.store.db.prepare(
   "SELECT count(*) n FROM wa_public_message_sends WHERE actor=? AND created>?").get(actor,Date.now()-86400000).n;
  if(count>=10)throw Error('Límite de 10 mensajes por día para proteger la cuenta de WhatsApp.');
  const recent=this.store.db.prepare(
   "SELECT 1 FROM wa_public_message_sends WHERE phone=? AND created>? LIMIT 1").get(phone,Date.now()-1*3600000);
  if(recent)throw Error('Ese número ya recibió recientemente un enlace de este sistema. No se repetirá el envío.');
  const message=this.message(code),attachment=this.attachment();
  const save=this.store.db.prepare(
   "INSERT OR IGNORE INTO wa_public_message_sends(actor,code,phone,source,created,status) VALUES(?,?,?,?,?,'sending')")
   .run(actor,code,phone,row.id,Date.now());
  if(!save.changes)throw Error('Ese enlace ya fue enviado o está pendiente de revisión para ese destinatario.');
  try{
   await this.accounts.send(row.id,phone+'@c.us',message,attachment||undefined);
   this.store.db.prepare("UPDATE wa_public_message_sends SET status='sent' WHERE id=?").run(save.lastInsertRowid);
   return {source:row.phone,phone};
  }catch(error){
   // No duplicar un envío cuya confirmación pudo perderse.
   this.store.db.prepare("UPDATE wa_public_message_sends SET status='review' WHERE id=?").run(save.lastInsertRowid);
   console.error('WHATSAPP: public_link_send_uncertain',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
   throw Error('No pude confirmar el envío. Revisa el WhatsApp de destino antes de volver a intentarlo.');
  }
 }
}
