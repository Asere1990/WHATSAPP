const $=id=>document.getElementById(id);
let state=null,timer=null,session=false;
async function api(path,data){const r=await fetch(`/api/${path}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok){const e=new Error(j.error||'No se pudo completar');e.status=r.status;throw e;}return j;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function show(id){for(const x of ['loading','welcome','connect','pairing','connected'])$(x).hidden=x!==id;}
async function refresh(){
  if(!session)return;
  try{
    state=await api('status');$('greeting').textContent=`Hola, ${state.name}.`;if(!$('phone').value)$('phone').value=state.phone;
    $('owner-actions').hidden=!state.consent;
    if(state.status==='connected'){
      show('connected');$('activity').textContent=state.paused?'Atención pausada':'Atención activa';$('pause').textContent=state.paused?'Reanudar atención':'Pausar atención';error('');
    }else if(state.status==='connecting' || state.code){
      show('pairing');$('code').textContent=state.code?state.code.slice(0,4)+' '+state.code.slice(4):'···· ····';$('copy').disabled=!state.code;
      $('expires').textContent=state.code?'Copia el código e introdúcelo en WhatsApp. Se renueva automáticamente.':'Preparando el código. Esto puede tardar un momento…';$('retry').hidden=true;
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
$('begin').onclick=()=>{error('');$('greeting').textContent='Conecta tu cuenta';show('connect');$('phone').focus();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.code);$('copy').textContent='✓ Código copiado';setTimeout(()=>$('copy').textContent='Copiar código',2000);}catch{error('Mantén pulsado el código y selecciona Copiar.');}};
$('pause').onclick=async()=>{try{await api('pause',{paused:!state.paused});await refresh();}catch(e){error(e.message);}};
$('disconnect').onclick=async()=>{if(!confirm('¿Quieres quitar al gestor el acceso a tu cuenta?'))return;try{await api('disconnect',{});session=false;clearInterval(timer);$('owner-actions').hidden=true;show('welcome');error('Cuenta desconectada. También puedes revisar tus dispositivos vinculados dentro de WhatsApp.');}catch(e){error(e.message);}};
init();
