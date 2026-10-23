import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, rmSync, statfsSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
export const devices=['android','iphone'];
export const mediaPath=/^\/guide-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/;
const ids=['prepare','open','linked','number','approve'];
export function defaultGuide(device){
  if(!devices.includes(device))throw new Error('Dispositivo inválido.');
  if(device==='iphone')return [
    {id:'open',title:'Abre WhatsApp y toca Tú',text:'Primero obtén tu código en esta página. Después abre WhatsApp en tu iPhone y toca Tú, abajo a la derecha. Las capturas muestran una cuenta de ejemplo.',asset:'/guides/iphone-2026/step-1.gif'},
    {id:'linked',title:'Entra a Dispositivos vinculados',text:'En la sección Tú (Configuración), toca Dispositivos vinculados, como indica la flecha roja.',asset:'/guides/iphone-2026/step-2.gif'},
    {id:'device',title:'Pulsa Vincular un dispositivo',text:'Toca el botón verde Vincular un dispositivo. Si WhatsApp solicita Face ID o desbloquear el iPhone, confírmalo dentro de la aplicación.',asset:'/guides/iphone-2026/step-3.gif'},
    {id:'number',title:'Elige vincular con número',text:'Si aparece un aviso, toca OK. Luego toca Vincular con el número de teléfono, abajo en la pantalla del escáner. No necesitas escanear un QR.',asset:'/guides/iphone-2026/step-4.gif'},
    {id:'approve',title:'Introduce el código en WhatsApp',text:'Copia el código actual que aparece en nuestra página e introdúcelo en los ocho espacios dentro de WhatsApp. Confirma únicamente el dispositivo que autorizas. Vuelve a esta página para comprobar la conexión.',asset:'/guides/iphone-2026/step-5.gif'}
  ];
  const titles=['Obtén tu código','Abre WhatsApp','Vincula un dispositivo','Elige vincular con número','Introduce el código en WhatsApp'];
  const texts=[
    'En esta página, escribe tu número completo y acepta la autorización si estás de acuerdo. Pulsa Obtener código. No recibirás un SMS: el código aparecerá aquí.',
    device==='android'?'Abre WhatsApp en tu teléfono principal. En la pantalla de chats, pulsa el menú de los tres puntos (⋮).':'Abre WhatsApp en tu iPhone principal y entra a Configuración.',
    'Entra a Dispositivos vinculados y pulsa Vincular un dispositivo. Si aparece una notificación de vinculación, también puedes abrirla para continuar.',
    'Pulsa Vincular con número de teléfono en lugar de escanear el QR. Si WhatsApp pide desbloquear el teléfono, hazlo dentro de la aplicación.',
    'Copia el código que aparece en esta página e introdúcelo dentro de WhatsApp. Revisa el dispositivo solicitado y confirma solo si corresponde al gestor que autorizas. Vuelve a esta página para comprobar la conexión.'
  ];
  return ids.map((id,i)=>({id,title:titles[i],text:texts[i],asset:`/guides/${device}-${id}.svg`}));
}
export function guides(store,device){
  if(!devices.includes(device))throw new Error('Dispositivo inválido.');
  const raw=store.config()[`guide_${device}`];
  if(raw)try{const steps=JSON.parse(raw);validateSteps(steps);return steps;}catch{}
  return defaultGuide(device);
}
function validateSteps(steps){
  if(!Array.isArray(steps)||steps.length<1||steps.length>10)throw new Error('La guía admite entre 1 y 10 pasos.');
  const seen=new Set();
  for(const s of steps){
    if(!/^[a-z0-9]{1,16}$/.test(s.id)||seen.has(s.id))throw new Error('Paso inválido.');seen.add(s.id);
    if(typeof s.title!=='string'||!s.title.trim()||s.title.length>80||typeof s.text!=='string'||!s.text.trim()||s.text.length>1000)throw new Error('Título: hasta 80 caracteres. Instrucciones: hasta 1000.');
    if(s.asset&&!mediaPath.test(s.asset)&&!/^\/guides\/iphone-2026\/step-[1-5]\.gif$/.test(s.asset)&&!/^\/guides\/(android|iphone)-(prepare|open|linked|number|approve)\.svg$/.test(s.asset))throw new Error('Imagen no válida.');
  }
}
export function saveGuide(store,device,steps){if(!devices.includes(device))throw new Error('Dispositivo inválido.');validateSteps(steps);store.setConfig(`guide_${device}`,JSON.stringify(steps));}
export function detectMedia(data){
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext:'png',mime:'image/png'};
  if(data[0]===255&&data[1]===216&&data[2]===255)return {ext:'jpg',mime:'image/jpeg'};
  if(['GIF87a','GIF89a'].includes(data.subarray(0,6).toString()))return {ext:'gif',mime:'image/gif'};
  if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return {ext:'webp',mime:'image/webp'};
  if(data.subarray(4,8).toString()==='ftyp')return {ext:'mp4',mime:'video/mp4'};
  throw new Error('Envía una imagen PNG/JPG/WebP, un GIF o una animación MP4.');
}
export function cleanupGuideMedia(store,dir){
  const folder=path.join(dir,'guide-media');if(!existsSync(folder))return;
  const used=new Set(devices.flatMap(d=>guides(store,d).map(s=>s.asset)));
  for(const name of readdirSync(folder)){
    if(!/^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(name))continue;
    const file=path.join(folder,name);
    if(!used.has('/guide-media/'+name)&&statSync(file).mtimeMs<Date.now()-86400000)rmSync(file,{force:true});
  }
}
export class GuideEditor {
  constructor(bot){this.bot=bot;}
  async menu(chat,device){
    if(!device)return this.bot.send(chat,'GUÍAS DE VINCULACIÓN · Elige el teléfono.',{inline_keyboard:[[{text:'ANDROID',callback_data:'guide:android'},{text:'IPHONE',callback_data:'guide:iphone'}],[{text:'ATRÁS',callback_data:'design'}]]});
    const steps=guides(this.bot.store,device),rows=steps.map((s,i)=>[{text:`${i+1}. ${s.title.slice(0,45)}`,callback_data:`guide:${device}:${s.id}`}]);
    rows.push([{text:'➕ AÑADIR PASO',callback_data:`guide:${device}:new:add`}],[{text:'VER WEB',url:this.bot.config.url},{text:'ATRÁS',callback_data:'guide'}]);
    return this.bot.send(chat,`${device.toUpperCase()} · ${steps.length} pasos\nSelecciona un paso para editarlo. Los cambios se guardan sin reiniciar el servicio.`,{inline_keyboard:rows});
  }
  async callback(chat,key,data){
    const [,device,id,action]=data.split(':');if(!device)return this.menu(chat);if(!devices.includes(device))throw new Error('Guía inválida.');
    if(!id)return this.menu(chat,device);
    const steps=guides(this.bot.store,device),index=steps.findIndex(s=>s.id===id),s=steps[index];
    if(action==='add'){
      steps.push({id:randomBytes(4).toString('hex'),title:'Nuevo paso',text:'Edita las instrucciones de este paso.',asset:null});saveGuide(this.bot.store,device,steps);return this.menu(chat,device);
    }
    if(!s)throw new Error('Ese paso ya no existe. Vuelve a abrir GUÍAS.');
    if(['title','text','asset'].includes(action)){
      this.bot.pending.set(key,{kind:'guide',device,id,field:action});
      return this.bot.send(chat,action==='asset'?'Envía la nueva foto, GIF o animación MP4 (máximo 8 MB). /cancelar para salir.':`Envía ${action==='title'?'el título (máximo 80 caracteres)':'las instrucciones (máximo 1000 caracteres)'}. /cancelar para salir.`);
    }
    if(action==='up'||action==='down'){
      const next=index+(action==='up'?-1:1);if(next>=0&&next<steps.length)[steps[index],steps[next]]=[steps[next],steps[index]];
      saveGuide(this.bot.store,device,steps);return this.menu(chat,device);
    }
    if(action==='remove'){
      return this.bot.send(chat,`¿Quitar el paso «${s.title}» de esta guía?`,{inline_keyboard:[[{text:'CONFIRMAR',callback_data:`guide:${device}:${id}:delete`},{text:'CANCELAR',callback_data:`guide:${device}:${id}`}]]});
    }
    if(action==='delete'){steps.splice(index,1);saveGuide(this.bot.store,device,steps);return this.menu(chat,device);}
    const b=(text,action)=>({text,callback_data:`guide:${device}:${id}:${action}`});
    const rows=[[b('EDITAR TÍTULO','title'),b('EDITAR INSTRUCCIONES','text')],[b('CAMBIAR IMAGEN / GIF','asset')],[b('SUBIR PASO ↑','up'),b('BAJAR PASO ↓','down')],[b('QUITAR PASO','remove')],[{text:'ATRÁS',callback_data:`guide:${device}`}]];
    return this.bot.send(chat,`${device.toUpperCase()} · Paso ${index+1}\n${s.title}\n\n${s.text}\n\n${s.asset?'Vista de la imagen/animación: '+this.bot.config.url+s.asset:'Sin imagen.'}`,{inline_keyboard:rows});
  }
  async input(chat,pending,m){
    const steps=guides(this.bot.store,pending.device),s=steps.find(s=>s.id===pending.id);if(!s)throw new Error('El paso ya no existe.');
    let created=null;
    if(pending.field==='asset'){
      const f=m.photo?.at(-1)||m.animation||m.video||m.document;
      if(!f)throw new Error('Envía una imagen, GIF o animación.');
      if(f.file_size>8*1024*1024)throw new Error('El archivo supera 8 MB.');
      const data=await this.bot.download(f.file_id);if(data.length>8*1024*1024)throw new Error('El archivo supera 8 MB.');
      const {ext}=detectMedia(data),folder=path.join(this.bot.accounts.dir,'guide-media');
      const disk=statfsSync(this.bot.accounts.dir);if(disk.bavail*disk.bsize<50*1024*1024)throw new Error('No hay espacio suficiente para guardar la guía.');
      mkdirSync(folder,{recursive:true,mode:0o700});
      const name=createHash('sha256').update(data).digest('hex')+'.'+ext,temp=path.join(folder,randomBytes(8).toString('hex')+'.tmp');
      const destination=path.join(folder,name);created=existsSync(destination)?null:destination;writeFileSync(temp,data,{mode:0o600});renameSync(temp,destination);s.asset='/guide-media/'+name;
    }else{s[pending.field]=(m.text||'').trim();}
    try{saveGuide(this.bot.store,pending.device,steps);}catch(e){if(created)rmSync(created,{force:true});throw e;}
    return this.bot.send(chat,'✅ Paso actualizado. Se verá al recargar la web.',{inline_keyboard:[[{text:'VOLVER AL PASO',callback_data:`guide:${pending.device}:${pending.id}`}]]});
  }
}
