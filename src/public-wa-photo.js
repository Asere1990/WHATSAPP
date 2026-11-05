import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {recognizePopupText} from './popup-ocr.js';

const zone='America/New_York';
const two=x=>String(x).padStart(2,'0');
const escapeXml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const datePattern=/\b(?:\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+\d{4})\b/giu;
const timePattern=/\b(?:[01]?\d|2[0-3]):[0-5]\d(?:[:][0-5]\d)?(?:\s*[ap]\\.?m\\.?)?\b/giu;
function parts(date){
 const data=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return data;
}
function dateReplacement(example,now){
 const p=parts(now),original=example.trim();
 if(/\bde\b/i.test(original))return new Intl.DateTimeFormat('es-ES',{timeZone:zone,day:'numeric',month:'long',year:'numeric'}).format(now).replace(' de ',' de ');
 const sign=original.includes('/')?'/':original.includes('.')?'.':'-';
 const yearFirst=/^\d{4}/.test(original);
 const year=original.match(/\d{4}/)?p.year:p.year.slice(2);
 if(yearFirst)return [year,p.month,p.day].join(sign);
 return [p.day,p.month,year].join(sign);
}
function timeReplacement(example,now){
 const p=parts(now),clock=example.trim(),withSeconds=/^\d{1,2}:\d{2}:\d{2}/.test(clock);
 const ampm=/[ap]\s*\.?m\.?/i.test(clock);
 const twentyfour=Number(p.hour);
 const hh=ampm? (twentyfour%12||12):twentyfour;
 const hour=/^\d:/.test(clock)?String(hh):two(hh);
 const suffix=ampm?(twentyfour<12?' AM':' PM'):'';
 const sec=withSeconds?':00':'';
 return hour+':'+p.minute+sec+suffix;
}
function replacements(layer,now){
 const text=String(layer.original||'');
 const matches=[];
 for(const re of [datePattern,timePattern]){
  re.lastIndex=0;
  for(const m of text.matchAll(re)){
    const kind=re===datePattern?'date':'time';
    matches.push({index:m.index,len:m[0].length,kind,value:kind==='date'?dateReplacement(m[0],now):timeReplacement(m[0],now)});
  }
 }
 return matches.sort((a,b)=>a.index-b.index);
}
async function sampleColor(sharp,data,region){
 const {data:raw,info}=await sharp(data).extract(region).raw().toBuffer({resolveWithObject:true});
 const width=info.width,height=info.height,channels=info.channels;
 let r=0,g=0,b=0,count=0;
 for(let x=0;x<width;x++){
   for(const y of [0,height-1]){
     const i=(y*width+x)*channels;r+=raw[i];g+=raw[i+1];b+=raw[i+2];count++;
   }
 }
 for(let y=1;y<height-1;y++){
   for(const x of [0,width-1]){
     const i=(y*width+x)*channels;r+=raw[i];g+=raw[i+1];b+=raw[i+2];count++;
   }
 }
 const rgb=[Math.round(r/count),Math.round(g/count),Math.round(b/count)];
 const bright=rgb.reduce((a,b)=>a+b,0)/3;
 return {background:'#'+rgb.map(x=>two(x.toString(16))).join(''),foreground:bright<130?'#ffffff':'#161616'};
}
// The original photo and non-date/time pixels are never overwritten.
// OCR-derived bounding boxes are the ONLY permitted locations for retouching.
export async function publicPopupPhoto(store,dir,source,at=new Date()){
 if(!/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(source||''))throw Error('Configura primero la FOTO del popup público de WhatsApp en el editor.');
 const file=path.join(dir,source.slice(1));
 const data=readFileSync(file);
 const {default:sharp}=await import('sharp');
 const image=sharp(data,{limitInputPixels:25000000}).rotate();
 const meta=await image.metadata();
 const w=meta.width,h=meta.height;
 if(!w||!h||w*h>25000000)throw Error('La imagen es demasiado grande para actualizar fecha y hora.');
 let layers;
 store.db.exec('CREATE TABLE IF NOT EXISTS wa_public_ocr_cache(source TEXT PRIMARY KEY,layers TEXT NOT NULL,created INTEGER NOT NULL)');
 const cached=store.db.prepare('SELECT layers FROM wa_public_ocr_cache WHERE source=?').get(source);
 if(cached)try{layers=JSON.parse(cached.layers);}catch{}
 if(!layers){
  const ocr=await recognizePopupText(source,dir);
  layers=ocr.layers;
  store.db.prepare('INSERT OR REPLACE INTO wa_public_ocr_cache(source,layers,created) VALUES(?,?,?)').run(source,JSON.stringify(layers),Date.now());
 }
 const date=new Date(at),overlays=[],types=new Set(),prepared=await image.png().toBuffer();
 for(const layer of layers){
  const hits=replacements(layer,date);
  if(!hits.length)continue;
  for(const m of hits){
   types.add(m.kind);
   const base=Math.max(1,String(layer.original).length);
   const left=Math.max(0,Math.min(w-2,Math.round((layer.x+layer.w*m.index/base)*w)));
   const top=Math.max(0,Math.min(h-2,Math.floor(layer.y*h)));
   const right=Math.max(left+2,Math.min(w,Math.round((layer.x+layer.w*(m.index+m.len)/base)*w)));
   const bottom=Math.max(top+2,Math.min(h,Math.ceil((layer.y+layer.h)*h)));
   const region={left,top,width:right-left,height:bottom-top};
   if(region.width<4||region.height<5)continue;
   const {background,foreground}=await sampleColor(sharp,prepared,region);
   const fontSize=Math.max(6,Math.min(region.height*0.76,Math.max(6,Number(layer.fontSize)||16)));
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}"><rect width="100%" height="100%" fill="${background}"/><text x="1" y="${Math.round(region.height*0.78)}" font-family="Arial" font-weight="${layer.weight||700}" font-size="${fontSize}" fill="${foreground}" textLength="${Math.max(3,region.width-2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(m.value)}</text></svg>`;
   overlays.push({input:Buffer.from(svg),left,top});
  }
 }
 if(!types.has('date')||!types.has('time')||!overlays.length)
  throw Error('La foto no permite reconocer fecha y hora por OCR. El popup original no se modificó. Sube una foto con fecha y hora claramente visibles.');
 const bytes=await sharp(prepared).composite(overlays).png().toBuffer();
 const filename=createHash('sha256').update(bytes).digest('hex')+'.png';
 const dest=path.join(dir,'portal-media');
 mkdirSync(dest,{recursive:true,mode:0o700});
 writeFileSync(path.join(dest,filename),bytes,{mode:0o600,flag:'w'});
 return {asset:'/portal-media/'+filename,issuedAt:date.toISOString(),replaced:types.size};
}
