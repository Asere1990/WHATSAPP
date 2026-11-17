// Configuración independiente de la presentación de la mini app pública.
// Los IDs, callbacks y el flujo original de WhatsApp/Cubamax no son editables.
export const userMiniappFields=Object.freeze([
  {key:'whatsapp',name:'Tarjeta WhatsApp',fallback:'buttonWhatsApp',max:64},
  {key:'cubamax',name:'Tarjeta Cubamax',fallback:'buttonCubamax',max:64},
  {key:'choose',name:'Texto de elección',fallback:'choose',max:800},
  {key:'myLinksHeading',name:'Título Mis enlaces',fallback:'myLinksTitle',max:100},
  {key:'create',name:'Botón Crear enlace',fallback:'buttonCreate',max:64},
  {key:'empty',name:'Texto sin enlaces',fallback:'myLinksEmpty',max:240},
  {key:'active',name:'Etiqueta Activo',fallback:'activeStatus',max:64},
  {key:'revoked',name:'Etiqueta Revocado',fallback:'revokedStatus',max:64},
  {key:'accounts',name:'Botón Cuentas asociadas',fallback:'buttonAssociatedAccounts',max:64},
  {key:'back',name:'Botón Atrás',fallback:'buttonBack',max:64},
  {key:'cancel',name:'Botón Cancelar',fallback:'buttonCancel',max:64}
]);
const configKey='miniapp_user_labels';
export function userMiniappOverrides(store){
  let raw={};
  try{raw=JSON.parse(store.config()[configKey]||'{}');}catch{}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const allowed={};
  for(const field of userMiniappFields){
    const value=raw[field.key];
    if(typeof value==='string'&&value.trim()&&value.length<=field.max&&
       !/[\u0000-\u001f\u007f]/.test(value))allowed[field.key]=value;
  }
  return allowed;
}
export function userMiniappEditorData(store,publicTexts){
  const overrides=userMiniappOverrides(store);
  return userMiniappFields.map(field=>({
    key:field.key,name:field.name,max:field.max,
    value:overrides[field.key]||'',
    original:String(publicTexts[field.fallback]||''),
    effective:overrides[field.key]||String(publicTexts[field.fallback]||'')
  }));
}
export function updateUserMiniappLabel(store,key,value){
  const field=userMiniappFields.find(item=>item.key===key);
  if(!field)throw Error('Campo no disponible en Editor Usuarios.');
  if(typeof value!=='string'||value.length>field.max||/[\u0000-\u001f\u007f]/.test(value))
    throw Error('Texto inválido o demasiado largo.');
  const values=userMiniappOverrides(store);
  if(value.trim())values[key]=value.trim();
  else delete values[key]; // Restaurar la etiqueta original sin cambiar el motor.
  store.setConfig(configKey,JSON.stringify(values));
  return values;
}
