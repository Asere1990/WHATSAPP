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
  for(const line of getLayers()){
   if(line.text===line.original&&!line.styled&&
     (line.drawX??line.x)===line.x&&(line.drawY??line.y)===line.y)continue;
   const x=limit(Math.round(line.x*W),0,W-1),y=limit(Math.round(line.y*H),0,H-1),
    right=limit(Math.ceil((line.x+line.w)*W),x+1,W),
    bottom=limit(Math.ceil((line.y+line.h)*H),y+1,H);
   const w=right-x,h=bottom-y;
   try{
    for(let py=y;py<bottom;py++){
     const left=ctx.getImageData(limit(x-3,0,W-1),py,1,1).data,
      rightSide=ctx.getImageData(limit(right+2,0,W-1),py,1,1).data;
     const gradient=ctx.createLinearGradient(x,py,right,py);
     gradient.addColorStop(0,'rgb('+left[0]+','+left[1]+','+left[2]+')');
     gradient.addColorStop(1,'rgb('+rightSide[0]+','+rightSide[1]+','+rightSide[2]+')');
     ctx.fillStyle=gradient;ctx.fillRect(x,py,w,1);
    }
   }catch{continue;}
   const phrase=String(line.text||'').trim();if(!phrase)continue;
   const family=['Arial','Helvetica','Verdana','Georgia','Times New Roman','system-ui'].includes(line.family)?line.family:'Arial';
   const weight=['400','500','600','700','800','900'].includes(String(line.weight))?String(line.weight):'700';
   // The entered font size is in real 1370x2048 photo pixels. Never
   // auto-shrink to the OCR rectangle: it made size changes invisible.
   const size=limit(Number(line.fontSize)||h,6,500);
   const drawX=limit(Math.round((line.drawX??line.x)*W),0,W-1);
   const drawY=limit(Math.round((line.drawY??line.y)*H),0,H-1);
   ctx.font=weight+' '+size+'px "'+family+'"';
   let brightness=0;try{
    const sample=ctx.getImageData(limit(x+2,0,W-1),limit(y+1,0,H-1),1,1).data;
    brightness=sample[0]*0.21+sample[1]*0.72+sample[2]*0.07;
   }catch{}
   ctx.textBaseline='middle';ctx.textAlign='left';
   ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(line.color||'')?line.color:brightness>170?'#151515':'#ffffff';
   ctx.fillText(phrase,drawX+2,drawY+h/2);
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
 const stopHold=()=>{
  if(holdTimer!=null&&typeof clearTimeout==='function')clearTimeout(holdTimer);
  holdTimer=null;
 };
 const moveTo=(event,start)=>{
  const nowPoint=atCanvas(event),first=start?.point;
  if(!nowPoint||!first)return;
  const line=recognized[start.index];if(!line)return;
  const limit=(v,a,b)=>Math.max(a,Math.min(b,v));
  line.drawX=Math.round(limit(start.x+nowPoint.x-first.x,0,Math.max(0,1-line.w))*10000)/10000;
  line.drawY=Math.round(limit(start.y+nowPoint.y-first.y,0,Math.max(0,1-line.h))*10000)/10000;
  start.moved=start.moved||line.drawX!==start.x||line.drawY!==start.y;
  draw(); // The SAME 1370x2048 canvas is used for preview and exported PNG.
 };
 canvas.addEventListener('pointerdown',event=>{
  stopHold();
  const point=atCanvas(event),index=findPhrase(point);
  pointerStart={id:event.pointerId,sx:event.clientX,sy:event.clientY,t:Date.now(),
   point,index,dragging:false,moved:false,
   x:index>=0?(recognized[index].drawX??recognized[index].x):0,
   y:index>=0?(recognized[index].drawY??recognized[index].y):0};
  if(index>=0&&typeof setTimeout==='function')holdTimer=setTimeout(()=>{
   const hold=pointerStart;
   if(!hold||hold.id!==event.pointerId||hold.index!==index)return;
   hold.dragging=true;lastTap=null;canvas.style.cursor='grabbing';
   canvas.setPointerCapture?.(event.pointerId);
   notice('Frase agarrada. Arrástrala con el dedo; al soltar quedará en esa posición exacta.');
  },430);
 });
 canvas.addEventListener('pointermove',event=>{
  const start=pointerStart;
  if(!start||start.id!==event.pointerId)return;
  if(!start.dragging){
   if(Math.hypot(event.clientX-start.sx,event.clientY-start.sy)>12){
    stopHold();pointerStart=null;
   }
   return;
  }
  event.preventDefault?.();
  moveTo(event,start);
 });
 canvas.addEventListener('pointerup',event=>{
  const start=pointerStart;
  stopHold();pointerStart=null;
  if(!start||start.id!==event.pointerId)return;
  if(start.dragging){
   canvas.style.cursor='text';
   canvas.releasePointerCapture?.(event.pointerId);
   event.preventDefault?.();
   if(start.moved){
    draw();
    lastOpened=Date.now(); // avoid a dblclick from the drag release
    notice('Posición actualizada en la vista previa. Al guardar se utilizarán exactamente las mismas coordenadas.');
   }
   return;
  }
  if(Math.hypot(event.clientX-start.sx,event.clientY-start.sy)>16)return;
  const point=atCanvas(event),index=findPhrase(point),now=Date.now();
  if(index<0){lastTap=null;if(!recognized.length)notice('Primero hay que identificar las frases. Pulsa «Reconocer frases».');return;}
  if(lastTap?.index===index&&now-lastTap.time<570&&Math.hypot(point.x-lastTap.point.x,point.y-lastTap.point.y)<.07){
   lastTap=null;openPhrase(index);event.preventDefault?.();
  }else{lastTap={index,time:now,point};notice('Frase seleccionada: '+recognized[index].text+'. Tócala otra vez para editarla o mantenla presionada para moverla.');}
 });
 canvas.addEventListener('pointercancel',()=>{
  stopHold();pointerStart=null;lastTap=null;canvas.style.cursor='text';
 });
 canvas.addEventListener('dblclick',event=>{
  if(Date.now()-lastOpened<650)return;
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