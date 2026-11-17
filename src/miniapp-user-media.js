// Fotos y vistas previas de las cuatro tarjetas de la Mini App.
// Todo vive en UNA clave de configuración para actualizarse atómicamente.
export const userMiniappMediaSlots=Object.freeze([
  Object.freeze({key:'whatsappBackground',name:'WhatsApp · Fondo de la tarjeta grande',site:'wa',kind:'background'}),
  Object.freeze({key:'whatsappIcon',name:'WhatsApp · Foto del icono izquierdo',site:'wa',kind:'icon'}),
  Object.freeze({key:'cubamaxBackground',name:'Cubamax · Fondo de la tarjeta grande',site:'cm',kind:'background'}),
  Object.freeze({key:'cubamaxIcon',name:'Cubamax · Foto del icono izquierdo',site:'cm',kind:'icon'})
]);
const configKey='miniapp_user_media';
const pathPattern=/^\/portal-media\/[a-f0-9]{64}\.(?:jpg|png|gif|webp)$/;
const slotNames=new Set(userMiniappMediaSlots.map(slot=>slot.key));
function stored(store){
  let raw={};
  try{raw=JSON.parse(store?.config?.()?.[configKey]||'{}');}catch{}
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
}
export function validMiniappPreview(value){
  if(typeof value!=='string'||value.length>8000)return false;
  const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)return false;
  const bytes=Buffer.from(match[1],'base64');
  return bytes.length>=8&&bytes.length<=4500&&
    bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&
    bytes.toString('base64')===match[1];
}
export function userMiniappMedia(store){
  const raw=stored(store);
  return Object.fromEntries(userMiniappMediaSlots.map(slot=>{
    const item=raw[slot.key];
    // Compatible with previously saved string-only paths.
    const path=typeof item==='string'?item:item?.path;
    return [slot.key,typeof path==='string'&&pathPattern.test(path)?path:''];
  }));
}
export function userMiniappPreviews(store){
  const raw=stored(store),media=userMiniappMedia(store);
  return Object.fromEntries(userMiniappMediaSlots.map(slot=>{
    const item=raw[slot.key];
    const preview=typeof item==='object'&&item!==null?item.preview:'';
    return [slot.key,media[slot.key]&&validMiniappPreview(preview)?preview:''];
  }));
}
export function setUserMiniappMedia(store,key,asset,preview=''){
  if(!slotNames.has(key))throw Error('Elemento visual no disponible.');
  if(typeof asset!=='string'||asset&&!pathPattern.test(asset))throw Error('Formato de imagen inválido.');
  if(preview&&!validMiniappPreview(preview))throw Error('Vista previa inválida.');
  const raw=stored(store);
  // One SQLite configuration write guarantees path + its exact tiny preview.
  if(asset)raw[key]={path:asset,preview:preview||''};
  else delete raw[key];
  store.setConfig(configKey,JSON.stringify(raw));
  return userMiniappMedia(store);
}
