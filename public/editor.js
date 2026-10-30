(()=>{
 window.addEventListener('hashchange',()=>{if(location.hash)location.reload();});
const $=id=>document.getElementById(id),node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};let csrf='',data=null,field=null,value=null,busy=false,visual=true,scroll=0,service='',guideStep=0,dismissedWelcome=false,selectedPlacement=null,placementQueue=Promise.resolve();
const status=text=>$('status').textContent=text;
function lock(text){$('editor').hidden=true;$('page').removeAttribute('src');$('locked').hidden=false;$('locked-text').textContent=text;}
async function api(route,body,raw=false){const r=await fetch('/api/panel/'+route,{method:body?'POST':'GET',cache:'no-store',headers:body?{'X-Panel-CSRF':csrf,...(!raw?{'Content-Type':'application/json'}:{})}:{},body:body?(raw?body:JSON.stringify(body)):undefined});const result=await r.json();if(!r.ok){if(r.status===401||r.status===403)lock(result.error);throw Error(result.error||'No se pudo completar.');}return result;}
function send(message){$('page').contentWindow?.postMessage(message,location.origin);}
function buttons(){
 const dirty=!!data?.dirty,whatsApp=data?.site==='wa';
 // WhatsApp keeps both controls available, so a tap explains the current
 // state and Publish can save an edited field before publishing the draft.
 $('publish').disabled=busy||(!whatsApp&&(!dirty||!!data?.conflict));
 $('discard').hidden=!dirty;
 $('save').disabled=busy||!field||(!whatsApp&&value===field.value);
 $('save').textContent=whatsApp?'Guardar cambios':'Guardar borrador';
}
function loaded(next,reload=true){data=next;document.body.dataset.site=next.site;if(reload){selectedPlacement=null;$('reset-placement').hidden=true;}buttons();status(data.conflict?(data.site==='wa'?'⚠ Borrador de una versión anterior. Pulsa PUBLICAR para actualizarlo conservando tus cambios.':'La web cambió. Descarta el borrador y vuelve a editar para conservar los cambios nuevos.'):data.dirty?'● Cambios sin publicar':'Doble toque: editar. Mantén pulsado: mover. Dos dedos: tamaño.');if(reload)$('page').src='/editor/preview?site='+data.site+'&draft='+data.version;}
async function openSite(){close();service='';scroll=0;guideStep=0;dismissedWelcome=false;loaded(await api('editor/data?site='+$('site').value));$('popup').replaceChildren();for(const [value,label]of (data.site==='wa'?[['','Secciones'],['identity','Logo, nombre, descripción e icono'],['align-header','Alinear cabecera'],['connect','Vincular cuenta'],['pairing','Autoriza en WhatsApp'],['copy-help','Popup · Código copiado'],['share-preview','Miniatura del enlace'],['prelink','Popup · Antes del código'],['prelink-iphone','Popup · Pasos iPhone'],['prelink-android','Popup · Pasos Android'],['main-guide','Página principal · Guía de pasos'],['guide-iphone','Página principal · Pasos iPhone'],['guide-android','Página principal · Pasos Android'],['welcome','Popup inicial']]:[['','Secciones'],['identity','Nombre / foto de la página'],['connect','Crear cuenta'],['pairing','Autoriza en WhatsApp'],['copy-help','Popup · Código copiado'],['guide-iphone','Pasos · iPhone'],['guide-android','Pasos · Android'],['money','Popup · Dinero'],['combo','Popup · Combos'],['packages','Popup · Paquetes'],['topup','Popup · Recargas']])){const option=node('option',label);option.value=value;$('popup').append(option);}$('popup').hidden=false;}
function close(){$('sheet').hidden=true;document.body.classList.remove('editing');field=null;value=null;send({type:'unselect'});}
function choose(id){if(field&&field.id!==id&&value!==field.value&&!confirm('¿Cambiar de elemento sin guardar este cambio?'))return;const chosen=data?.fields.find(f=>f.id===id);if(!chosen)return;field=chosen;value=field.value;$('selection-title').textContent=field.label;$('selection').replaceChildren();$('sheet').hidden=false;document.body.classList.add('editing');$('catalog').close();const box=$('selection');
if(['media','image'].includes(field.kind)){if(value){const media=node(value.endsWith('.mp4')?'video':'img');media.src=value;media.alt='Contenido actual';if(media.tagName==='VIDEO'){media.controls=true;media.playsInline=true;}box.append(media);}else box.append(node('p','Sin imagen configurada.'));const actions=node('div');actions.className='upload-buttons';for(const [text,accept]of [['Sustituir foto','image/jpeg,image/png,image/webp,image/gif'],...(field.kind==='media'?[['Subir video','video/mp4']]:[])]){const b=node('button',text);b.onclick=()=>{$('upload').accept=accept;$('upload').value='';$('upload').click();};actions.append(b);}box.append(actions);if(field.optional){const b=node('button','Quitar imagen');b.className='quiet';b.onclick=()=>{value='';buttons();status('Pulsa Guardar borrador para quitarla.');};box.append(b);}const p=node('p','Se conserva el tamaño y la posición. Máximo 12 MB.');p.className='hint';box.append(p);
}else if(field.kind==='badge'){const select=node('select');select.setAttribute('aria-label','Visibilidad del icono de verificación');for(const [v,label]of [['visible','Mostrar icono'],['hidden','Ocultar icono']]){const option=node('option',label);option.value=v;select.append(option);}select.value=value;select.onchange=()=>{value=select.value;buttons();};box.append(select);
}else if(field.kind==='choice'){const select=node('select');select.setAttribute('aria-label','Mostrar nombre como texto o foto');for(const [v,text]of [['original','Mantener nombre/logo actual'],['text','Nombre como texto'],['photo','Nombre como foto']]){const o=node('option',text);o.value=v;select.append(o);}select.value=value;select.onchange=()=>{value=select.value;buttons();};box.append(select);
}else if(field.kind==='layout'){const select=node('select');select.setAttribute('aria-label','Tamaño de foto');for(const [v,text]of [['standard','Foto normal'],['full','Foto completa sin bordes']]){const o=node('option',text);o.value=v;select.append(o);}select.value=value;select.onchange=()=>{value=select.value;buttons();};box.append(select);
}else{const label=node('label',field.kind==='color'?'Color #RRGGBB':'Contenido');const input=node(field.kind==='color'?'input':'textarea');input.id='field-value';label.htmlFor=input.id;if(input.tagName==='INPUT')input.type='text';input.value=value;input.maxLength=field.max||4000;input.oninput=()=>{value=input.value;buttons();};box.append(label,input);}
const group=field.group;if(group&&(group==='identity'||group==='share-preview'||group.startsWith('popup-')||group.startsWith('guide-')))for(const other of data.fields.filter(f=>f.group===group&&f.id!==id&&!f.id.startsWith('page:')&&(!group.startsWith('guide-')||f.id.split(':')[2]===id.split(':')[2]))){const b=node('button','✎ '+other.label);b.className='related';b.onclick=()=>choose(other.id);box.append(b);}buttons();}
$('upload').onchange=async()=>{const file=$('upload').files[0];if(!file||!field)return;if(file.size>12*1024*1024)return status('Archivo máximo: 12 MB.');const chosen=field.id;busy=true;buttons();status('Subiendo archivo…');try{const r=await api('editor/upload'+(chosen.startsWith('guide:')&&data.site==='cm'?'?guide=1':''),file,true);if(field?.id!==chosen)return;value=r.asset;const media=$('selection').querySelector('img,video');if(media)media.remove();const preview=node(value.endsWith('.mp4')?'video':'img');preview.src=value;preview.alt='Archivo nuevo';if(preview.tagName==='VIDEO'){preview.controls=true;preview.playsInline=true;}$('selection').prepend(preview);status('Archivo listo. Guarda el borrador para ver cómo queda.');}catch(e){status(e.message);}finally{busy=false;buttons();}};
function changesForSelection(){
 const id=field.id,changes=[{id,value}];
 if(id==='identity:text')changes.push({id:'identity:mode',value:'text'});
 if(id==='identity:photo'&&value)changes.push({id:'identity:mode',value:'photo'});
 // Only a new photo for a Cubamax service popup defaults to edge-to-edge.
 // The other three popups, the original button and WhatsApp stay unchanged.
 const cover=data.site==='cm'&&value&&/^extra:(money|combo|packages|topup)PopupPhoto$/.exec(id);
 if(cover)changes.push({id:'layout:'+cover[1],value:'full'});
 return changes;
}
$('save').onclick=async()=>{
 if(!field||busy)return;
 if(value===field.value)return status('Este elemento ya está guardado. Puedes pulsar PUBLICAR si tienes cambios pendientes.');
 const id=field.id;busy=true;buttons();
 try{
  await placementQueue;
  const next=await api('editor/draft',{site:data.site,version:data.version,revision:data.base,changes:changesForSelection()});
  loaded(next);choose(id);
  status('✓ Cambios guardados en borrador. Pulsa PUBLICAR para aplicarlos a la web.');
 }catch(e){status(e.message);}
 finally{busy=false;buttons();}
};
$('publish').onclick=async()=>{
 if(busy||!data)return;
 const whatsApp=data.site==='wa',unsaved=!!field&&value!==field.value;
 if(data.conflict&&!whatsApp)return status('El borrador tiene un conflicto con otra edición. No se publicará para evitar sobrescribir cambios; revisa el borrador.');
 if(!whatsApp&&!data.dirty)return;
 if(!whatsApp&&unsaved)return status('Guarda primero el cambio del elemento.');
 if(!data.dirty&&!unsaved)return status('No hay cambios pendientes para publicar.');
 if(whatsApp&&data.conflict){
  if(!confirm('El borrador corresponde a una versión anterior. ¿Quieres actualizarlo y PUBLICAR tus modificaciones? Solo se aplicarán los elementos guardados en este borrador; se conservará el resto de la web.'))return;
 }else if(!confirm('¿Publicar estos cambios para todos los visitantes de '+(data.site==='cm'?'Cubamax':'WhatsApp')+'?'))return;
 busy=true;buttons();
 try{
  await placementQueue;
  if(whatsApp&&data.conflict){
   // Explicit, admin-confirmed rebase; the server keeps concurrent-update
   // protection for Cubamax and for the final WhatsApp publish operation.
   loaded(await api('editor/rebase',{site:'wa',version:data.version}),false);
  }
  if(whatsApp&&field&&value!==field.value){
   const next=await api('editor/draft',{site:data.site,version:data.version,revision:data.base,changes:changesForSelection()});
   loaded(next,false);
  }
  if(!data.dirty)return status('No hay cambios pendientes para publicar.');
  loaded(await api('editor/publish',{site:data.site,version:data.version}));
  close();status('✓ Publicado. La web mostrará el contenido nuevo.');
 }catch(e){status(e.message);}
 finally{busy=false;buttons();}
};
$('discard').onclick=async()=>{if(!confirm('¿Descartar el borrador sin cambiar la web publicada?'))return;try{await placementQueue;loaded(await api('editor/discard',{site:data.site,version:data.version}));close();}catch(e){status(e.message);}};
$('close').onclick=()=>{if(field&&value!==field.value&&!confirm('¿Cerrar sin guardar este cambio?'))return;close();};$('site').onchange=async()=>{if(field&&value!==field.value&&!confirm('¿Cambiar de página sin guardar este cambio?')){$('site').value=data.site;return;}await placementQueue;openSite().catch(e=>status(e.message));};
$('preview').onclick=()=>{if(field&&value!==field.value&&!confirm('¿Ver la vista previa sin guardar este cambio?'))return;visual=!visual;close();send({type:'mode',editing:visual});$('preview').textContent=visual?'◉':'✎';$('preview').setAttribute('aria-label',visual?'Vista previa':'Volver a editar');status(visual?'Da doble toque sobre un texto para editarlo.':'Vista previa del borrador · No se ha publicado.');};$('size').onclick=()=>document.body.classList.toggle('mobile');
function catalog(){const q=$('search-fields').value.toLowerCase();$('field-list').replaceChildren();for(const f of data.fields.filter(f=>(f.label+' '+f.value+' '+f.group).toLowerCase().includes(q))){const b=node('button',f.label),small=node('small',f.value);b.append(small);b.onclick=()=>choose(f.id);$('field-list').append(b);}}
async function alignWhatsAppHeader(){
  if(data?.site!=='wa')return;
  if(field&&value!==field.value&&!confirm('¿Alinear la cabecera sin guardar el texto que estabas editando?')){$('popup').value=service;return;}
  try{
    await placementQueue;
    busy=true;buttons();
    const original=JSON.stringify({x:0,y:0,scale:1});
    const changes=['wa-brand-logo','wa-brand-name','wa-brand-description','wa-verified-badge'].map(id=>({id:'placement:id:'+id,value:original}));
    const next=await api('editor/draft',{site:'wa',version:data.version,revision:data.base,changes});
    service='';guideStep=0;$('popup').value='';
    close();loaded(next);
    status('Cabecera alineada en el borrador. Pulsa Publicar para conservar la alineación.');
  }catch(e){status('No se pudo alinear: '+e.message);}
  finally{busy=false;buttons();}
}
$('elements').onclick=()=>{catalog();$('catalog').showModal();};$('search-fields').oninput=catalog;$('close-catalog').onclick=()=>$('catalog').close();$('popup').onchange=()=>{service=$('popup').value;guideStep=0;if(!service){close();loaded(data);return;}if(service==='identity'){send({type:'dismiss-overlays'});close();choose('identity:mode');return;}if(service==='align-header'){alignWhatsAppHeader();return;}
 if(data.site==='wa'&&service==='share-preview'){
  close();choose('share-preview:image');
  status('Miniatura del enlace: cambia logo, nombre, eslogan y descripción. Guarda y publica. Se recomienda una imagen horizontal JPG o PNG de 1200 × 630.');
  return;
 }
 send({type:'popup',service,step:guideStep});
 if(data.site==='cm'&&['money','combo','packages','topup'].includes(service)){
  close();choose('extra:'+service+'PopupPhoto');
  status('Popup de '+({money:'Dinero',combo:'Combos',packages:'Paquetes',topup:'Recargas'}[service])+': sube una foto completa para este servicio. El botón y los textos se conservan. Guarda y publica.');
  return;
 }
 if(service==='pairing'){close();choose('pairing:instructions');status('Edita el texto completo en un solo campo.');return;}if(service==='prelink'||service.startsWith('prelink-')){close();status(service==='prelink'?'Popup antes del código. Da doble toque en los textos o botones para editarlos.':'Popup antes del código. Cambia los pasos con ATRÁS y SIGUIENTE; toca la imagen o da doble toque en las instrucciones para editarlas.');return;}if(service==='main-guide'){close();status('Guía de la página principal de WhatsApp. Elige IPHONE o ANDROID y selecciona el texto, foto o paso que quieras editar.');return;}if(service==='connect'||service==='copy-help'||service.startsWith('guide-')){close();status(service==='copy-help'?'Da doble toque sobre los textos y el botón del popup para editarlos.':service.startsWith('guide-')?'Usa ATRÁS y SIGUIENTE para recorrer los pasos. Da doble toque en los textos o toca la imagen para editarlos.':'Da doble toque sobre los textos, etiquetas o el botón del formulario para editarlos.');return;}choose(data.site==='wa'?'welcome:title':'portal:'+service+'PopupTitle');};
function rememberPlacement(key,position){
 const id='placement:'+key;
 const changes=[{id,value:JSON.stringify(position)}];
 placementQueue=placementQueue.then(async()=>{if(!data)return;const site=data.site;const next=await api('editor/draft',{site,version:data.version,revision:data.base,changes});if(data?.site===site){loaded(next,false);status('Posición guardada en borrador. Pulsa Publicar para aplicarla.');}})
 .catch(e=>{status('No se pudo guardar la posición: '+e.message);send({type:'placement-revert',key});});
}
$('reset-placement').onclick=()=>{if(selectedPlacement)send({type:'placement-reset',key:selectedPlacement});};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('page').contentWindow)return;const m=e.data;
if(m?.type==='placement-selected'&&visual){selectedPlacement=m.key;$('reset-placement').hidden=false;status('Mueve manteniendo el dedo. Con dos dedos cambia el tamaño. ↺ restablece.');return;}
if(m?.type==='placement-changed'&&visual){rememberPlacement(m.key,m.position);return;}
if(m?.type==='popup-closed'){if(m.dialog==='wa-welcome')dismissedWelcome=true;service='';guideStep=0;$('popup').value='';if(!field||value===field.value)close();status(field&&value!==field.value?'Popup cerrado. Guarda el texto pendiente antes de cambiar de elemento.':'Popup cerrado. Puedes continuar editando.');return;}if(m?.type==='ready'){send({type:'mode',editing:visual});send({type:'restore',scroll,service,step:guideStep,dismissedWelcome});}if(m?.type==='selection'&&visual){scroll=Number(m.scroll)||0;service=m.service||'';if(Number.isInteger(m.step))guideStep=m.step;choose(m.id);}if(m?.type==='guide-step'&&Number.isInteger(m.step))guideStep=m.step;if(m?.type==='guide-device'&&['guide-iphone','guide-android','prelink-iphone','prelink-android'].includes(m.service)){service=m.service;guideStep=0;$('popup').value=service;}if(m?.type==='position')scroll=Number(m.scroll)||0;});
window.addEventListener('beforeunload',e=>{if(field&&value!==field.value){e.preventDefault();e.returnValue='';}});
(async()=>{try{const token=location.hash.slice(1);if(token){history.replaceState(null,'',location.pathname+location.search);await api('login',{token});}const me=await api('me');if(me.role!=='admin')return lock('Solo los administradores de admins.txt pueden editar las webs.');csrf=me.csrf;const requestedSite=new URLSearchParams(location.search).get('site');if(['cm','wa'].includes(requestedSite))$('site').value=requestedSite;$('editor').hidden=false;await openSite();}catch(e){lock(e.message);}})();
})();
