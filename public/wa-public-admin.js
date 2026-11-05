(()=>{
 const button=document.getElementById('wa-public-admin-open'),dialog=document.getElementById('wa-public-admin'),list=document.getElementById('wa-public-users');
 if(!button||!dialog||!list)return;
 const close=document.getElementById('wa-public-admin-close'),status=document.getElementById('wa-public-admin-status');
 let csrf='',admin=false,loading=false;
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
 async function json(path,body){
  const r=await fetch('/api/panel/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
   headers:body?{'Content-Type':'application/json','X-Panel-CSRF':csrf}:{},body:body?JSON.stringify(body):undefined});
  const result=await r.json();if(!r.ok)throw Error(result.error||'La operación falló.');return result;
 }
 async function check(){
  if(admin)return;try{
   const info=await json('me');
   if(info.role==='admin'){csrf=info.csrf;admin=true;button.hidden=false;}
  }catch{}
 }
 async function showLinks(actor,place){
  place.replaceChildren(node('p','Consultando enlaces…'));
  try{
   const data=await json('public-wa-user-links?actor='+encodeURIComponent(actor));
   place.replaceChildren();
   for(const l of data.items){
    const p=node('p',l.code+' · '+(l.enabled?'Activo':'Revocado')+' · '+l.linked_accounts+' cuentas asociadas');
    const a=node('a','Ver enlace');a.href='https://securitywhat.app/'+encodeURIComponent(l.code);a.target='_blank';a.rel='noopener noreferrer';
    p.append(' · ',a);place.append(p);
   }
   if(!data.items.length)place.append(node('p','Sin enlaces.'));
  }catch(e){place.replaceChildren(node('p',e.message));}
 }
 async function refresh(){
  if(!admin||loading)return;loading=true;status.textContent='Cargando usuarios…';
  try{
   const data=await json('public-wa-users');list.replaceChildren();
   for(const u of data.users){
    const row=node('section');row.className='wa-public-user';
    row.append(node('strong','Telegram ID: '+u.actor),node('p',u.links+' enlaces · '+u.active+' activos'));
    const actions=node('div');actions.className='wa-public-actions';
    const inspect=node('button','VER ENLACES'),del=node('button','ELIMINAR TODO DEL USUARIO');
    del.className='wa-public-danger';
    const details=node('div');details.hidden=true;details.className='wa-public-details';
    inspect.onclick=()=>{details.hidden=!details.hidden;if(!details.hidden)showLinks(u.actor,details);};
    del.onclick=async()=>{
     if(!confirm('¿Eliminar TODOS los enlaces y las asociaciones del usuario Telegram '+u.actor+'? Las cuentas conectadas y sus sesiones NO serán borradas.'))return;
     del.disabled=true;
     try{const result=await json('public-wa-delete-user',{actor:u.actor});status.textContent='Se eliminaron '+result.removed+' enlaces; las cuentas de WhatsApp permanecen intactas.';await refresh();}
     catch(e){status.textContent=e.message;del.disabled=false;}
    };
    actions.append(inspect,del);row.append(actions,details);list.append(row);
   }
   if(!data.users.length)list.append(node('p','Todavía no hay enlaces públicos creados.'));
   status.textContent='Administración de enlaces públicos de WhatsApp. Eliminar enlaces no desconecta las cuentas.';
  }catch(e){status.textContent=e.message;}
  finally{loading=false;}
 }
 button.onclick=async()=>{await check();if(!admin)return;dialog.showModal();refresh();};
 close.onclick=()=>dialog.close();
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 check();
 const workplace=document.getElementById('workspace');
 if(workplace&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(!workplace.hidden)check();}).observe(workplace,{attributes:true,attributeFilter:['hidden']});
})();