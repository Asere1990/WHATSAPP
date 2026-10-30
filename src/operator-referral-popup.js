// Independent, informational popup for referral links created by permisos.txt.
// This never changes associated-link first-visitor behavior or connection consent.
export const operatorPopupDefaults=Object.freeze({
  title:'Antes de continuar',
  text:'Este servicio es independiente de WhatsApp y Meta. Si decides vincular tu cuenta, el usuario autorizado que compartió este enlace y los administradores podrán gestionar tus conversaciones y archivos. Puedes revocar el acceso desde WhatsApp.',
  button:'ENTENDIDO',
  color:'#128c7e',
  photo:''
});
const key='wa_operator_referral_popup';
const photoPath=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
const textLimits={title:100,text:1000,button:65};
const color=/^#[a-f0-9]{6}$/i;

export function operatorPopupContent(store){
  let saved={};
  try{saved=JSON.parse(store.config()[key]||'{}');}catch{}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
  const result={...operatorPopupDefaults};
  for(const [field,max] of Object.entries(textLimits))
    if(typeof saved[field]==='string'&&saved[field].trim()&&saved[field].length<=max)
      result[field]=saved[field].trim();
  if(typeof saved.photo==='string'&&photoPath.test(saved.photo))result.photo=saved.photo;
  if(typeof saved.color==='string'&&color.test(saved.color))result.color=saved.color;
  return result;
}

export function updateOperatorPopup(store,field,value){
  if(field==='photo'&&value===''){} // Removing a photo preserves the rest.
  else if(field==='color'){
    if(typeof value!=='string'||!color.test(value))throw Error('Envía un color hexadecimal como #128c7e.');
  }else if(field==='photo'){
    if(typeof value!=='string'||!photoPath.test(value))throw Error('Envía una foto PNG, JPG, GIF o WebP.');
  }else if(Object.hasOwn(textLimits,field)){
    if(typeof value!=='string'||!value.trim()||value.length>textLimits[field])
      throw Error('Este texto debe tener entre 1 y '+textLimits[field]+' caracteres.');
    value=value.trim();
  }else throw Error('Campo no editable.');
  const updated={...operatorPopupContent(store),[field]:value};
  store.setConfig(key,JSON.stringify(updated));
  return updated;
}

export function operatorPopupForReferral(store,reference,role,site){
  if(!reference||role!=='operator'||!['wa','cm'].includes(site)||reference.site!==site)return null;
  return operatorPopupContent(store);
}
