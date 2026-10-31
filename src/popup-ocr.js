// OCR and editable text layers for the *new* Cubamax/Studio initial popups.
// No WhatsApp popup, chat content or account material is accessed here.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {statSync} from 'node:fs';
import path from 'node:path';
const exec=promisify(execFile);
const imagePattern=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
const goodColor=v=>/^#[0-9a-f]{6}$/i.test(v||'');
const number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const limited=(v,n)=>typeof v==='string'&&v.length<=n?v:null;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=n=>Math.round(n*10000)/10000;
export const maxPopupLayers=60;
export function validatePopupLayers(value){
 if(value==null)return [];
 if(typeof value==='string'){if(value.length>28000)fail(400,'Demasiado texto para el popup.');try{value=JSON.parse(value);}catch{fail(400,'Frases del popup no válidas.');}}
 if(!Array.isArray(value)||value.length>maxPopupLayers)fail(400,'Máximo 60 frases por popup.');
 return value.map((layer,index)=>{
  if(!layer||typeof layer!=='object'||Array.isArray(layer))fail(400,'Frase del popup no válida.');
  const original=limited(layer.original,280),text=limited(layer.text,280);
  if(original===null||text===null)fail(400,'Texto de la frase demasiado largo.');
  for(const k of ['x','y','w','h'])if(!number(layer[k],0,1))fail(400,'Posición del texto no válida.');
  if(layer.w<0.002||layer.h<0.002||layer.x+layer.w>1.002||layer.y+layer.h>1.002)
   fail(400,'La frase debe quedar dentro de la foto.');
  const size=Number(layer.fontSize);
  if(!number(size,6,500))fail(400,'Tamaño del texto no válido.');
  const color=goodColor(layer.color)?layer.color:'#ffffff';
  const weight=['400','500','600','700','800','900'].includes(String(layer.weight))?String(layer.weight):'700';
  const family=['Arial','Helvetica','Georgia','Times New Roman','Verdana','system-ui'].includes(layer.family)?layer.family:'Arial';
  const id=typeof layer.id==='string'&&/^[a-z0-9-]{1,32}$/i.test(layer.id)?layer.id:'ocr-'+index;
  return {id,x:round(layer.x),y:round(layer.y),w:round(layer.w),h:round(layer.h),
   original,text,color,fontSize:Math.round(size*10)/10,weight,family};
 });
}
export function parseTesseractTsv(tsv,width,height){
 if(!number(width,1,10000)||!number(height,1,10000))return [];
 const lines=new Map();
 for(const row of String(tsv).split(/\r?\n/).slice(1)){
  const values=row.split('\t');if(values.length<12||Number(values[0])!==5)continue;
  const conf=Number(values[10]),word=values.slice(11).join(' ').replace(/\s+/g,' ').trim();
  if(!word||!Number.isFinite(conf)||conf<35)continue;
  const x=Number(values[6]),y=Number(values[7]),w=Number(values[8]),h=Number(values[9]);
  if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||x<0||y<0||x+w>width||y+h>height)continue;
  const key=values.slice(1,5).join(':');
  const existing=lines.get(key)||{parts:[],left:x,top:y,right:x+w,bottom:y+h,conf:0};
  existing.parts.push({x,word});existing.left=Math.min(existing.left,x);existing.top=Math.min(existing.top,y);
  existing.right=Math.max(existing.right,x+w);existing.bottom=Math.max(existing.bottom,y+h);
  existing.conf+=conf;lines.set(key,existing);
 }
 const result=[];
 for(const [key,line] of lines){
  const phrase=line.parts.sort((a,b)=>a.x-b.x).map(p=>p.word).join(' ').trim().slice(0,280);
  if(!phrase||phrase.length<2)continue;
  const pad=Math.max(2,Math.round((line.bottom-line.top)*0.12));
  const x=clamp(line.left-pad,0,width),y=clamp(line.top-pad,0,height);
  const right=clamp(line.right+pad,0,width),bottom=clamp(line.bottom+pad,0,height);
  result.push({id:'ocr-'+result.length,x:round(x/width),y:round(y/height),
    w:round((right-x)/width),h:round((bottom-y)/height),
    original:phrase,text:phrase,color:'#ffffff',fontSize:clamp(Math.round((line.bottom-line.top)*0.86),6,500),
    weight:'700',family:'Arial'});
  if(result.length>=maxPopupLayers)break;
 }
 return result.sort((a,b)=>a.y-b.y||a.x-b.x).map((p,i)=>({...p,id:'ocr-'+i}));
}
export async function recognizePopupText(asset,dir,{execute=exec,metadata=null}={}){
 if(!imagePattern.test(asset||''))fail(400,'Solo se pueden reconocer fotos subidas al editor.');
 const filename=path.join(dir,asset.slice(1));
 let stat;try{stat=statSync(filename);}catch{fail(404,'La foto no se encuentra en el editor.');}
 if(!stat.isFile()||stat.size>12*1024*1024)fail(413,'La foto debe ocupar 12 MB o menos.');
 let meta=metadata;
 if(!meta){const {default:sharp}=await import('sharp');meta=await sharp(filename,{limitInputPixels:25000000}).metadata();}
 const width=meta.width,height=meta.height;
 if(!number(width,1,10000)||!number(height,1,10000)||width*height>25000000)fail(413,'La foto es demasiado grande para el reconocimiento.');
 let stdout='';
 try{
  const output=await execute('tesseract',[filename,'stdout','-l','spa+eng','--psm','11','tsv'],{timeout:25000,maxBuffer:4*1024*1024});
  stdout=typeof output==='string'?output:output.stdout;
 }catch(error){
  if(error.code==='ENOENT')fail(503,'El reconocimiento de texto no está instalado en este servidor.');
  if(error.killed||error.signal==='SIGTERM')fail(503,'El reconocimiento tardó demasiado. Usa una imagen más pequeña.');
  fail(503,'No se pudo reconocer el texto de esa imagen. Puedes intentarlo de nuevo.');
 }
 const layers=validatePopupLayers(parseTesseractTsv(stdout,width,height));
 return {asset,width,height,layers,notice:'Las letras se aproximan al diseño original. Si la fuente es decorativa puede necesitar ajustes.'};
}
