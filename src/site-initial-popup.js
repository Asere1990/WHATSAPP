// Cubamax's optional welcome popup is isolated from WhatsApp's existing
// wa_welcome_popup, referral alerts and associated-link behavior.
export const cmPopupDefaults=Object.freeze({
 enabled:false,title:'Antes de comenzar',
 text:'Consulta esta información y continúa cuando estés listo.',
 button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''
});
const color=value=>/^#[0-9a-f]{6}$/i.test(value||'');
const photo=value=>/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(value||'');
export function cmPopupContent(store){
 let input={};
 try{input=JSON.parse(store.config().cm_initial_popup||'{}');}catch{}
 if(!input||typeof input!=='object'||Array.isArray(input))input={};
 const result={...cmPopupDefaults};
 result.enabled=input.enabled===true||input.enabled==='on';
 for(const [key,max] of [['title',120],['text',4000],['button',80]]){
  if(typeof input[key]==='string'&&input[key].trim()&&input[key].length<=max)
   result[key]=input[key].trim();
 }
 for(const key of ['color','textColor'])if(color(input[key]))result[key]=input[key];
 if(photo(input.photo))result.photo=input.photo;
 return result;
}
