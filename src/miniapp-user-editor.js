// Solo presentación y copias editables. No cambia permisos, enlaces ni callbacks.
import {publicWaCopyCatalog,publicWaCopyDefaults} from './public-wa-copy.js';

const field=(key,name,group,defaultText,max=150,fallback=null)=>Object.freeze({key,name,group,defaultText,max,fallback});
export const userMiniappFields=Object.freeze([
  field('headerTitle','Cabecera · Nombre de la mini app y botón del bot','Cabecera','MI ESPACIO',64),
  field('headerSubtitle','Cabecera · Subtítulo','Cabecera','WHATSAPP · CUBAMAX',100),
  field('telegramBadge','Cabecera · Indicador','Cabecera','Telegram',35),
  field('heroKicker','Inicio · Frase superior','Página principal','TUS HERRAMIENTAS',100),
  field('heroTitle','Inicio · Título grande','Página principal','Todo en un\nsolo lugar.',150),
  field('heroDescription','Inicio · Descripción','Página principal','Crea, comparte y administra tus enlaces desde aquí.',500),
  field('whatsapp','Tarjeta WhatsApp · Nombre','Página principal','WhatsApp',64,'buttonWhatsApp'),
  field('whatsappCaption','Tarjeta WhatsApp · Subtítulo','Página principal','Crear enlace',85),
  field('cubamax','Tarjeta Cubamax · Nombre','Página principal','Cubamax',64,'buttonCubamax'),
  field('cubamaxCaption','Tarjeta Cubamax · Subtítulo','Página principal','Crear enlace',85),
  field('choose','Inicio · Texto informativo','Página principal','Elige qué enlace deseas utilizar.',800,'choose'),
  field('homeLinksTitle','Inicio · Título de enlaces','Página principal','Mis enlaces',100),
  field('myLinksKicker','Mis enlaces · Frase superior','Mis enlaces','ADMINISTRACIÓN',100),
  field('myLinksHeading','Mis enlaces · Título','Mis enlaces','Mis enlaces',120,'myLinksTitle'),
  field('linksDescription','Mis enlaces · Descripción','Mis enlaces','Consulta, copia y revisa tus enlaces existentes.',400),
  field('create','Mis enlaces · Crear enlace','Mis enlaces','CREAR ENLACE',64,'buttonCreate'),
  field('moreLinks','Mis enlaces · Ver más','Mis enlaces','VER MÁS ENLACES',64),
  field('empty','Sin enlaces · Mensaje','Mis enlaces','No has creado enlaces todavía.',300,'myLinksEmpty'),
  field('active','Enlaces · Estado activo','Tarjetas de enlaces','ACTIVO',60,'activeStatus'),
  field('revoked','Enlaces · Estado revocado','Tarjetas de enlaces','REVOCADO',60,'revokedStatus'),
  field('accountSingle','Enlaces · Una cuenta vinculada','Tarjetas de enlaces','cuenta vinculada',80),
  field('accountPlural','Enlaces · Varias cuentas vinculadas','Tarjetas de enlaces','cuentas vinculadas',80),
  field('copyButton','Enlaces · Botón copiar','Tarjetas de enlaces','Copiar',64),
  field('reviewButton','Enlaces · Botón revisar','Tarjetas de enlaces','Revisar',64),
  field('deleteButton','Enlaces · Botón eliminar','Tarjetas de enlaces','Eliminar',64),
  field('mainMenuButton','Enlaces · Menú principal','Tarjetas de enlaces','MENÚ PRINCIPAL',64),
  field('accounts','Revisión · Cuentas asociadas','Tarjetas de enlaces','CUENTAS ASOCIADAS',64,'buttonAssociatedAccounts'),
  field('back','Botones · Atrás','Navegación','ATRÁS',64,'buttonBack'),
  field('cancel','Botones · Cancelar','Navegación','CANCELAR',64,'buttonCancel'),
  field('backHome','Flujo · Volver a inicio','Navegación','← Inicio',64),
  field('navHome','Barra inferior · Inicio','Navegación','Inicio',64),
  field('navLinks','Barra inferior · Mis enlaces','Navegación','Mis enlaces',64),
  field('footer','Texto al pie de la página','Navegación','Las funciones, los permisos y los textos se gestionan desde el mismo sistema de siempre.',500),
  field('inputWaCode','WhatsApp · Título pedir código','Formularios','Código de tu enlace',100),
  field('helpWaCode','WhatsApp · Ayuda pedir código','Formularios','Escribe el código que usarás para compartir el enlace.',350),
  field('inputCmCode','Cubamax · Título pedir código','Formularios','Código de Cubamax',100),
  field('helpCmCode','Cubamax · Ayuda pedir código','Formularios','Elige el código de tu enlace Cubamax.',350),
  field('inputCountry','Destino · Título país','Formularios','País del destinatario',100),
  field('helpCountry','Destino · Ayuda país','Formularios','Por ejemplo: Cuba, Estados Unidos, México o España.',350),
  field('inputPhone','Destino · Título teléfono','Formularios','Número del destinatario',100),
  field('helpPhone','Destino · Ayuda teléfono','Formularios','Introduce el número con o sin código internacional.',350),
  field('continueButton','Formulario · Continuar','Formularios','CONTINUAR',64),
  field('uploadTitle','Fotografía · Seleccionar','Formularios','Seleccionar fotografía',100),
  field('uploadHelp','Fotografía · Formatos y límite','Formularios','PNG, JPG, WebP o GIF · máximo 2 MB',150),
  field('uploadButton','Fotografía · Confirmar','Formularios','USAR ESTA FOTOGRAFÍA',64),
  field('socialHeading','Título del recuadro posterior al enlace','Textos posteriores a la creación','INGENIERÍA SOCIAL',100),
  field('socialWhatsapp','WhatsApp · Texto posterior al enlace','Textos posteriores a la creación',
    'Comparte el enlace solo con personas que aceptaron recibirlo. Explica claramente su propósito; no solicites códigos ni contraseñas.',1600),
  field('socialCubamax','Cubamax · Texto posterior al enlace','Textos posteriores a la creación',
    'Comparte el enlace solo con personas que aceptaron recibirlo e indica claramente qué página abrirán.',1600),
  field('linkReadyTitle','Enlace creado · Título de la tarjeta','Textos posteriores a la creación','ENLACE CREADO',100),
  field('copySuccess','Aviso · Copiado al portapapeles','Avisos','Enlace copiado al portapapeles.',200),
  field('copyFallback','Aviso · Copia manual','Avisos','Copia este enlace:',200),
  field('missingInput','Aviso · Falta escribir','Avisos','Escribe el dato solicitado.',200),
  field('missingPhoto','Aviso · Falta fotografía','Avisos','Selecciona una fotografía.',200),
  field('photoSize','Aviso · Fotografía muy grande','Avisos','La imagen no puede superar 2 MB.',200),
  field('photoFormat','Aviso · Formato de imagen','Avisos','Formato de imagen no permitido.',200),
  field('photoReadError','Aviso · Error lectura fotografía','Avisos','No se pudo leer la fotografía.',200),
  field('telegramOnly','Aviso · Abrir desde Telegram','Avisos','Para crear y administrar enlaces, abre esta mini app desde el bot de Telegram.',300),
  field('previewOnly','Aviso · Vista previa fuera de Telegram','Avisos','Vista preliminar. Para crear enlaces, entra desde la mini app registrada en tu bot de Telegram.',300)
]);
const configKey='miniapp_user_labels';
function fallback(field,publicTexts={}){
  return field.fallback?String(publicTexts[field.fallback]||field.defaultText):field.defaultText;
}
export function userMiniappOverrides(store){
  let raw={};
  try{raw=JSON.parse(store.config()[configKey]||'{}');}catch{}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const allowed={};
  for(const item of userMiniappFields){
    const v=raw[item.key];
    if(typeof v==='string'&&v.trim()&&v.length<=item.max&&!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v))
      allowed[item.key]=v;
  }
  return allowed;
}
export function userMiniappLabels(store,publicTexts={}){
  const values=userMiniappOverrides(store);
  return Object.fromEntries(userMiniappFields.map(item=>[item.key,values[item.key]||fallback(item,publicTexts)]));
}
export function userMiniappEditorData(store,publicTexts={}){
  const values=userMiniappOverrides(store);
  const screen=userMiniappFields.map(item=>({
    key:item.key,name:item.name,group:item.group,max:item.max,
    value:values[item.key]||'',
    original:fallback(item,publicTexts),
    effective:values[item.key]||fallback(item,publicTexts)
  }));
  // Los mensajes y botones del flujo reutilizan la misma configuración
  // editable del bot, no una copia que pudiera quedar desincronizada.
  const telegramMessages=Object.entries(publicWaCopyCatalog).map(([key,meta])=>({
    key:'flow:'+key,name:meta.label,group:'Mensajes del bot y de los enlaces',
    max:meta.max,value:String(publicTexts[key]||meta.value),
    original:String(publicWaCopyDefaults[key]||meta.value),
    effective:String(publicTexts[key]||meta.value),
    existingEditor:true
  }));
  return [...screen,...telegramMessages];
}
export function updateUserMiniappLabel(store,key,value){
  const item=userMiniappFields.find(entry=>entry.key===key);
  if(!item)throw Error('Campo no disponible en Editor Usuarios.');
  if(typeof value!=='string'||value.length>item.max||/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value))
    throw Error('Texto inválido o demasiado largo.');
  const data=userMiniappOverrides(store);
  if(value.trim())data[key]=value.trim();
  else delete data[key];
  store.setConfig(configKey,JSON.stringify(data));
  return data;
}
