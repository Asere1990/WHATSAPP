import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {validatePopupLayers} from './popup-ocr.js';
export const welcomeDefaults={title:'Antes de comenzar',text:'Este servicio es independiente de WhatsApp y Meta. Consulta la información y continúa cuando estés listo.',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''};
export function welcomeContent(store){
 let saved={};
 try{saved=JSON.parse(store.config().wa_welcome_popup||'{}');}catch{}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
 const result={...welcomeDefaults,...saved};
 // Preserve the exact legacy snapshot when OCR has never been configured.
 // Existing associated-link popups continue to override the welcome content.
 if(Object.hasOwn(saved,'layers')){
  let layers;try{layers=validatePopupLayers(saved.layers);}catch{layers=[];}
  // Never paint text from a previous image when an admin replaces the photo
  // from the separate ALERT builder or another existing editor workflow.
  result.layers=layers.filter(layer=>layer.source===result.photo);
 }
 return result;
}
// This cookie can only hide the welcome popup. It is never an account session.
export function welcomeIdentity(store){let secret=store.config().wa_welcome_secret;if(!secret){secret=randomBytes(32).toString('hex');store.setConfig('wa_welcome_secret',secret);}const sign=id=>createHmac('sha256',secret).update(id).digest('hex');return {
 issue:id=>{const value=Buffer.from(String(id)).toString('base64url');return value+'.'+sign(value);},
 read:token=>{if(typeof token!=='string'||token.length>300)return null;const [value,signature]=token.split('.');if(!value||!signature||!/^[a-f0-9]{64}$/.test(signature))return null;const expected=sign(value);if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;return Buffer.from(value,'base64url').toString();}
};}
