const $=id=>document.getElementById(id);
let state=null,timer=null,session=false,guideData=null,guideDevice=null,guideStep=0,currentView=null;
try{const saved=localStorage.getItem('guide-device');if(['android','iphone'].includes(saved))guideDevice=saved;}catch{}
async function api(path,data){const r=await fetch(`/api/${path}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok){const e=new Error(j.error||'No se pudo completar');e.status=r.status;throw e;}return j;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function show(id){currentView=id;for(const x of ['loading','welcome','connect','pairing','connected'])$(x).hidden=x!==id;$('guide').hidden=!['connect','pairing'].includes(id);if(id==='connect'&&!guideDevice)$('connect').hidden=true;}
async function refresh(){
  if(!session)return;
  try{
    state=await api('status');$('greeting').textContent=`Hola, ${state.name}.`;if(!$('phone').value)$('phone').value=state.phone;
    $('owner-actions').hidden=!state.consent;
    if(state.status==='connected'){
      show('connected');$('activity').textContent=state.paused?'Atención pausada':'Atención activa';$('pause').textContent=state.paused?'Reanudar atención':'Pausar atención';error('');
    }else if(state.status==='connecting' || state.code){
      show('pairing');$('code').textContent=state.code?state.code.slice(0,4)+' '+state.code.slice(4):'···· ····';$('copy').disabled=!state.code;
      $('expires').textContent=state.code?'Copia el código e introdúcelo en WhatsApp. Se renueva automáticamente.':'Preparando el código. Esto puede tardar un momento…';$('retry').hidden=true;updateGuideNext();
    }else{
      show('connect');if(state.consent)error('La cuenta no está conectada. Confirma tu número para volver a vincularla.');
    }
  }catch(e){session=false;clearInterval(timer);timer=null;show('welcome');$('owner-actions').hidden=true;if(e.status!==401)error(e.message);}
}
async function init(){
  try{
    const b=await api('branding');$('title').textContent=b.title;$('description').textContent=b.description;$('begin').textContent=b.button;
    if(b.logo){$('logo').src=b.logo;$('logo').hidden=false;$('mark').hidden=true;}
    if(/^#[0-9a-f]{6}$/i.test(b.color)){
      // Stylesheet changes use CSSOM rather than inline style attributes, under strict CSP.
      const sheet=[...document.styleSheets].find(s=>s.href?.endsWith('/style.css'));if(sheet)sheet.insertRule(`button:not(.danger):not(.secondary){background:${b.color}}`,sheet.cssRules.length);
    }
    try{guideData=await api('guides');renderGuide();}catch{}
    const invitation=location.hash.slice(1);history.replaceState(null,'',location.pathname);
    if(invitation)await api('access',{token:invitation});
    session=true;await refresh();if(session)timer=setInterval(refresh,3000);
  }catch(e){show('welcome');error(e.message);}
}
$('connect').addEventListener('submit',async event=>{
  event.preventDefault();error('');$('connect-button').disabled=true;
  try{
    const input={phone:$('phone').value,consent:$('consent').checked};
    if(!session){await api('register',input);session=true;clearInterval(timer);timer=setInterval(refresh,3000);}
    await api('connect',input);await refresh();
  }catch(e){error(e.message);}finally{$('connect-button').disabled=false;}
});
$('begin').onclick=()=>{error('');$('greeting').textContent='Conecta tu cuenta';show('connect');$('phone').focus();renderGuide();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.code);$('copy').textContent='✓ Código copiado';setTimeout(()=>$('copy').textContent='Copiar código',2000);}catch{error('Mantén pulsado el código y selecciona Copiar.');}};
$('pause').onclick=async()=>{try{await api('pause',{paused:!state.paused});await refresh();}catch(e){error(e.message);}};
$('disconnect').onclick=async()=>{if(!confirm('¿Quieres quitar al gestor el acceso a tu cuenta?'))return;try{await api('disconnect',{});session=false;clearInterval(timer);$('owner-actions').hidden=true;show('welcome');error('Cuenta desconectada. También puedes revisar tus dispositivos vinculados dentro de WhatsApp.');}catch(e){error(e.message);}};
function updateGuideNext(){
  if(!guideData||!guideDevice)return;
  const steps=guideData[guideDevice],current=steps?.[guideStep];
  $('guide-next').disabled=current?.id==='prepare'&&!state?.code&&state?.status!=='connected';
}
function renderGuide(){
  const steps=guideData?.[guideDevice];$('guide-choose').hidden=!!steps;$('guide-content').hidden=!steps;
  for(const device of ['android','iphone'])$('device-'+device).setAttribute('aria-pressed',String(guideDevice===device));
  if(!steps)return;guideStep=Math.max(0,Math.min(guideStep,steps.length-1));const step=steps[guideStep];
  $('guide-count').textContent=`PASO ${guideStep+1} DE ${steps.length}`;$('guide-device').textContent=guideDevice.toUpperCase();
  $('guide-title').textContent=step.title;$('guide-text').textContent=step.text;
  const image=$('guide-image'),video=$('guide-video');video.pause();image.hidden=true;video.hidden=true;
  const asset=step.asset,valid=typeof asset==='string'&&(/^\/guides\/(android|iphone)-(prepare|open|linked|number|approve)\.svg$/.test(asset)||/^\/guide-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(asset));
  if(valid){if(asset.endsWith('.mp4')){video.src=asset;video.hidden=false;video.play().catch(()=>{});}else{image.src=asset;image.alt=step.title;image.hidden=false;}}
  $('guide-art-note').hidden=!valid||!asset.startsWith('/guides/');
  $('guide-back').disabled=guideStep===0;$('guide-next').textContent=guideStep===steps.length-1?'COMPROBAR CONEXIÓN':'SIGUIENTE →';updateGuideNext();
}
for(const device of ['android','iphone'])$('device-'+device).onclick=()=>{guideDevice=device;guideStep=0;try{localStorage.setItem('guide-device',device);}catch{}if(currentView==='connect')show('connect');renderGuide();};
$('guide-back').onclick=()=>{guideStep--;renderGuide();};
$('guide-next').onclick=async()=>{if(guideStep<guideData[guideDevice].length-1){guideStep++;renderGuide();}else{await refresh();if(state?.status!=='connected')error('Todavía esperamos la confirmación de WhatsApp. Revisa el código actual y completa la vinculación dentro de la aplicación.');}};
init();
