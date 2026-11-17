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
