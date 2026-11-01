import {readFileSync} from 'node:fs';
import {pbkdf2Sync,createHash,timingSafeEqual} from 'node:crypto';

export const WEB_PASSWORD_ROUNDS=310000;
const idPattern=/^[1-9][0-9]{4,19}$/;
const hashPattern=/^pbkdf2_sha256\$310000\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

function readText(file){
 try{return readFileSync(file,'utf8');}
 catch(error){if(error.code==='ENOENT')return '';throw error;}
}
// Only lines "telegram_id,pbkdf2_sha256$310000$salt$hash" allow password login.
// Existing bare IDs and comments keep working for Telegram.
export function parsedCredentialLines(text){
 const result=new Map();
 for(const raw of String(text||'').split(/\r?\n/)){
  const line=raw.split('#')[0].trim();
  if(!line||!line.includes(','))continue;
  const separator=line.indexOf(','),id=line.slice(0,separator).trim();
  const encoded=line.slice(separator+1).trim();
  if(idPattern.test(id)&&hashPattern.test(encoded))result.set(id,encoded);
 }
 return result;
}
export function credentialFor(actor,role,operatorFile){
 const id=String(actor||'');
 if(!idPattern.test(id)||!['admin','operator'].includes(role))return null;
 const paths=role==='admin'?['admins.txt']:['permisos.txt',operatorFile].filter(Boolean);
 for(const file of new Set(paths)){
  const encoded=parsedCredentialLines(readText(file)).get(id);
  if(encoded)return encoded;
 }
 return null;
}
export function credentialFingerprint(encoded){
 return createHash('sha256').update(String(encoded||'')).digest('hex');
}
export function verifyWebPassword(password,encoded){
 if(typeof password!=='string'||password.length<8||password.length>256)return false;
 const match=hashPattern.exec(encoded||'');
 if(!match)return false;
 const actual=pbkdf2Sync(password,Buffer.from(match[1],'hex'),WEB_PASSWORD_ROUNDS,32,'sha256');
 return timingSafeEqual(actual,Buffer.from(match[2],'hex'));
}
