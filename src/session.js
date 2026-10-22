import { lstatSync, readlinkSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
// A Render disk is attached to one instance. Only discard Chromium's process
// markers when their owner is from an earlier host or a dead local process.
// Cookies, IndexedDB and all WhatsApp authentication files remain untouched.
export function releaseStaleLock(folder,host=hostname(),alive=pid=>{
  try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}){
  let target;
  try{if(!lstatSync(path.join(folder,'SingletonLock')).isSymbolicLink())return false;target=readlinkSync(path.join(folder,'SingletonLock'));}catch(e){if(e.code==='ENOENT')return false;throw e;}
  const match=/^(.*)-([1-9][0-9]*)$/.exec(target);
  if(!match||(match[1]===host&&alive(Number(match[2]))))return false;
  for(const name of ['SingletonLock','SingletonCookie','SingletonSocket']){
    const file=path.join(folder,name);
    try{if(lstatSync(file).isSymbolicLink())unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return true;
}
export function connectionErrorCode(error){
  const message=String(error?.message||error||'');
  if(/Singleton|ProcessSingleton|profile.*(?:in use|another)|already running|user data directory.*in use/i.test(message))return 'PROFILE_LOCKED';
  if(/EACCES|Permission denied|operation not permitted/i.test(message))return 'PERMISSION_DENIED';
  if(/ENOSPC|No space left/i.test(message))return 'DISK_FULL';
  if(/Could not find Chrome|executable.*does not exist|browser.*not found/i.test(message))return 'BROWSER_MISSING';
  if(/Target closed|Session closed|browser.*disconnected/i.test(message))return 'BROWSER_CLOSED';
  if(/timeout|timed out/i.test(message))return 'INIT_TIMEOUT';
  return typeof error?.code==='string'&&/^[A-Z_0-9]{1,60}$/.test(error.code)?error.code:'INIT_FAILED';
}
export function connectionLabel(manager,a){
  if(manager.live.get(a.id)?.ready)return 'Conectada';
  if(manager.live.has(a.id))return 'Conectando / sincronizando';
  if(['needs_pairing','auth_failure'].includes(a.status))return 'Requiere vinculación';
  if(a.status==='error')return 'Error al iniciar la sesión';
  if(a.status==='expired')return 'La conexión no terminó de iniciar';
  return 'Desconectada';
}
