// OCR específico para la fecha y la hora del popup público de WhatsApp.
// El resto del editor y las imágenes originales se mantienen independientes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
const MONTHS='ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|sept?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const dateNumeric=/\b(?:\d{4}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{1,2}|\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{2,4})\b/giu;
const dateWords=new RegExp('\\b\\d{1,2}\\s*(?:de\\s+)?(?:'+MONTHS+')\\.?\\s*(?:de\\s+)?\\d{2,4}\\b','giu');
const timeNumeric=/\b(?:[01]?\d|2[0-3])\s*[:.h]\s*[0-5]\d(?:\s*:\s*[0-5]\d)?(?:\s*[ap]\s*\.?\s*m\s*\.?)?(?=\s|$|[,;)])/giu;
const timeWords=/\b(?:0?[1-9]|1[0-2])\s*(?:[ap]\s*\.?\s*m\s*\.?)(?=\s|$|[,;)])/giu;
const number=v=>Number.isFinite(v)&&v>0;
const normalizeLine=s=>String(s).replace(/(?<=\d)[Oo](?=\d)/g,'0')
 .replace(/(?<=\d)[Il](?=\d)/g,'1')
 .replace(/[‐‑‒–—]/g,'-')
 .replace(/[：]/g,':');
const round=x=>Math.round(x*100000)/100000;
function plausible(kind,original){
 if(kind==='time'){
  const m=/^\s*(\d{1,2})\s*[:.h]\s*(\d{2})/.exec(original);
  if(m)return Number(m[1])<=23&&Number(m[2])<=59;
  return /[ap]\s*\.?\s*m/i.test(original)&&Number(original.match(/\d+/)?.[0])<=12;
 }
 const numeric=original.replace(/\s/g,'').match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/);
 if(!numeric)return /\d{2,4}/.test(original)&&/\d{1,2}/.test(original);
 const [a,b,c]=numeric.slice(1).map(Number);
 if(numeric[1].length===4)return a>=2000&&a<=2100&&b>=1&&b<=12&&c>=1&&c<=31;
 return a>=1&&a<=31&&b>=1&&b<=12&&c>=0&&c<=2100;
}
function geometry(line,start,end,imageWidth,imageHeight){
 const affected=line.words.filter(w=>w.end>start&&w.start<end);
 if(!affected.length)return null;
 let left=Infinity,top=Infinity,right=0,bottom=0;
 for(const w of affected){
  const first=Math.max(start,w.start),last=Math.min(end,w.end);
  const width=Math.max(1,w.end-w.start);
  const l=w.x+w.w*Math.max(0,(first-w.start)/width);
  const r=w.x+w.w*Math.min(1,(last-w.start)/width);
  left=Math.min(left,l);right=Math.max(right,r);
  top=Math.min(top,w.y);bottom=Math.max(bottom,w.y+w.h);
 }
 if(!number(right-left)||!number(bottom-top))return null;
 const padX=Math.min(3,Math.max(1,(right-left)*0.012));
 const padY=Math.min(2,Math.max(1,(bottom-top)*0.075));
 return {x:round(Math.max(0,left-padX)/imageWidth),
  y:round(Math.max(0,top-padY)/imageHeight),
  w:round(Math.min(imageWidth,right+padX)-Math.max(0,left-padX))/imageWidth,
  h:round((Math.min(imageHeight,bottom+padY)-Math.max(0,top-padY))/imageHeight)};
}
function findCandidates(lines,width,height){
 const results=[];
 for(const line of lines){
  const plain=normalizeLine(line.text);
  const contextual=plain.toLowerCase();
  for(const [kind,patterns] of [['date',[dateNumeric,dateWords]],['time',[timeNumeric,timeWords]]]){
   for(const re of patterns){
    re.lastIndex=0;
    for(const m of plain.matchAll(re)){
     if(!plausible(kind,m[0]))continue;
     const position=geometry(line,m.index,m.index+m[0].length,width,height);
     if(!position)continue;
     const label=kind==='date'?/(fecha|date|hoy|día|dia)\s*[:\s]/i.test(contextual)
       :/(hora|time|hour|enviado|sent)\s*[:\s]/i.test(contextual);
     const score=Math.min(100,line.confidence)/3+(label?35:0)+
      (kind==='date'&&/\d{4}/.test(m[0])?20:0)+
      (kind==='time'&&/[ap]\s*\.?\s*m/i.test(m[0])?10:0)+
      (line.text.length<55?6:0);
     results.push({kind,original:m[0],...position,score,confidence:line.confidence});
    }
   }
  }
 }
 return results;
}
export function parseStampTsv(tsv,width,height){
 if(!number(width)||!number(height))return [];
 const groups=new Map();
 for(const row of String(tsv||'').split(/\r?\n/).slice(1)){
  const a=row.split('\t');
  if(a.length<12||a[0]!=='5')continue;
  const conf=Number(a[10]),x=Number(a[6]),y=Number(a[7]),w=Number(a[8]),h=Number(a[9]);
  const word=a.slice(11).join(' ').trim();
  if(!word||!Number.isFinite(conf)||conf<22||![x,y,w,h].every(Number.isFinite)||w<1||h<1||
   x<0||y<0||x+w>width||y+h>height)continue;
  const lineId=a.slice(1,5).join(':');
  if(!groups.has(lineId))groups.set(lineId,[]);
  groups.get(lineId).push({word,x,y,w,h,conf});
 }
 const lines=[];
 for(const records of groups.values()){
  const words=records.sort((a,b)=>a.x-b.x),spans=[],texts=[];
  let cursor=0,totalConf=0;
  for(const w of words){
   if(texts.length)cursor++;
   const start=cursor;cursor+=w.word.length;
   texts.push(w.word);spans.push({...w,start,end:cursor});
   totalConf+=w.conf;
  }
  lines.push({text:texts.join(' '),words:spans,
   confidence:totalConf/Math.max(1,records.length)});
 }
 return findCandidates(lines,width,height);
}
export function selectStamp(candidates){
 const dates=candidates.filter(c=>c.kind==='date'),times=candidates.filter(c=>c.kind==='time');
 if(!dates.length||!times.length)return null;
 // Prefer fields near each other or on the same row, with "Fecha"/"Hora".
 let chosen=null,best=-Infinity;
 for(const d of dates)for(const t of times){
  const dy=Math.abs(d.y-t.y),dx=Math.abs(d.x-t.x);
  const score=d.score+t.score-Math.min(45,dy*90)-Math.min(15,dx*8)+
   (dy<0.04?16:0);
  if(score>best){best=score;chosen={date:d,time:t,confidence:score};}
 }
 return chosen;
}
export async function recognizePublicStamp(png,sharp,{execute=exec}={}){
 const metadata=await sharp(png).metadata();
 const width=metadata.width,height=metadata.height;
 if(!number(width)||!number(height)||width*height>25000000)throw Error('Imagen del popup demasiado grande.');
 const folder=mkdtempSync(path.join(tmpdir(),'wa-stamp-'));
 const candidates=[];
 try{
  for(let pass=0;pass<3;pass++){
   let buffer=png,scale=1,psm='11';
   if(pass>0){
    scale=width>1600?1.4:2;
    const resized=sharp(png).resize({width:Math.round(width*scale),withoutEnlargement:false})
     .greyscale().normalise();
    buffer=await (pass===1?resized.sharpen():resized.threshold(155)).png().toBuffer();
    psm=pass===1?'6':'11';
   }
   const meta=await sharp(buffer).metadata();
   const file=path.join(folder,'pass-'+pass+'.png');
   writeFileSync(file,buffer);
   try{
    const response=await execute('tesseract',
     [file,'stdout','-l','spa+eng','--psm',psm,'tsv'],
     {timeout:18000,maxBuffer:5*1024*1024});
    const found=parseStampTsv(typeof response==='string'?response:response.stdout,meta.width,meta.height);
    candidates.push(...found);
    if(selectStamp(candidates))break;
   }catch(error){
    if(error.code==='ENOENT')throw Error('Reconocimiento OCR no instalado.');
    // A single bad scan must not prevent the next preprocessing pass.
   }
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
 return selectStamp(candidates);
}
