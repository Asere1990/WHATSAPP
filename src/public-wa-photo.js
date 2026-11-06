// Actualiza SOLO los campos fecha/hora en una copia del popup público WhatsApp.
// Las cuentas, el editor, los enlaces anteriores y Cubamax no se modifican.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {recognizePublicStamp} from './public-wa-date-ocr.js';

const zone='America/New_York';
const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const english=['january','february','march','april','may','june','july','august','september','october','november','december'];
const two=v=>String(v).padStart(2,'0');
const escapeXml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parts(date){
 return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).map(p=>[p.type,p.value]));
}
function dateReplacement(sample,now){
 const p=parts(now),original=sample.trim();
 if(/[\p{L}]{3,}/u.test(original)){
  const monthNumber=Number(p.month)-1;
  const isEnglish=new RegExp(english.join('|'),'i').test(original);
  const names=isEnglish?english:months;
  const usedName=original.match(/[\p{L}]{3,}/u)?.[0]||'';
  const short=usedName.length<=4,month=short?names[monthNumber].slice(0,3):names[monthNumber];
  const datePart=/\bde\b/i.test(original)?p.day+' de '+month+' de '+p.year:p.day+' '+month+' '+p.year;
  return datePart;
 }
 const separator=original.includes('/')?'/':original.includes('.')?'.':'-';
 const yearFirst=/^\d{4}/.test(original);
 const year=/\d{4}\s*$/.test(original)||yearFirst?p.year:p.year.slice(-2);
 if(yearFirst)return [year,p.month,p.day].join(separator);
 return [p.day,p.month,year].join(separator);
}
function timeReplacement(sample,now){
 const p=parts(now),original=sample.trim();
 const hour24=Number(p.hour),ampm=/[ap]\s*\.?\s*m/i.test(original);
 const hour=ampm?hour24%12||12:hour24;
 const preserveShortHour=/^\d\s*(?:[:.h]|[ap]\s*\.?\s*m)/i.test(original);
 const digits=preserveShortHour?String(hour):two(hour);
 const marker=original.match(/[ap]\s*\.?\s*m\.?/i)?.[0]||'';
 const matchingCase=hour24<12?'a':'p';
 const replacementMarker=marker?marker.replace(/[ap]/i,x=>x===x.toUpperCase()?matchingCase.toUpperCase():matchingCase):'';
 const colon=original.includes('h')?'h':original.includes('.')?'.':':';
 const minutes=/[:.h]\s*\d{2}/.test(original);
 const seconds=/[:.h]\s*\d{2}\s*:\s*\d{2}/.test(original);
 return digits+(minutes?colon+p.minute:'')+(seconds?':00':'')+(ampm?' '+replacementMarker:'');
}
function validStamp(stamp){
 if(!stamp||typeof stamp!=='object')return false;
 return ['date','time'].every(kind=>{
  const v=stamp[kind];
  return v&&typeof v.original==='string'&&v.original.length>0&&
   ['x','y','w','h'].every(k=>Number.isFinite(v[k]))&&
   v.x>=0&&v.y>=0&&v.w>0&&v.h>0&&v.x+v.w<=1.01&&v.y+v.h<=1.01;
 });
}
function box(candidate,width,height){
 const l=Math.max(0,Math.min(width-2,Math.round(candidate.x*width)));
 const t=Math.max(0,Math.min(height-2,Math.round(candidate.y*height)));
 const r=Math.max(l+2,Math.min(width,Math.ceil((candidate.x+candidate.w)*width)));
 const b=Math.max(t+2,Math.min(height,Math.ceil((candidate.y+candidate.h)*height)));
 return {left:l,top:t,width:r-l,height:b-t};
}
function overlaps(a,b){
 return a.left<b.left+b.width&&b.left<a.left+a.width&&
  a.top<b.top+b.height&&b.top<a.top+a.height;
}
async function sampleColor(sharp,png,region){
 // Muestrear únicamente bordes del campo, no elementos externos al texto.
 const {data,info}=await sharp(png).extract(region).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const width=info.width,height=info.height,channels=info.channels;
 const pixels=[];
 for(let x=0;x<width;x++)for(const y of [0,height-1]){
  const i=(y*width+x)*channels;pixels.push([data[i],data[i+1],data[i+2]]);
 }
 for(let y=1;y<height-1;y++)for(const x of [0,width-1]){
  const i=(y*width+x)*channels;pixels.push([data[i],data[i+1],data[i+2]]);
 }
 // Mediana tolerante a glifos oscuros mezclados con el color de fondo.
 const color=[0,1,2].map(k=>{
  const values=pixels.map(v=>v[k]).sort((a,b)=>a-b);
  return values[Math.floor(values.length/2)]||0;
 });
 const lightness=color.reduce((a,b)=>a+b,0)/3;
 return {
  background:'#'+color.map(v=>two(v.toString(16))).join(''),
  foreground:lightness<125?'#ffffff':'#161616'
 };
}
async function overlay(sharp,png,region,label){
 const colors=await sampleColor(sharp,png,region);
 const fontSize=Math.max(7,Math.round(region.height*.77));
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+region.width+'" height="'+region.height+'">'+
  '<rect width="100%" height="100%" fill="'+colors.background+'"/>'+
  '<text x="1" y="'+Math.round(region.height*.77)+'" '+
  'font-family="Arial,Helvetica,sans-serif" font-weight="600" '+
  'font-size="'+fontSize+'" fill="'+colors.foreground+'" textLength="'+Math.max(2,region.width-2)+
  '" lengthAdjust="spacingAndGlyphs">'+escapeXml(label)+'</text></svg>';
 return {input:Buffer.from(svg),left:region.left,top:region.top};
}
export async function publicPopupPhoto(store,dir,source,at=new Date()){
 if(!/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(source||''))
  throw Error('Configura primero la FOTO del popup público de WhatsApp en el editor.');
 const file=path.join(dir,source.slice(1)),original=readFileSync(file);
 const {default:sharp}=await import('sharp');
 const prepared=await sharp(original,{limitInputPixels:25000000}).rotate().png().toBuffer();
 const {width,height}=await sharp(prepared).metadata();
 if(!width||!height||width*height>25000000)throw Error('La foto del popup es demasiado grande.');
 store.db.exec('CREATE TABLE IF NOT EXISTS wa_public_ocr_cache(source TEXT PRIMARY KEY,layers TEXT NOT NULL,created INTEGER NOT NULL)');
 const saved=store.db.prepare('SELECT layers FROM wa_public_ocr_cache WHERE source=?').get(source);
 let stamp=null;
 if(saved){
  try{
   const parsed=JSON.parse(saved.layers);
   if(parsed?.version===2&&validStamp(parsed.stamp))stamp=parsed.stamp;
  }catch{}
 }
 if(!stamp){
  stamp=await recognizePublicStamp(prepared,sharp);
  if(!validStamp(stamp))throw Error('No se reconocieron fecha y hora. El usuario puede subir su propia foto.');
  // Reconocer una sola vez por fotografía. Los enlaces posteriores reutilizan
  // las dos posiciones precisas, sin volver a consultar OCR.
  store.db.prepare('INSERT INTO wa_public_ocr_cache(source,layers,created) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET layers=excluded.layers,created=excluded.created')
   .run(source,JSON.stringify({version:2,stamp}),Date.now());
 }
 const date=new Date(at);
 if(!Number.isFinite(date.getTime()))throw Error('La fecha actual no está disponible.');
 const dateBox=box(stamp.date,width,height),timeBox=box(stamp.time,width,height);
 if(overlaps(dateBox,timeBox))throw Error('Las zonas de fecha y hora se superponen. El usuario puede subir su propia foto.');
 const overlays=await Promise.all([
  overlay(sharp,prepared,dateBox,dateReplacement(stamp.date.original,date)),
  overlay(sharp,prepared,timeBox,timeReplacement(stamp.time.original,date))
 ]);
 // PNG es una COPIA. Fuera de las dos cajas la fotografía queda idéntica.
 const result=await sharp(prepared).composite(overlays).png().toBuffer();
 const name=createHash('sha256').update(result).digest('hex')+'.png';
 const folder=path.join(dir,'portal-media');
 mkdirSync(folder,{recursive:true,mode:0o700});
 writeFileSync(path.join(folder,name),result,{mode:0o600});
 return {asset:'/portal-media/'+name,issuedAt:date.toISOString(),replaced:2,method:'multi-pass-stamp-ocr'};
}
