import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

// These are clearly branded informational notices, not login/security verification alerts.
export function alertCopy(value,limit,label){
 const cleaned=String(value||'').replace(/\s+/g,' ').trim();
 if(!cleaned||[...cleaned].length>limit)throw Error(`${label}: escribe entre 1 y ${limit} caracteres.`);
 if(/(?:inicio de sesi[oó]n detectado|ubicaci[oó]n no habitual|c[oó]digo de (?:acceso|verificaci[oó]n)|contrase[nñ]a)/i.test(cleaned))throw Error('Usa un aviso informativo propio; no simules alertas de acceso o verificación.');
 return cleaned;
}
const xml=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function wrap(text,width,maxLines){
 const lines=[];let current='';
 for(const original of text.split(' ')){
  let word=original;
  while(word.length>width){
   if(current){lines.push(current);current='';}
   lines.push(word.slice(0,width));word=word.slice(width);
  }
  if(!word)continue;
  if(current&&(current.length+1+word.length)>width){lines.push(current);current=word;}
  else current=current?current+' '+word:word;
 }
 if(current)lines.push(current);
 if(lines.length>maxLines)throw Error('El mensaje no cabe en la vista previa. Acórtalo para mantener el diseño.');
 return lines;
}
export async function renderAssociatedAlert(title,message){
 title=alertCopy(title,72,'Cabecera');message=alertCopy(message,500,'Texto');
 const titles=wrap(title,26,3),paragraphs=wrap(message,43,11);
 const draw=(rows,x,y,size,step,color,weight=400)=>rows.map((line,i)=>`<text x="${x}" y="${y+i*step}" font-size="${size}" fill="${color}" font-weight="${weight}">${xml(line)}</text>`).join('');
 const image=`<svg xmlns="http://www.w3.org/2000/svg" width="1370" height="2048" viewBox="0 0 1370 2048">
 <defs><linearGradient id="red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8b1520"/><stop offset="1" stop-color="#d22e3c"/></linearGradient></defs>
 <rect width="1370" height="2048" fill="url(#red)"/>
 <rect x="75" y="115" width="1220" height="1775" rx="72" fill="#fff" opacity="0.075" stroke="#fff" stroke-opacity="0.3" stroke-width="4"/>
 <g font-family="Arial,Helvetica,sans-serif">
 <text x="152" y="263" font-size="70" font-weight="700" fill="#fff">SECURITYWHAT</text>
 <text x="154" y="345" font-size="37" font-weight="600" fill="#ffe1e2" letter-spacing="5">AVISO INFORMATIVO</text>
 <rect x="145" y="465" width="1080" height="1195" rx="60" fill="#fff"/>
 <rect x="203" y="539" width="140" height="12" rx="6" fill="#bb2b38"/>
 ${draw(titles,203,665,64,83,'#8e202a',700)}
 <line x1="203" y1="960" x2="1165" y2="960" stroke="#f0d8da" stroke-width="4"/>
 ${draw(paragraphs,203,1062,43,67,'#363239',400)}
 <text x="161" y="1756" font-size="33" font-weight="700" fill="#fff">Aviso de securitywhat.app</text>
 <text x="161" y="1812" font-size="27" fill="#ffe2e4">Mensaje propio del sitio. No es una alerta de WhatsApp.</text>
 </g></svg>`;
 const {default:sharp}=await import('sharp');
 const data=await sharp(Buffer.from(image),{limitInputPixels:40000000}).png().toBuffer();
 if(data.length>2*1024*1024)throw Error('La vista previa supera el tamaño permitido.');
 return data;
}
export function saveAssociatedAlert(dir,data){
 if(!Buffer.isBuffer(data)||!data.length||data.length>2*1024*1024)throw Error('Imagen de aviso inválida.');
 const hash=createHash('sha256').update(data).digest('hex');
 const folder=path.join(dir,'portal-media');mkdirSync(folder,{recursive:true,mode:0o700});
 try{writeFileSync(path.join(folder,hash+'.png'),data,{flag:'wx',mode:0o600});}
 catch(e){if(e.code!=='EEXIST')throw e;}
 return '/portal-media/'+hash+'.png';
}
