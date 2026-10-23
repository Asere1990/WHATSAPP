const $=id=>document.getElementById(id);
for(const c of countryList){const option=document.createElement('option');option.value=c.code;option.textContent=`${c.flag} ${c.name} (+${c.dial})`;$('country').appendChild(option);}
function selectedCountry(){return countryList.find(c=>c.code===$('country').value);}
function updateDial(){const c=selectedCountry();$('dial-code').textContent=c?'+'+c.dial:'—';}
$('country').addEventListener('change',()=>{updateDial();$('phone').focus();});
function clearConnectionForm(){ $('country').value='';updateDial();$('phone').value='';$('consent').checked=false; }
clearConnectionForm();
let state=null,timer=null,session=false,guideData=null,guideDevice=null,guideStep=0,currentView=null,addingAccount=false,connectionEpoch=0,submitBusy=false,retryAfter=0,blockedNumber=null;
try{const saved=localStorage.getItem('guide-device');if(['android','iphone'].includes(saved))guideDevice=saved;}catch{}
async function api(path,data){
  let r;try{r=await fetch(`/api/${path}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});}
  catch{const e=new Error('No se pudo conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.');e.code='NETWORK';throw e;}
  let j;try{j=await r.json();if(!j||typeof j!=='object')throw Error();}
  catch{const e=new Error('No se pudo leer la respuesta del servicio. Recarga la página e inténtalo de nuevo.');e.code='API_RESPONSE';throw e;}
  if(!r.ok){const e=new Error(typeof j.error==='string'?j.error:'No se pudo completar la operación. Inténtalo de nuevo.');e.status=r.status;throw e;}return j;
}
function userError(e){
  if(['SyntaxError','InvalidStateError','SecurityError'].includes(e?.name)||/string did not match|expected pattern|unexpected token/i.test(e?.message||''))return 'No se pudo preparar la conexión. Recarga la página e inténtalo de nuevo.';
  if(e?.name==='TypeError'||e?.name==='NetworkError')return 'No se pudo conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.';
  const message=e?.message||'';
  return /^(Selecciona|Escribe|Usa|Confirma|No |La |El |Este |Estamos|Espera|Se |Abre|Conecta|Falta)/.test(message)?message:'No se pudo completar la operación. Recarga la página e inténtalo de nuevo.';
}
function error(message,{attention=true}={}){const box=$('error'),changed=box.hidden||box.textContent!==message;box.textContent=message;box.hidden=!message;if(message&&changed&&attention){box.scrollIntoView?.({behavior:'smooth',block:'center'});box.focus({preventScroll:true});}}
function resetNumberError(){error('');if(blockedNumber){blockedNumber=null;$('connect-button').disabled=Date.now()<retryAfter;$('connect-button').textContent=Date.now()<retryAfter?'Espera un minuto':'Obtener código';}}
$('phone').addEventListener('input',resetNumberError);$('country').addEventListener('change',resetNumberError);
function show(id){currentView=id;for(const x of ['loading','welcome','connect','pairing','connected'])$(x).hidden=x!==id;$('guide').hidden=!['connect','pairing'].includes(id);if(id==='connect'&&!guideDevice)$('connect').hidden=true;}
async function refresh(){
  if(!session||addingAccount)return;
  const epoch=connectionEpoch;
  try{
    const next=await api('status');if(epoch!==connectionEpoch||addingAccount)return;state=next;$('greeting').textContent='Conecta tu cuenta';
    $('owner-actions').hidden=!state.consent;
    $('connected-account').textContent=`${state.name} · ${state.phone}`;
    $('pairing-account').textContent=`Número que estás vinculando: ${state.phone}`;
    if(state.status==='connected'){
      show('connected');$('activity').textContent=state.paused?'Atención pausada':'Atención activa';$('pause').textContent=state.paused?'Reanudar atención':'Pausar atención';error('');
    }else if(state.status==='connecting' || state.code){
      show('pairing');$('code').textContent=state.code?state.code.slice(0,4)+' '+state.code.slice(4):'···· ····';$('copy').disabled=!state.code;
      $('expires').textContent=state.code?'Copia el código e introdúcelo en WhatsApp. Se renueva automáticamente.':'Preparando el código. Esto puede tardar un momento…';$('retry').hidden=true;updateGuideNext();
    }else{
      show('connect');
    }
  }catch(e){if(epoch!==connectionEpoch||addingAccount)return;session=false;clearInterval(timer);timer=null;show('welcome');$('owner-actions').hidden=true;if(e.status!==401)error(userError(e),{attention:false});}
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
  }catch(e){show('welcome');error(userError(e));}
}
$('connect').addEventListener('submit',async event=>{
  event.preventDefault();if(submitBusy||Date.now()<retryAfter||blockedNumber)return;submitBusy=true;error('');$('connect-button').disabled=true;$('connect-button').textContent='Preparando código…';
  try{
    const country=selectedCountry();if(!country)throw Error('Selecciona el país de tu número.');
    const national=$('phone').value.replace(/[\s().-]/g,'');if(!/^[0-9]{4,15}$/.test(national))throw Error('Escribe tu número sin el prefijo internacional.');
    const input={phone:'+'+country.dial+national,country:country.code,nationalNumber:national,consent:$('consent').checked};
    if(addingAccount||!session){
      await api('register',input);addingAccount=false;connectionEpoch++;state=null;session=true;
      $('cancel-new-account').hidden=true;clearInterval(timer);timer=setInterval(refresh,3000);
    }
    await api('connect',input);await refresh();
  }catch(e){
    if(e.status===409){blockedNumber=true;error('Este número ya está registrado. Para recuperar su acceso en este navegador, abre el enlace privado creado por el administrador. Administrador: en el bot usa /invitar +NÚMERO Nombre y abre el enlace que recibas. No necesitas desvincular la cuenta.');}
    else if(e.status===429){retryAfter=Date.now()+60000;error('Se hicieron varios intentos seguidos. Espera un minuto antes de volver a solicitar el código.');setTimeout(()=>{if(Date.now()>=retryAfter&&!blockedNumber){$('connect-button').disabled=false;$('connect-button').textContent='Obtener código';}},60000);}
    else error(userError(e));
  }finally{submitBusy=false;$('connect-button').disabled=!!blockedNumber||Date.now()<retryAfter;$('connect-button').textContent=Date.now()<retryAfter?'Espera un minuto':blockedNumber?'Abre tu enlace privado':'Obtener código';}
});
$('begin').onclick=()=>{error('');$('greeting').textContent='Conecta tu cuenta';show('connect');$('phone').focus();renderGuide();};
$('another-account').onclick=()=>{
  blockedNumber=null;addingAccount=true;connectionEpoch++;clearInterval(timer);timer=null;state=null;guideStep=0;
  $('country').value='';updateDial();$('phone').value='';$('consent').checked=false;$('code').textContent='···· ····';$('copy').disabled=true;
  $('owner-actions').hidden=true;$('cancel-new-account').hidden=!session;
  $('greeting').textContent='Conecta otra cuenta';error('');show('connect');renderGuide();$('country').focus();
};
$('cancel-new-account').onclick=async()=>{
  addingAccount=false;connectionEpoch++;$('cancel-new-account').hidden=true;$('phone').value='';$('consent').checked=false;
  await refresh();if(session){clearInterval(timer);timer=setInterval(refresh,3000);}
};
$('close-copy-help').onclick=()=>{
  $('copy-help').close();
  const target=!$('guide-image').hidden?$('guide-image'):!$('guide-video').hidden?$('guide-video'):$('guide');
  target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
};
$('copy-help').addEventListener('click',event=>{if(event.target===$('copy-help'))$('copy-help').close();});
$('copy').onclick=async()=>{
  if(!state?.code||(state.expires&&state.expires<=Date.now())){error('El código venció. Espera a que aparezca el código nuevo antes de copiarlo.');await refresh();return;}
  try{await navigator.clipboard.writeText(state.code);$('copy').textContent='✓ Código copiado';$('copy-help').showModal();setTimeout(()=>$('copy').textContent='Copiar código',2000);}catch{error('No se pudo copiar automáticamente. Mantén pulsado el código y selecciona Copiar.');}
};
$('pause').onclick=async()=>{try{await api('pause',{paused:!state.paused});await refresh();}catch(e){error(userError(e));}};
$('disconnect').onclick=async()=>{if(!confirm('¿Quieres quitar al gestor el acceso a tu cuenta?'))return;try{await api('disconnect',{});session=false;clearInterval(timer);$('owner-actions').hidden=true;show('welcome');error('Cuenta desconectada. También puedes revisar tus dispositivos vinculados dentro de WhatsApp.');}catch(e){error(userError(e));}};
function updateGuideNext(){
  if(!guideData||!guideDevice)return;
  $('guide-next').disabled=false;
  const steps=guideData[guideDevice];$('guide-next').textContent=guideStep===steps.length-1?'IR A LA APP':'SIGUIENTE →';
}
function renderGuide(){
  const steps=guideData?.[guideDevice];$('guide-choose').hidden=!!steps;$('guide-content').hidden=!steps;
  for(const device of ['android','iphone'])$('device-'+device).setAttribute('aria-pressed',String(guideDevice===device));
  if(!steps)return;guideStep=Math.max(0,Math.min(guideStep,steps.length-1));const step=steps[guideStep];
  $('guide-count').textContent=`PASO ${guideStep+1} DE ${steps.length}`;$('guide-device').textContent=guideDevice.toUpperCase();
  $('guide-title').textContent=step.title;$('guide-text').textContent=step.text;$('guide-text').hidden=guideDevice==='iphone'&&guideStep===0;
  const image=$('guide-image'),video=$('guide-video');video.pause();image.hidden=true;video.hidden=true;
  const asset=step.asset,valid=typeof asset==='string'&&(/^\/guides\/(android|iphone)-(prepare|open|linked|number|approve)\.svg$/.test(asset)||/^\/guides\/iphone-2026\/step-[1-5]\.gif$/.test(asset)||/^\/guide-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(asset));
  if(valid){if(asset.endsWith('.mp4')){video.src=asset;video.hidden=false;video.play().catch(()=>{});}else{image.src=asset;image.alt=step.title;image.hidden=false;}}
  $('guide-art-note').hidden=!valid||!asset.startsWith('/guides/');
  $('guide-back').disabled=guideStep===0;$('guide-next').textContent=guideStep===steps.length-1?'IR A LA APP':'SIGUIENTE →';updateGuideNext();
}
for(const device of ['android','iphone'])$('device-'+device).onclick=()=>{guideDevice=device;guideStep=0;try{localStorage.setItem('guide-device',device);}catch{}if(currentView==='connect')show('connect');renderGuide();};
$('guide-back').onclick=()=>{guideStep--;renderGuide();};
$('guide-next').onclick=()=>{if(guideStep<guideData[guideDevice].length-1){guideStep++;renderGuide();}else{location.href='whatsapp://';}};
init();
