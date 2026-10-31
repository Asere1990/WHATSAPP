import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export const welcomeDefaults={title:'Antes de comenzar',text:'Este servicio es independiente de WhatsApp y Meta. Consulta la información y continúa cuando estés listo.',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''};
export function welcomeContent(store){let saved={};try{saved=JSON.parse(store.config().wa_welcome_popup||'{}');}catch{}return {...welcomeDefaults,...saved};}
// This cookie can only hide the welcome popup. It is never an account session.
export function welcomeIdentity(store){let secret=store.config().wa_welcome_secret;if(!secret){secret=randomBytes(32).toString('hex');store.setConfig('wa_welcome_secret',secret);}const sign=id=>createHmac('sha256',secret).update(id).digest('hex');return {
 issue:id=>{const value=Buffer.from(String(id)).toString('base64url');return value+'.'+sign(value);},
 read:token=>{if(typeof token!=='string'||token.length>300)return null;const [value,signature]=token.split('.');if(!value||!signature||!/^[a-f0-9]{64}$/.test(signature))return null;const expected=sign(value);if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;return Buffer.from(value,'base64url').toString();}
};}
