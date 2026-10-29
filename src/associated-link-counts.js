import {createHash} from 'node:crypto';

const GROUP='-1004461387155';
const ZONE='America/New_York';
const valid=/^[A-Za-z0-9_-]{43}$/;
const key=token=>createHash('sha256').update(token).digest('hex');
function dateKey(time){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).map(v=>[v.type,v.value]));return p.year+'-'+p.month+'-'+p.day;}
function clock(time){return new Intl.DateTimeFormat('es-ES',{timeZone:ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(time));}

// Per-link counters contain no personal visitor identifiers, IPs or location data.
export class AssociatedLinkCounts{
 constructor(store,{now=()=>Date.now()}={}){
  this.db=store.db;this.now=now;
  this.db.exec('CREATE TABLE IF NOT EXISTS wa_associated_link_daily(link_hash TEXT NOT NULL,day TEXT NOT NULL,opens INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(link_hash,day));');
 }
 record(token,assignedPhone){
  if(!valid.test(token||'')||!/^[1-9][0-9]{7,14}$/.test(assignedPhone||''))return null;
  const time=this.now(),day=dateKey(time),h=key(token);
  const row=this.db.prepare('INSERT INTO wa_associated_link_daily(link_hash,day,opens) VALUES(?,?,1) ON CONFLICT(link_hash,day) DO UPDATE SET opens=opens+1 RETURNING opens').get(h,day);
  const total=this.db.prepare('SELECT COALESCE(SUM(opens),0) AS n FROM wa_associated_link_daily WHERE link_hash=?').get(h).n;
  return {phone:assignedPhone,today:row.opens,total,time};
 }
 totals(token){
  if(!valid.test(token||''))return {today:0,total:0};
  const h=key(token);
  return {today:this.db.prepare('SELECT opens FROM wa_associated_link_daily WHERE link_hash=? AND day=?').get(h,dateKey(this.now()))?.opens||0,total:this.db.prepare('SELECT COALESCE(SUM(opens),0) AS n FROM wa_associated_link_daily WHERE link_hash=?').get(h).n};
 }
 message(e){return [
  '🔗 ENLACE ASOCIADO ABIERTO',
  '📱 Número asignado al enlace: +'+e.phone,
  '📊 Aperturas hoy: '+e.today,
  '📈 Aperturas acumuladas: '+e.total,
  '🕒 Fecha y hora (Nueva York): '+clock(e.time),
  'ℹ️ El número identifica el enlace asignado, no a la persona que lo abrió.'
 ].join('\n');}
 notify(telegram,e){return telegram.send(GROUP,this.message(e));}
}
