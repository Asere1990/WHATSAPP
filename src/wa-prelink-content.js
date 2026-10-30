import {guides} from './guides.js';

// WhatsApp's pre-code popup has its own editable copy and step data.
// The existing Cubamax guide settings are never written by these helpers.
export const waPopupDefaults=Object.freeze({
 heading:'Antes de obtener tu código',
 introduction:'Repasa cómo vincular tu cuenta antes de continuar.',
 prompt:'¿Qué teléfono utilizas?',
 choose:'Escoge tu dispositivo para comenzar el tutorial.',
 android:'ANDROID',iphone:'IPHONE',back:'ATRÁS',next:'SIGUIENTE →',
 confirm:'ENTENDIDO',close:'Cerrar tutorial'
});
export function waPopupCopy(store){
 let saved={};try{saved=JSON.parse(store.config().wa_prelink_copy||'{}');}catch{}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
 return Object.fromEntries(Object.entries(waPopupDefaults).map(([key,initial])=>[key,typeof saved[key]==='string'&&saved[key].trim()&&saved[key].length<=4000?saved[key]:initial]));
}
const validAsset=value=>!value||/^\/(?:guide|portal)-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|mp4)$/.test(value)||/^\/guides\/(?:android|iphone)-(?:prepare|open|linked|number|approve)\.svg$/.test(value)||/^\/guides\/(?:android|iphone)-2026\/step-[1-5]\.gif$/.test(value);
function validSteps(steps){
 if(!Array.isArray(steps)||steps.length<1||steps.length>10)return false;
 const seen=new Set();
 for(const step of steps){
  if(!step||typeof step!=='object'||typeof step.id!=='string'||!/^[a-z0-9]{1,16}$/.test(step.id)||seen.has(step.id))return false;
  seen.add(step.id);
  if(typeof step.title!=='string'||!step.title.trim()||step.title.length>80||typeof step.text!=='string'||!step.text.trim()||step.text.length>1000||!validAsset(step.asset))return false;
 }
 return true;
}
export function waPopupGuides(store,device){
 if(!['android','iphone'].includes(device))throw Error('Dispositivo inválido.');
 const raw=store.config()['wa_prelink_guide_'+device];
 if(raw)try{const steps=JSON.parse(raw);if(validSteps(steps))return steps;}catch{}
 return guides(store,device).map(step=>({...step}));
}
