// Interpret only identity fields already delivered by WhatsApp.
// Never infer a phone number from a numeric LID or a profile picture.
const unavailable=/^(nombre no disponible|sin nombre|cuenta(?: de whatsapp)?|whatsapp|contacto(?: sin identificar)?|\+?[0-9\s().-]+)$/i;
export const usableContactName=value=>typeof value==='string'&&value.trim()&&!unavailable.test(value.trim());
export function normalizedPhone(value,allowBare=false){
 if(typeof value!=='string')return null;
 const text=value.trim();
 const full=text.match(/^([0-9]{7,15})(?::[0-9]+)?@(s\.whatsapp\.net|c\.us)$/);
 if(full)return full[1]+'@s.whatsapp.net';
 // Bare digits are accepted only in an explicitly labelled phone field.
 if(allowBare&&/^\+?[0-9]{7,15}$/.test(text))return text.replace(/^\+/,'')+'@s.whatsapp.net';
 return null;
}
export function normalizedLid(value,allowBare=false){
 if(typeof value!=='string')return null;
 const text=value.trim(),full=text.match(/^([0-9]+)(?::[0-9]+)?@lid$/);
 if(full)return full[1]+'@lid';
 return allowBare&&/^[0-9]+$/.test(text)?text+'@lid':null;
}
export function receivedContactMetadata(kind,id,value){
 const result={mapping:null,name:null};
 if(kind==='mapping'){
  const lid=normalizedLid(id),pn=normalizedPhone(value,true);
  if(lid&&pn)result.mapping={lid,pn};
  return result;
 }
 if(!['chat','contact'].includes(kind)||!value||typeof value!=='object'||Array.isArray(value))return result;
 const peer=normalizedLid(id)||normalizedPhone(id)||(/^\d+@g\.us$/.test(String(id))?String(id):null);
 if(!peer)return result;
 if(!peer.endsWith('@g.us')){
  const lid=normalizedLid(id)||[value.lid,value.lidJid,value.accountLid].map(v=>normalizedLid(v,true)).find(Boolean);
  const pn=normalizedPhone(id)||[value.phoneNumber,value.pnJid].map(v=>normalizedPhone(v,true)).find(Boolean);
  if(lid&&pn)result.mapping={lid,pn};
 }
 const fields=peer.endsWith('@g.us')?[value.subject,value.name,value.displayName]:
  [value.name,value.displayName,value.notify,value.verifiedName,value.username];
 const name=fields.find(usableContactName);
 if(name){
  const t=Number(value.conversationTimestamp||value.timestamp||0);
  result.name={peer,name:name.trim().slice(0,120),timestamp:Number.isSafeInteger(t)&&t>=0?t:0};
 }
 return result;
}
export function acceptedContactMapping(pair,existing,selfJids=[]){
 if(!pair||normalizedLid(pair.lid)!==pair.lid||normalizedPhone(pair.pn)!==pair.pn)return false;
 const own=new Set(selfJids);
 // A record about somebody else must never join the authenticated own chat.
 if((own.has(pair.lid)||own.has(pair.pn))&&!(own.has(pair.lid)&&own.has(pair.pn)))return false;
 const old=normalizedPhone(existing,true);
 // Conflicting valid associations require investigation, not an arbitrary merge.
 return !old||old===pair.pn;
}
