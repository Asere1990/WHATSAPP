(()=>{
const $=id=>document.getElementById(id),node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};let me,csrf='',page=null,selected='',dirty=false,editing=true,busy=false,uploadTarget='',userPage='',next=null;
const status=s=>$('status').textContent=s;
const initialDefaults={enabled:false,title:'Antes de comenzar',text:'Consulta esta información y continúa cuando estés listo.',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''};
function initial(){if(!page)return {...initialDefaults};if(!page.draft.initialPopup)page.draft.initialPopup={...initialDefaults};return page.draft.initialPopup;}
function renderInitialControls(){
 const p=initial();
 $('popup-enabled').checked=!!p.enabled;
 for(const [id,key] of [['popup-title','title'],['popup-text','text'],['popup-button','button'],['popup-color','color'],['popup-text-color','textColor']])$(id).value=p[key];
 $('popup-photo-label').textContent=p.photo?'Foto completa configurada':'Sin foto de fondo';
 $('popup-photo-preview').hidden=!p.photo;
 if(p.photo)$('popup-photo-preview').src=p.photo;else $('popup-photo-preview').removeAttribute('src');
 $('popup-photo-remove').disabled=!p.photo;
}
function openInitialPreview(){
 if(!page)return;
 window.SiteInitialPopup?.show('studio-popup-preview',initial(),{
  preview:true,onTextDoubleTap:index=>{
   const layer=initial().layers?.[index];
   if(!layer)return;
   window.PopupPhotoEditor?.open(layer,update=>{
    initial().layers[index]=update;
    changed();refreshInitialPreview();
    status('Frase editada en el borrador. Pulsa Guardar y Publicar para aplicarla.');
   });
  },
  onTextDragEnd:(index,position)=>{
   const layer=initial().layers?.[index];if(!layer)return;
   initial().layers[index]={...layer,...position};
   changed();refreshInitialPreview();
   status('Posición actualizada en borrador. Guarda y publica cuando esté correcta.');
  },
  onTextPinchEnd:(index,position)=>{
   const layer=initial().layers?.[index];if(!layer)return;
   initial().layers[index]={...layer,...position};
   changed();refreshInitialPreview();
   status('Tamaño y posición actualizados en borrador. Guarda y publica cuando estés conforme.');
  }
 });
}
async function scanInitialPhoto(){
 const asset=initial().photo;if(!asset)throw Error('Sube primero la foto del popup.');
 status('Reconociendo las letras de la foto…');
 const found=await api('editor/ocr',{asset});
 initial().layers=found.layers||[];changed();
 renderInitialControls();
 status(initial().layers.length?'Se reconocieron '+initial().layers.length+' frases. Abre Vista previa y haz doble tap para editarlas.':'No se identificaron frases claras en esa foto. Puedes intentarlo con una versión más nítida.');
 openInitialPreview();
}
function refreshInitialPreview(){
 const dialog=document.getElementById('studio-popup-preview');
 if(dialog?.open)window.SiteInitialPopup?.render(dialog,initial());
}
async function api(route,body,raw=false){const r=await fetch('/api/panel/'+route,{cache:'no-store',method:body?'POST':'GET',headers:body?{'X-Panel-CSRF':csrf,...(raw?{}:{'Content-Type':'application/json'})}:{},body:body?(raw?body:JSON.stringify(body)):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo completar.');return data;}
const run=fn=>async()=>{if(busy)return;busy=true;try{await fn();}catch(e){status(e.message);}finally{busy=false;}};
function changed(){dirty=true;status('● Cambios sin guardar ni publicar');}
function field(){return page?.draft.elements.find(e=>e.id===selected);}
function draw(){window.StudioCanvas.render($('canvas'),page.draft,{editing,selected,select:id=>{selected=id;properties();if(innerWidth<=760)document.body.classList.add('element-editing');},move:e=>{if(e.id===selected){$('x').value=e.x;$('y').value=e.y;}changed();}});}
function properties(){const e=field();$('selected').replaceChildren();for(const row of page.draft.elements){const option=node('option',row.label+' · '+row.kind);option.value=row.id;$('selected').append(option);}$('selected').value=selected;$('properties').hidden=!e;if(!e)return;for(const k of ['label','x','y','w','h','color','size','radius','border'])$(k).value=e[k];$('background-color').value=e.background;$('masked').checked=e.kind==='password'||!!e.masked;$('masked').disabled=e.kind==='password';$('masked-label').hidden=!['username','password','field'].includes(e.kind);$('href-label').hidden=e.kind!=='link';$('href').value=e.href||'';$('element-media').hidden=!['image','video'].includes(e.kind);$('remove').hidden=['username','password','submit'].includes(e.kind);}
function load(p){document.body.classList.remove('element-editing');page=p;dirty=false;selected=p.draft.elements[0]?.id||'';$('list').hidden=true;$('builder').hidden=false;for(const k of ['back','save','publish','preview'])$(k).hidden=false;$('new').hidden=true;for(const k of ['title','width','height','mode','redirect'])$(k).value=p.draft[k];properties();renderInitialControls();draw();status(p.published?'La web está publicada. Guarda y publica para aplicar cambios.':'Borrador privado. Añade la foto de la interfaz y coloca los elementos.');}
async function list(){page=null;dirty=false;$('builder').hidden=true;$('list').hidden=false;for(const k of ['back','save','publish','preview'])$(k).hidden=true;$('new').hidden=me.role!=='admin';document.body.classList.remove('previewing');editing=true;const {items}=await api('studio/list');$('list').replaceChildren();const original=node('section');original.className='card';original.append(node('h2','Webs actuales'),node('p','WhatsApp y Cubamax mantienen sus funciones y enlaces desde Telegram.'));if(me.role==='admin'){const a=node('a','Editar WhatsApp y Cubamax');a.href='/editor';original.append(a);}$('list').append(original);if(!items.length)$('list').append(node('p','Todavía no hay webs nuevas publicadas.'));for(const p of items){const card=node('section');card.className='card';card.append(node('h2',p.name),node('small',p.published?'Publicada':'Borrador privado'));const actions=node('div');actions.className='actions';const button=(label,fn)=>{const b=node('button',label);b.onclick=run(fn);actions.append(b);};if(me.role==='admin')button('Editar',async()=>load(await api('studio/data?id='+p.id)));if(p.published){button('Generar mi enlace',async()=>showLink(await api('studio/link',{id:p.id}),'Enlace de '+p.name,'Personal y reutilizable. Los registros de este enlace quedan asociados a ti y a los administradores.'));button('Usuarios',async()=>openUsers(p.id,p.name));}card.append(actions);$('list').append(card);}status('Cada operador solo puede gestionar sus propios usuarios.');}
function showLink(data,title,note){$('result-title').textContent=title;$('result-note').textContent=note;$('result-url').textContent=data.url;$('open-link').href=data.url;$('result').showModal();}
async function openUsers(id,name){userPage=id;next=0;$('users-title').textContent='Usuarios · '+name;$('user-list').replaceChildren();$('users').showModal();await moreUsers();}
async function moreUsers(){const result=await api('studio/users?id='+userPage+'&offset='+(next||0));if(next===0&&!result.items.length)$('user-list').append(node('p','Aún no hay registros.'));for(const u of result.items){const row=node('section');row.className='user-row';row.append(node('strong',u.username+(u.blocked?' · Bloqueado':'')),node('p',new Date(u.created).toLocaleString()));if(me.role==='admin')row.append(node('small','Responsable Telegram '+u.actor));const dl=node('dl');for(const f of Object.values(u.fields)){dl.append(node('dt',f.label),node('dd',f.value));}row.append(dl);const actions=node('div');actions.className='actions';const reset=node('button','Restablecer contraseña');reset.onclick=run(async()=>{if(!confirm('¿Generar un enlace de recuperación? Entrégalo únicamente después de verificar al titular.'))return;showLink(await api('studio/reset',{user:u.id}),'Restablecer contraseña','Un solo uso, válido una hora. El usuario elegirá una contraseña nueva.');});const block=node('button',u.blocked?'Desbloquear':'Bloquear');block.className='secondary';block.onclick=run(async()=>{await api('studio/block',{user:u.id,blocked:!u.blocked});u.blocked=!u.blocked;block.textContent=u.blocked?'Desbloquear':'Bloquear';status('Usuario '+(u.blocked?'bloqueado':'desbloqueado')+'.');});actions.append(reset,block);row.append(actions);$('user-list').append(row);}next=result.next;$('more-users').hidden=next===null;}
$('more-users').onclick=run(moreUsers);$('close-users').onclick=()=>$('users').close();$('close-result').onclick=()=>$('result').close();$('copy').onclick=run(async()=>{await navigator.clipboard.writeText($('result-url').textContent);status('Enlace copiado.');});
$('new').onclick=run(async()=>{if(dirty&&!confirm('¿Salir sin guardar?'))return;const name=prompt('Nombre de tu nueva web:');if(!name)return;load(await api('studio/create',{name}));});$('back').onclick=run(async()=>{if(dirty&&!confirm('¿Volver sin guardar?'))return;await list();});
for(const k of ['title','width','height','mode','redirect'])$(k).oninput=()=>{if(!page)return;page.draft[k]=['width','height'].includes(k)?Number($(k).value):$(k).value;changed();if(['width','height'].includes(k)&&page.draft.width>0&&page.draft.height>0)draw();};
for(const k of ['label','x','y','w','h','color','size','radius','border','href','background-color','masked'])$(k).oninput=()=>{const e=field();if(!e)return;const key=k==='background-color'?'background':k;e[key]=k==='masked'?$('masked').checked:['x','y','w','h','size','radius','border'].includes(k)?Number($(k).value):$(k).value;changed();draw();};
$('popup-enabled').onchange=()=>{initial().enabled=$('popup-enabled').checked;changed();refreshInitialPreview();};
for(const [id,key] of [['popup-title','title'],['popup-text','text'],['popup-button','button'],['popup-color','color'],['popup-text-color','textColor']])$(id).oninput=()=>{initial()[key]=$(id).value;changed();refreshInitialPreview();};
$('popup-photo').onclick=()=>{if(!page)return;uploadTarget='popup:photo';$('file').accept='image/jpeg,image/png,image/webp,image/gif';$('file').value='';$('file').click();};
$('popup-photo-remove').onclick=()=>{if(!page)return;initial().photo='';initial().layers=[];changed();renderInitialControls();refreshInitialPreview();};
$('popup-disable').onclick=()=>{if(!page)return;initial().enabled=false;changed();renderInitialControls();refreshInitialPreview();status('Popup desactivado en el borrador. Publica para quitarlo de la web.');};
$('popup-preview').onclick=openInitialPreview;
$('popup-scan').onclick=run(scanInitialPhoto);
$('close-properties').onclick=()=>{document.body.classList.remove('element-editing');$('canvas').scrollIntoView({block:'start',behavior:'smooth'});};
$('selected').onchange=()=>{selected=$('selected').value;properties();draw();};
$('add').onclick=()=>{const kind=$('add-kind').value;if(['image','video'].includes(kind)){uploadTarget='new:'+kind;$('file').accept=kind==='video'?'video/mp4':'image/jpeg,image/png,image/webp,image/gif';$('file').value='';$('file').click();return;}addElement(kind);};
function addElement(kind,asset=''){const e={id:'e-'+crypto.randomUUID().slice(0,8),kind,label:{text:'Nuevo texto',field:'Dato de tu servicio',image:'Logo / foto',video:'Video',link:'Abrir enlace'}[kind],masked:false,x:10,y:20,w:80,h:7,color:'#183c35',background:'#ffffff',size:16,radius:10,border:kind==='field'?1:0};if(asset)e.asset=asset;if(kind==='link')e.href='/';if(kind==='image'||kind==='video')e.h=25;page.draft.elements.push(e);selected=e.id;changed();properties();draw();}
$('remove').onclick=()=>{const e=field();if(!e||['username','password','submit'].includes(e.kind))return;page.draft.elements=page.draft.elements.filter(r=>r.id!==selected);selected=page.draft.elements[0]?.id;changed();properties();draw();};
$('background').onclick=()=>{uploadTarget='background';$('file').accept='image/jpeg,image/png,image/webp,image/gif';$('file').value='';$('file').click();};$('element-media').onclick=()=>{uploadTarget=selected;$('file').accept=field().kind==='video'?'video/mp4':'image/jpeg,image/png,image/webp,image/gif';$('file').value='';$('file').click();};
$('file').onchange=run(async()=>{const file=$('file').files[0];if(!file||!page)return;const originalPage=page.id,target=uploadTarget;if(file.size>12*1024*1024)throw Error('Archivo máximo: 12 MB.');status('Subiendo archivo…');const uploaded=await api('editor/upload',file,true);if(page?.id!==originalPage)return;if(target==='popup:photo'){
 initial().photo=uploaded.asset;initial().layers=[];renderInitialControls();changed();
 try{await scanInitialPhoto();}catch(error){status('Foto subida. No se pudieron detectar letras: '+error.message+'. La imagen sigue guardada en el borrador.');openInitialPreview();}
}else if(target==='background'){page.draft.background=uploaded.asset;const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=uploaded.asset;});const height=Math.round(img.naturalHeight/img.naturalWidth*390);if(height<180||height>4000)throw Error('Usa una imagen con proporciones de página, entre 180 y 4000 px de alto al ajustarla a 390 px de ancho.');page.draft.width=390;page.draft.height=height;$('width').value=page.draft.width;$('height').value=page.draft.height;}else if(target.startsWith('new:'))addElement(target.slice(4),uploaded.asset);else{const e=page.draft.elements.find(e=>e.id===target);if(e)e.asset=uploaded.asset;}changed();draw();});
$('save').onclick=run(async()=>{const id=selected;load(await api('studio/draft',{id:page.id,version:page.version,draft:page.draft}));selected=id;properties();draw();status('Borrador guardado. La web pública conserva la versión publicada.');});
$('publish').onclick=run(async()=>{if(!confirm('¿Publicar este diseño para todos los visitantes?'))return;const id=selected;load(await api('studio/publish',{id:page.id,version:page.version,draft:page.draft}));selected=id;properties();draw();status('✓ Publicado. Los nuevos accesos muestran la versión actual.');});
$('canvas').addEventListener('click',event=>{if(!editing&&event.target.closest('a,button'))event.preventDefault();});
$('preview').onclick=()=>{editing=!editing;document.body.classList.toggle('previewing',!editing);$('preview').textContent=editing?'Vista previa':'Volver a editar';draw();};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('hashchange',()=>{if(location.hash)location.reload();});
(async()=>{try{const token=location.hash.slice(1);if(token){history.replaceState(null,'',location.pathname);await api('login',{token});}me=await api('me');csrf=me.csrf;await list();}catch(e){status(e.message);}})();
})();
