import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {detectMedia} from './guides.js';
export const pageCatalog=JSON.parse(readFileSync(new URL('./page-catalog.json',import.meta.url),'utf8'));
const groups={tutorial:'📖 TUTORIAL ANTES DEL CÓDIGO',countries:'🌎 MENÚ DE PAÍSES',texts:'📝 TEXTOS GENERALES',buttons:'🔘 BOTONES Y MENÚS',connection:'📱 CONEXIÓN Y GUÍAS',messages:'💬 AVISOS Y MENSAJES',labels:'🏷 RECUADROS Y ETIQUETAS',images:'🖼 FOTOS Y SLIDERS'};
export function pageValues(store,site){if(!pageCatalog[site])throw Error('Página no disponible.');try{return JSON.parse(store.config()['page_'+site]||'{}');}catch{return {};}}
export function pageContent(store,site){const values=pageValues(store,site);return Object.entries(pageCatalog[site]).filter(([key])=>typeof values[key]==='string').map(([key,item])=>({source:item.text,value:values[key],kind:item.kind}));}
export async function savePageImage(bot,m){
 const file=m.photo?.at(-1)||m.document;if(!file)throw Error('Envía una foto o archivo PNG/JPG/WebP/GIF.');
 if(file.file_size>2*1024*1024)throw Error('Imagen máxima: 2 MB.');
 const data=await bot.download(file.file_id);if(data.length>2*1024*1024)throw Error('Imagen máxima: 2 MB.');
 const media=detectMedia(data);if(media.ext==='mp4')throw Error('Envía una imagen PNG/JPG/WebP/GIF.');
 const name=createHash('sha256').update(data).digest('hex')+'.'+media.ext,folder=path.join(bot.accounts.dir,'portal-media');mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(path.join(folder,name),data,{mode:0o600});return '/portal-media/'+name;
}
export class PageEditor{
 constructor(bot){this.bot=bot;}
 async callback(chat,key,data){
  const [,site,action,id,pageRaw]=data.split(':');if(!pageCatalog[site])throw Error('Página no disponible.');
  const back={text:'ATRÁS',callback_data:site==='cm'?'cm':'design'};
  if(!action)return this.bot.send(chat,'WHATSAPP · EDITAR PÁGINA\nElige qué quieres editar.',{inline_keyboard:[...Object.entries(groups).map(([id,label])=>[{text:label,callback_data:`pg:${site}:group:${id}:0`}]),[{text:'🏷 LOGO',callback_data:'edit:logo'},{text:'📱 GUÍAS ANDROID / IPHONE',callback_data:'guide'}],[{text:'TÍTULO PRINCIPAL',callback_data:'edit:title'},{text:'DESCRIPCIÓN PRINCIPAL',callback_data:'edit:description'}],[{text:'BOTÓN PRINCIPAL',callback_data:'edit:button'},{text:'COLOR PRINCIPAL',callback_data:'edit:color'}],[back]]});
  if(action==='group'){
   if(!groups[id])throw Error('Categoría no disponible.');const entries=Object.entries(pageCatalog[site]).filter(([,f])=>f.group===id),page=Math.max(0,Math.min(Number(pageRaw)||0,Math.max(0,Math.ceil(entries.length/10)-1)));
   const rows=entries.slice(page*10,page*10+10).map(([field,f],i)=>[{text:`${page*10+i+1}. ${f.label}`,callback_data:`pg:${site}:field:${field}`}]);
   if(site==='cm'&&id==='tutorial')rows.push([{text:'📱 PASOS Y FOTOS ANDROID / IPHONE',callback_data:'guide'},{text:'📱 TEXTOS DE NAVEGACIÓN',callback_data:'pg:cm:group:connection:0'}]);
   const nav=[];if(page)nav.push({text:'← ANTERIOR',callback_data:`pg:${site}:group:${id}:${page-1}`});if((page+1)*10<entries.length)nav.push({text:'SIGUIENTE →',callback_data:`pg:${site}:group:${id}:${page+1}`});if(nav.length)rows.push(nav);
   rows.push([{text:'ATRÁS',callback_data:site==='cm'?'cm':'pg:wa'}]);return this.bot.send(chat,`${groups[id]} · ${page+1}/${Math.max(1,Math.ceil(entries.length/10))}\nSelecciona un elemento.`,{inline_keyboard:rows});
  }
  const field=pageCatalog[site][id];if(!field)throw Error('Elemento no disponible.');
  if(action==='reset'){const values=pageValues(this.bot.store,site);delete values[id];this.bot.store.setConfig('page_'+site,JSON.stringify(values));return this.bot.send(chat,'✅ Restablecido.',{inline_keyboard:[[{text:'ATRÁS',callback_data:`pg:${site}:group:${field.group}:0`}]]});}
  if(action==='field'){
   this.bot.pending.set(key,{kind:'page',site,field:id});return this.bot.send(chat,`${field.label}\n\nActual: ${pageValues(this.bot.store,site)[id]||field.text}\n\n${field.kind==='image'?'Envía la foto nueva (hasta 2 MB).':'Envía el texto nuevo (hasta 4000 caracteres).'}\n/cancelar para salir.`,{inline_keyboard:[[{text:'RESTABLECER ORIGINAL',callback_data:`pg:${site}:reset:${id}`}],[{text:'ATRÁS',callback_data:`pg:${site}:group:${field.group}:0`}]]});
  }
  throw Error('Opción no disponible.');
 }
 async input(chat,pending,m){
  const field=pageCatalog[pending.site]?.[pending.field];if(!field)throw Error('Elemento no disponible.');
  const value=field.kind==='image'?await savePageImage(this.bot,m):m.text;
  if(typeof value!=='string'||!value.trim()||value.length>4000)throw Error('Envía un texto de 1 a 4000 caracteres.');
  const values=pageValues(this.bot.store,pending.site);values[pending.field]=value;this.bot.store.setConfig('page_'+pending.site,JSON.stringify(values));
  return this.bot.send(chat,'✅ Cambio guardado. Recarga la página para verlo.',{inline_keyboard:[[{text:'SEGUIR EDITANDO',callback_data:`pg:${pending.site}:group:${field.group}:0`}]]});
 }
}
