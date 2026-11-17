// Multimedia opcional de las dos tarjetas públicas de la Mini App.
// Esta configuración solo cambia la apariencia; no toca enlaces, cuentas,
// los editores web existentes ni los callbacks de Telegram.
export const userMiniappMediaSlots=Object.freeze([
  Object.freeze({key:'whatsappBackground',name:'WhatsApp · Fondo de la tarjeta grande',site:'wa',kind:'background'}),
  Object.freeze({key:'whatsappIcon',name:'WhatsApp · Foto del icono izquierdo',site:'wa',kind:'icon'}),
  Object.freeze({key:'cubamaxBackground',name:'Cubamax · Fondo de la tarjeta grande',site:'cm',kind:'background'}),
  Object.freeze({key:'cubamaxIcon',name:'Cubamax · Foto del icono izquierdo',site:'cm',kind:'icon'})
]);
const configKey='miniapp_user_media';
const mediaPattern=/^\/portal-media\/[a-f0-9]{64}\.(?:jpg|png|gif|webp)$/;
export function userMiniappMedia(store){
  let raw={};
  try{raw=JSON.parse(store?.config?.()?.[configKey]||'{}');}catch{}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(userMiniappMediaSlots.map(slot=>[
    slot.key,typeof raw[slot.key]==='string'&&mediaPattern.test(raw[slot.key])?raw[slot.key]:''
  ]));
}
export function setUserMiniappMedia(store,key,asset){
  if(!userMiniappMediaSlots.some(slot=>slot.key===key))throw Error('Elemento visual no disponible.');
  if(typeof asset!=='string'||asset&& !mediaPattern.test(asset))throw Error('Formato de imagen inválido.');
  const old=userMiniappMedia(store);
  if(asset)old[key]=asset;
  else delete old[key]; // Restaurar el fondo o icono original sin borrar archivos.
  store.setConfig(configKey,JSON.stringify(old));
  return userMiniappMedia(store);
}


// Vista preliminar diminuta del MISMO fondo/icono configurado.
// Se guarda en la configuración pública para que la tarjeta muestre los colores
// finales en el primer fotograma sin esperar una imagen de hasta 2 MB.
const previewKey='miniapp_user_previews';
export function validMiniappPreview(value){
  if(typeof value!=='string'||value.length>8000)return false;
  const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)return false;
  const b=Buffer.from(match[1],'base64');
  return b.length>=8&&b.length<=4500&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff&&
    b.toString('base64')===match[1];
}
export function userMiniappPreviews(store){
  let raw={};
  try{raw=JSON.parse(store?.config?.()?.[previewKey]||'{}');}catch{}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const media=userMiniappMedia(store);
  return Object.fromEntries(userMiniappMediaSlots.map(slot=>[
    slot.key,media[slot.key]&&validMiniappPreview(raw[slot.key])?raw[slot.key]:''
  ]));
}
export function setUserMiniappPreview(store,key,value){
  if(!userMiniappMediaSlots.some(slot=>slot.key===key))throw Error('Elemento visual inválido.');
  if(value&&!validMiniappPreview(value))throw Error('Vista previa inválida.');
  const raw=userMiniappPreviews(store);
  if(value)raw[key]=value;
  else delete raw[key];
  store.setConfig(previewKey,JSON.stringify(raw));
  return userMiniappPreviews(store);
}
