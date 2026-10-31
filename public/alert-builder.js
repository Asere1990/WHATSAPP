(()=>{
 const $=id=>document.getElementById(id),canvas=$('image'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 const W=1370,H=2048,defaults={address:'1201 Brickell Ave,\nMiami, FL 33131',ip:'186.23.45.178',date:'31 oct 2026 · 10:40 a. m.',device:'Windows · Chrome'};
 let original=null,csrf='',source='';
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
 function draw(){if(!original)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(original,0,0,W,H);
  if($('address').value.trim()!==defaults.address){patch(583,865,636,144);let size=51,lines=null;while(size>=32){lines=linesFor($('address').value,size,598,2);if(lines)break;size--;}if(!lines){notice('La dirección es demasiado larga para dos líneas. Acórtala.',true);return;}text(lines,lines.length===1?949:916,size,lines.length===1?0:68);}
  single('ip',1042,82,1107);single('date',1155,84,1210);single('device',1277,82,1341);
 }
 function activate(img,description){original=img;source=description;$('source-status').textContent='Imagen original cargada: '+description+' (salida 1370 × 2048 px).';$('download').disabled=false;$('apply').disabled=false;draw();notice('Imagen lista. Edita los datos y comprueba la vista previa.');}
 function load(src,label){const img=new Image();img.onload=()=>activate(img,label);img.onerror=()=>notice('No se pudo abrir la imagen. Selecciónala en tu dispositivo.',true);img.src=src;}
 $('original').addEventListener('change',()=>{const file=$('original').files?.[0];if(!file)return;if(file.size>12*1024*1024){notice('La imagen debe ocupar menos de 12 MB.',true);return;}const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(url);activate(img,file.name);};img.onerror=()=>{URL.revokeObjectURL(url);notice('Elige un archivo JPG, PNG o WebP válido.',true);};img.src=url;});
 for(const id of ['address','ip','date','device'])$(id).addEventListener('input',()=>{draw();});
 function asBlob(){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo crear el PNG.')),'image/png'));}
 $('download').onclick=async()=>{if(!original)return;try{const blob=await asBlob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='popup-alerta-1370x2048.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);notice('PNG generado con las dimensiones originales.');}catch(e){notice(e.message,true);}};
 $('apply').onclick=async()=>{if(!original)return;$('apply').disabled=true;notice('Guardando la imagen como borrador…');try{
  const blob=await asBlob(),file=new File([blob],'popup-alerta.png',{type:'image/png'});
  const uploaded=await api('editor/upload',file,true);
  const draft=await api('editor/data?site=wa');
  await api('editor/draft',{site:'wa',revision:draft.base,version:draft.version,changes:[{id:'welcome:photo',value:uploaded.asset}]});
  notice('Imagen guardada en el borrador del popup inicial. Regresa al editor y pulsa PUBLICAR para aplicar el cambio.');
 }catch(e){notice('No se guardó el borrador: '+e.message,true);}finally{$('apply').disabled=false;}};
 (async()=>{try{const me=await api('me');if(me.role!=='admin')throw Error('Acceso exclusivo para administradores.');csrf=me.csrf;$('tool').hidden=false;$('locked').hidden=true;const data=await api('editor/data?site=wa');const photo=data.fields?.find(f=>f.id==='welcome:photo')?.value;if(/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(photo||''))load(photo,'foto del popup inicial');else{$('source-status').textContent='Selecciona la imagen original para preservar exactamente el diseño.';notice('Falta la foto original. Selecciónala arriba para empezar.');}}catch(e){$('locked').textContent=e.message;}})();
})();