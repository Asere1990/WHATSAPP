(()=>{
 const $=id=>document.getElementById(id),canvas=$('image'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 const W=1370,H=2048,defaults={address:'1201 Brickell Ave,\nMiami, FL 33131',ip:'186.23.45.178',date:'31 oct 2026 · 10:40 a. m.',device:'Windows · Chrome'};
 let original=null,csrf='',source='';
 // Editable OCR rectangles exist ONLY in this admin preview. They never
 // change the uploaded original image or any published popup until APPLY.
 let recognized=[],scanGeneration=0,lastTap=null,pointerStart=null,lastOpened=0,holdTimer=null;
 const getLayers=()=>recognized;
 const paintSource=(img,description)=>{original=img;source=description;};

 const notice=(s,bad=false)=>{$('status').textContent=s;$('status').style.color=bad?'#bd241c':'#186856';};
 async function api(path,body,raw=false){const response=await fetch('/api/panel/'+path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'X-Panel-CSRF':csrf,...(raw?{}:{'Content-Type':'application/json'})}:{},body:body?(raw?body:JSON.stringify(body)):undefined});let data;try{data=await response.json();}catch{throw Error('Respuesta no válida del servidor.');}if(!response.ok)throw Error(data.error||'No se pudo completar la solicitud.');return data;}
 function linesFor(text,size,maxWidth,maxLines){
  const words=text.replace(/\s+/g,' ').trim().split(' '),lines=[];let line='';ctx.font='700 '+size+'px Arial,Helvetica,sans-serif';
  for(const word of words){const trial=line?line+' '+word:word;if(line&&ctx.measureText(trial).width>maxWidth){lines.push(line);line=word;}else line=trial;}if(line)lines.push(line);return lines.length<=maxLines?lines:null;
 }
 function patch(x,y,w,h){
  // Sample the original red panel on either side of the text. Leave the labels,
  // rounded frame and divider lines untouched, even after repeated exports.
  for(let dy=y;dy<y+h;dy++){
   const left=ctx.getImageData(555,dy,1,1).data,right=ctx.getImageData(1217,dy,1,1).data;
   const mix=ctx.createLinearGradient(x,dy,x+w,dy);mix.addColorStop(0,'rgb('+left[0]+','+left[1]+','+left[2]+')');mix.addColorStop(1,'rgb('+right[0]+','+right[1]+','+right[2]+')');
   ctx.fillStyle=mix;ctx.fillRect(x,dy,w,1);
  }
 }
 function text(lines,baseline,size,step=0){
  ctx.font='700 '+size+'px Arial,Helvetica,sans-serif';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#fff';
  ctx.shadowColor='#ffffff55';ctx.shadowBlur=1.5;
  lines.forEach((line,i)=>ctx.fillText(line,598,baseline+i*step));ctx.shadowBlur=0;
 }
 function single(field,y0,height,baseline){
  const value=$(field).value.trim();if(value===defaults[field])return;
  patch(583,y0,636,height);
  let font=51;while(font>30){ctx.font='700 '+font+'px Arial,Helvetica,sans-serif';if(ctx.measureText(value).width<=595)break;font--;}text([value],baseline,font);
 }
 // Paint only phrases changed by the administrator, using the original pixels
 // of the preview to approximate the background, without mutating the source.
 function paintEditedLines(){
  const limit=(v,a,b)=>Math.max(a,Math.min(b,v));
  const edits=getLayers().filter(line=>line.text!==line.original||line.styled||
    (line.drawX??line.x)!==line.x||(line.drawY??line.y)!==line.y);
  if(!edits.length)return;

  // Sample the UNALTERED image first. The old per-row samples occasionally
  // picked white glyph pixels or pixels from a previous OCR line, producing
  // horizontal white bars when the new text was dragged over another line.
  const sampleEdge=(x,y,side)=>{
   const candidates=[];
   for(const gap of [9,19,31])for(const dy of [-5,0,5]){
    const px=limit(x+side*gap,0,W-1),py=limit(y+dy,0,H-1);
    try{
     const c=ctx.getImageData(px,py,1,1).data;
     candidates.push({rgb:[c[0],c[1],c[2]],
      light:c[0]*.2126+c[1]*.7152+c[2]*.0722});
    }catch{}
   }
   if(!candidates.length)return [225,10,8];
   // Discard bright outliers (white letters/antialiasing). In a plain
   // photographic background the remaining samples retain local colors.
   candidates.sort((a,b)=>a.light-b.light);
   const chosen=candidates.slice(0,Math.max(1,Math.ceil(candidates.length*.65)));
   return [0,1,2].map(k=>Math.round(chosen.reduce((sum,c)=>sum+c.rgb[k],0)/chosen.length));
  };
  const rectangles=edits.map(line=>{
   const size=Math.max(1,Math.round(line.h*H));
   const padX=Math.min(14,Math.max(2,Math.round(size*.10)));
   const padY=Math.min(10,Math.max(2,Math.round(size*.10)));
   const x=limit(Math.floor(line.x*W)-padX,0,W-1);
   const y=limit(Math.floor(line.y*H)-padY,0,H-1);
   const right=limit(Math.ceil((line.x+line.w)*W)+padX,x+1,W);
   const bottom=limit(Math.ceil((line.y+line.h)*H)+padY,y+1,H);
   const bands=[];
   for(let row=y;row<bottom;row+=6){
    const h=Math.min(6,bottom-row),middle=row+Math.floor(h/2);
    bands.push({row,h,left:sampleEdge(x,middle,-1),right:sampleEdge(right-1,middle,1)});
   }
   return {line,x,y,right,bottom,bands};
  });

  // PASS 1: erase ALL original OCR rectangles. Overlapping OCR lines are
  // common in large headings. Never erase after drawing a replacement.
  for(const {x,right,bands} of rectangles){
   for(const band of bands){
    const gradient=ctx.createLinearGradient(x,band.row,right,band.row);
    gradient.addColorStop(0,'rgb('+band.left.join(',')+')');
    gradient.addColorStop(1,'rgb('+band.right.join(',')+')');
    ctx.fillStyle=gradient;
    ctx.fillRect(x,band.row,right-x,band.h);
   }
  }

  // PASS 2: draw ALL replacements above the restored background. Explicit
  // font size and moved position stay in ORIGINAL photo pixels.
  for(const {line} of rectangles){
   const phrase=String(line.text||'').trim();if(!phrase)continue;
   const family=['Arial','Helvetica','Verdana','Georgia','Times New Roman','system-ui'].includes(line.family)?line.family:'Arial';
   const weight=['400','500','600','700','800','900'].includes(String(line.weight))?String(line.weight):'700';
   const size=limit(Number(line.fontSize)||Math.round(line.h*H),6,500);
   const drawX=limit(Math.round((line.drawX??line.x)*W),0,W-1);
   const drawY=limit(Math.round((line.drawY??line.y)*H),0,H-1);
   ctx.font=weight+' '+size+'px "'+family+'"';
   ctx.textBaseline='middle';ctx.textAlign='left';
   ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(line.color||'')?line.color:'#ffffff';
   ctx.fillText(phrase,drawX+2,drawY+line.h*H/2);
  }
 }
 function draw(){if(!original)return;$('download').disabled=false;$('apply').disabled=false;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(original,0,0,W,H);
  if($('address').value.trim()!==defaults.address){patch(583,865,636,144);let size=51,lines=null;while(size>=32){lines=linesFor($('address').value,size,598,2);if(lines)break;size--;}if(!lines){$('download').disabled=true;$('apply').disabled=true;notice('La dirección es demasiado larga para dos líneas. Acórtala.',true);return;}text(lines,lines.length===1?949:916,size,lines.length===1?0:68);}
  single('ip',1042,82,1107);single('date',1155,84,1210);single('device',1277,82,1341);
  paintEditedLines();
 }
 function activate(img,description){
  scanGeneration++;recognized=[];lastTap=null;
  if(img.naturalWidth!==W||img.naturalHeight!==H){
   original=null;$('download').disabled=true;$('apply').disabled=true;
   $('recognize-photo').disabled=true;
   notice('La imagen debe medir exactamente 1370 × 2048 px. Selecciona la plantilla original.',true);return;
  }
  paintSource(img,description);
  $('source-status').textContent='Imagen original cargada: '+description+' (salida 1370 × 2048 px).';
  $('download').disabled=false;$('apply').disabled=false;$('recognize-photo').disabled=false;
  draw();notice('Imagen lista. Identificando las frases para poder editarlas con doble toque…');
  recognizePreview().catch(e=>notice('Vista previa lista. Reconocimiento no disponible: '+e.message+'. Puedes seguir usando el editor.',true));
 }
 function load(src,label){const img=new Image();img.onload=()=>activate(img,label);img.onerror=()=>notice('No se pudo abrir la imagen. Selecciónala en tu dispositivo.',true);img.src=src;}
 $('original').addEventListener('change',()=>{const file=$('original').files?.[0];if(!file)return;if(file.size>12*1024*1024){notice('La imagen debe ocupar menos de 12 MB.',true);return;}const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>activate(img,file.name);img.onerror=()=>notice('Elige un archivo JPG, PNG o WebP válido.',true);img.src=reader.result;};reader.onerror=()=>notice('No se pudo leer la imagen.',true);reader.readAsDataURL(file);});
 for(const id of ['address','ip','date','device'])$(id).addEventListener('input',()=>{draw();});
 function asBlob(){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo crear el PNG.')),'image/png'));}
 async function recognizePreview(){
  if(!original)return;
  const img=original,version=++scanGeneration,old=getLayers();
  if(old.some(l=>l.text!==l.original||l.styled||(l.drawX??l.x)!==l.x||(l.drawY??l.y)!==l.y)&&!confirm('¿Volver a reconocer las frases? Se descartarán las ediciones de texto y posición sin guardar de esta vista previa.'))return;
  $('recognize-photo').disabled=true;
  notice('Reconociendo las frases de la vista previa…');
  try{
   const blob=await asBlob();
   if(!blob||blob.size>12*1024*1024)throw Error('La foto supera el tamaño permitido de 12 MB.');
   const uploaded=await api('editor/upload',new File([blob],'popup-preview-ocr.png',{type:'image/png'}),true);
   if(img!==original||version!==scanGeneration)return;
   const found=await api('editor/ocr',{asset:uploaded.asset});
   if(img!==original||version!==scanGeneration)return;
   recognized=Array.isArray(found.layers)?found.layers:[];
   lastTap=null;draw();
   notice(recognized.length
    ?'Se identificaron '+recognized.length+' frases. Haz doble tap sobre cualquiera de ellas en la imagen para editarla.'
    :'No se identificaron frases claras. Prueba con una foto más nítida o pulsa Reconocer frases de nuevo.');
  }catch(e){
   if(img===original&&version===scanGeneration)notice('El reconocimiento de letras no pudo completarse: '+e.message+'. La edición original permanece disponible.',true);
  }finally{if(img===original&&version===scanGeneration)$('recognize-photo').disabled=false;}
 }
 function atCanvas(event){
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
 }
 function findPhrase(point){
  if(!point)return -1;
  const rect=canvas.getBoundingClientRect();
  // Larger touch targets than the original text height; useful on iPhone.
  const padX=Math.min(.05,18/Math.max(1,rect.width)),padY=Math.min(.04,18/Math.max(1,rect.height));
  const candidates=recognized.map((line,index)=>{
   const left=line.drawX??line.x,top=line.drawY??line.y;
   const dx=Math.max(left-point.x,0,point.x-(left+line.w));
   const dy=Math.max(top-point.y,0,point.y-(top+line.h));
   return {index,dx,dy,distance:Math.hypot(dx,dy)};
  }).filter(p=>p.dx<=padX&&p.dy<=padY).sort((a,b)=>a.distance-b.distance);
  return candidates[0]?.index??-1;
 }
 function openPhrase(index){
  if(index<0||!recognized[index])return;
  if(Date.now()-lastOpened<650)return;lastOpened=Date.now();
  const line=recognized[index];
  if(!globalThis.PopupPhotoEditor?.open)return notice('No se pudo abrir el editor de la frase. Vuelve a entrar al editor.',true);
  globalThis.PopupPhotoEditor.open(line,updated=>{
   recognized[index]=updated;
   draw();
   notice('Frase modificada en vista previa. Puedes editar otras frases; la imagen original sigue intacta. Usa «Usar en popup inicial» para guardar el resultado como borrador.');
  });
 }
 // One finger held = move. Two fingers on the selected phrase = pinch to
 // resize and translate. Both modes operate in original-photo coordinates.
 const activeFingers=new Map();
 let pinch=null,ignoreTapUntil=0;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const round4=n=>Math.round(n*10000)/10000;
 const stopHold=()=>{
  if(holdTimer!=null&&typeof clearTimeout==='function')clearTimeout(holdTimer);
  holdTimer=null;
 };
 const moveTo=(event,start)=>{
  const nowPoint=atCanvas(event),first=start?.point;
  if(!nowPoint||!first)return;
  const line=recognized[start.index];if(!line)return;
  line.drawX=round4(clamp(start.x+nowPoint.x-first.x,0,Math.max(0,1-line.w)));
  line.drawY=round4(clamp(start.y+nowPoint.y-first.y,0,Math.max(0,1-line.h)));
  start.moved=start.moved||line.drawX!==start.x||line.drawY!==start.y;
  draw(); // Exact 1370×2048 canvas used for preview and PNG export.
 };
 const fingerMid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 const fingerDist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const startPinch=()=>{
  if(activeFingers.size!==2||pinch||!pointerStart||pointerStart.index<0)return;
  const line=recognized[pointerStart.index];
  if(!line)return;
  const entries=[...activeFingers];
  const a=entries[0][1],b=entries[1][1],distance=fingerDist(a,b);
  if(distance<12)return;
  const mid=fingerMid(a,b),initial=atCanvas({clientX:mid.x,clientY:mid.y});
  if(!initial)return;
  stopHold();lastTap=null;lastOpened=Date.now();canvas.style.cursor='grabbing';
  pinch={ids:entries.map(p=>p[0]),index:pointerStart.index,distance,
   font:Math.max(6,Number(line.fontSize)||Math.round(line.h*H)),
   x:line.drawX??line.x,y:line.drawY??line.y,mid:initial,changed:false};
  pointerStart=null;
  for(const id of pinch.ids)canvas.setPointerCapture?.(id);
 };
 const resizePinch=event=>{
  if(!pinch||!pinch.ids.every(id=>activeFingers.has(id)))return;
  const a=activeFingers.get(pinch.ids[0]),b=activeFingers.get(pinch.ids[1]);
  const dist=fingerDist(a,b),factor=dist/pinch.distance;
  const midpoint=fingerMid(a,b),now=atCanvas({clientX:midpoint.x,clientY:midpoint.y});
  if(!now||!Number.isFinite(factor))return;
  const line=recognized[pinch.index];if(!line)return;
  const font=Math.round(clamp(pinch.font*factor,6,500)*10)/10;
  // Scale the phrase around the midpoint between fingers, not around the
  // top-left of the page. The original OCR erasure box is unchanged.
  const x=clamp(now.x+(pinch.x-pinch.mid.x)*factor,0,Math.max(0,1-line.w));
  const y=clamp(now.y+(pinch.y+line.h/2-pinch.mid.y)*factor-line.h/2,0,Math.max(0,1-line.h));
  const nextX=round4(x),nextY=round4(y);
  if(font===line.fontSize&&nextX===(line.drawX??line.x)&&nextY===(line.drawY??line.y))return;
  pinch.changed=true;
  line.fontSize=font;line.styled=true;line.drawX=nextX;line.drawY=nextY;
  event.preventDefault?.();
  draw();
 };
 const finishPinch=event=>{
  if(!pinch||!pinch.ids.includes(event.pointerId))return false;
  const wasChanged=pinch.changed;
  for(const id of pinch.ids)canvas.releasePointerCapture?.(id);
  pinch=null;pointerStart=null;stopHold();lastTap=null;
  ignoreTapUntil=Date.now()+700;lastOpened=Date.now();
  canvas.style.cursor='text';
  if(wasChanged)notice('Tamaño y posición ajustados con dos dedos. La vista previa y el PNG guardado mantienen el mismo tamaño.');
  event.preventDefault?.();
  return true;
 };
 canvas.addEventListener('pointerdown',event=>{
  activeFingers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(activeFingers.size===2){startPinch();if(pinch)event.preventDefault?.();return;}
  if(activeFingers.size!==1||Date.now()<ignoreTapUntil)return;
  stopHold();
  const point=atCanvas(event),index=findPhrase(point);
  pointerStart={id:event.pointerId,sx:event.clientX,sy:event.clientY,t:Date.now(),
   point,index,dragging:false,moved:false,
   x:index>=0?(recognized[index].drawX??recognized[index].x):0,
   y:index>=0?(recognized[index].drawY??recognized[index].y):0};
  if(index>=0&&typeof setTimeout==='function')holdTimer=setTimeout(()=>{
   const hold=pointerStart;
   if(!hold||hold.id!==event.pointerId||hold.index!==index||activeFingers.size!==1)return;
   hold.dragging=true;lastTap=null;canvas.style.cursor='grabbing';
   canvas.setPointerCapture?.(event.pointerId);
   notice('Frase agarrada. Arrástrala con el dedo; al soltar quedará en esa posición exacta.');
  },430);
 });
 canvas.addEventListener('pointermove',event=>{
  if(activeFingers.has(event.pointerId))activeFingers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pinch){if(pinch.ids.includes(event.pointerId))resizePinch(event);return;}
  const start=pointerStart;
  if(!start||start.id!==event.pointerId)return;
  if(!start.dragging){
   if(Math.hypot(event.clientX-start.sx,event.clientY-start.sy)>12){stopHold();pointerStart=null;}
   return;
  }
  event.preventDefault?.();
  moveTo(event,start);
 });
 canvas.addEventListener('pointerup',event=>{
  const pinching=finishPinch(event);
  activeFingers.delete(event.pointerId);
  if(pinching)return;
  const start=pointerStart;
  stopHold();pointerStart=null;
  if(!start||start.id!==event.pointerId||activeFingers.size>0||Date.now()<ignoreTapUntil)return;
  if(start.dragging){
   canvas.style.cursor='text';canvas.releasePointerCapture?.(event.pointerId);
   event.preventDefault?.();
   if(start.moved){
    draw();lastOpened=Date.now();
    notice('Posición actualizada en la vista previa. Al guardar se utilizarán exactamente las mismas coordenadas.');
   }
   return;
  }
  if(Math.hypot(event.clientX-start.sx,event.clientY-start.sy)>16)return;
  const point=atCanvas(event),index=findPhrase(point),now=Date.now();
  if(index<0){lastTap=null;if(!recognized.length)notice('Primero hay que identificar las frases. Pulsa «Reconocer frases».');return;}
  if(lastTap?.index===index&&now-lastTap.time<570&&Math.hypot(point.x-lastTap.point.x,point.y-lastTap.point.y)<.07){
   lastTap=null;openPhrase(index);event.preventDefault?.();
  }else{
   lastTap={index,time:now,point};
   notice('Frase seleccionada: '+recognized[index].text+'. Doble toque para editar, un dedo sostenido para mover o dos dedos para cambiar su tamaño.');
  }
 });
 canvas.addEventListener('pointercancel',event=>{
  finishPinch(event);activeFingers.delete(event.pointerId);
  stopHold();pointerStart=null;lastTap=null;canvas.style.cursor='text';
 });
 canvas.addEventListener('dblclick',event=>{
  if(Date.now()-lastOpened<650||Date.now()<ignoreTapUntil)return;
  const index=findPhrase(atCanvas(event));if(index>=0){event.preventDefault();openPhrase(index);}
 });
 $('recognize-photo').onclick=()=>recognizePreview().catch(e=>notice(e.message,true));
 $('download').onclick=async()=>{if(!original)return;try{const blob=await asBlob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='popup-alerta-1370x2048.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);notice('PNG generado con las dimensiones originales.');}catch(e){notice(e.message,true);}};
 $('apply').onclick=async()=>{if(!original)return;$('apply').disabled=true;notice('Guardando la imagen como borrador…');try{
  const blob=await asBlob(),file=new File([blob],'popup-alerta.png',{type:'image/png'});
  const uploaded=await api('editor/upload',file,true);
  const draft=await api('editor/data?site=wa');
  await api('editor/draft',{site:'wa',revision:draft.base,version:draft.version,changes:[
   {id:'welcome:photo',value:uploaded.asset},
   // The exported PNG already contains any text corrections baked into it.
   // Clear OCR overlays so they cannot be painted on the new image twice.
   {id:'welcome:layers',value:'[]'}
  ]});
  notice('Imagen guardada en el borrador del popup inicial. Regresa al editor y pulsa PUBLICAR para aplicar el cambio.');
 }catch(e){notice('No se guardó el borrador: '+e.message,true);}finally{$('apply').disabled=false;}};
 (async()=>{try{const me=await api('me');if(me.role!=='admin')throw Error('Acceso exclusivo para administradores.');csrf=me.csrf;$('tool').hidden=false;$('locked').hidden=true;const data=await api('editor/data?site=wa');const photo=data.fields?.find(f=>f.id==='welcome:photo')?.value;if(/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(photo||''))load(photo,'foto del popup inicial');else{$('source-status').textContent='Selecciona la imagen original para preservar exactamente el diseño.';notice('Falta la foto original. Selecciónala arriba para empezar.');}}catch(e){$('locked').textContent=e.message;}})();
})();