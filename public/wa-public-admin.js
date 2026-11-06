(()=>{
 const button=document.getElementById('wa-public-admin-open'),dialog=document.getElementById('wa-public-admin'),list=document.getElementById('wa-public-users');
 if(!button||!dialog||!list)return;
 const close=document.getElementById('wa-public-admin-close'),status=document.getElementById('wa-public-admin-status');
 const changeNumberButton=document.getElementById('wa-system-number-open'),
  numberDialog=document.getElementById('wa-system-number-dialog'),
  numberForm=document.getElementById('wa-system-number-form'),
  numberInput=document.getElementById('wa-system-number-input'),
  numberCurrent=document.getElementById('wa-system-number-current'),
  numberSave=document.getElementById('wa-system-number-save'),
  numberCancel=document.getElementById('wa-system-number-cancel'),
  numberStatus=document.getElementById('wa-system-number-status');
 const addButton=document.getElementById('wa-system-number-add-open'),
  addDialog=document.getElementById('wa-system-number-add-dialog'),
  addList=document.getElementById('wa-system-number-list'),
  addForm=document.getElementById('wa-system-number-add-form'),
  addInput=document.getElementById('wa-system-number-add-input'),
  addSave=document.getElementById('wa-system-number-add-save'),
  addCancel=document.getElementById('wa-system-number-add-cancel'),
  addStatus=document.getElementById('wa-system-number-add-status');
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
   if(info.role==='admin'){csrf=info.csrf;admin=true;button.hidden=false;if(changeNumberButton)changeNumberButton.hidden=false;if(addButton)addButton.hidden=false;}
  }catch{}
 }
 async function showLinks(actor,place){
  place.replaceChildren(node('p','Consultando enlaces…'));
  try{
   const data=await json('public-wa-user-links?actor='+encodeURIComponent(actor));
   place.replaceChildren();
   for(const l of data.items){
    const linked=Number.isInteger(l.linked_accounts)?' · '+l.linked_accounts+' cuentas vinculadas':'';
    const p=node('p',(l.site||'WhatsApp')+' · '+l.code+' · '+(l.enabled?'Activo':'Inactivo')+linked);
    if(typeof l.url==='string'&&/^https:\/\//i.test(l.url)){
     const a=node('a','Ver enlace');a.href=l.url;a.target='_blank';a.rel='noopener noreferrer';
     p.append(' · ',a);
    }
    place.append(p);
   }
   if(!data.items.length)place.append(node('p','No hay enlaces atribuibles a este Telegram ID.'));
   place.append(node('p','ELIMINAR TODO DEL USUARIO solo elimina enlaces públicos nuevos de WhatsApp; no borra Cubamax ni enlaces anteriores.'));
  }catch(e){place.replaceChildren(node('p',e.message));}
 }
 async function refresh(){
  if(!admin||loading)return;loading=true;status.textContent='Cargando usuarios…';
  try{
   const data=await json('public-wa-users');list.replaceChildren();
   for(const u of data.users){
    const row=node('section');row.className='wa-public-user';
    // Prefer Telegram's public username link; fall back to its native
    // user-ID deep link when the person has not set a username.
    const username=/^[a-zA-Z0-9_]{5,32}$/.test(u.username||'')?u.username:'';
    const actor=/^[1-9][0-9]{4,19}$/.test(String(u.actor))?String(u.actor):'';
    const profileUrl=username?'https://t.me/'+username:actor?'tg://user?id='+actor:'';
    const identity=node('p');
    const name=(typeof u.name==='string'&&u.name.trim())?u.name.trim():'Nombre no disponible';
    if(profileUrl){
     const link=node('a',name);link.href=profileUrl;link.target='_blank';link.rel='noopener noreferrer';
     identity.append(link);
    }else identity.append(name);
    if(username){
     const usernameLink=node('a','@'+username);
     usernameLink.href=profileUrl;usernameLink.target='_blank';usernameLink.rel='noopener noreferrer';
     identity.append(' · ',usernameLink);
    }
    const categories=[
     ['wa','WhatsApp'],['cm','Cubamax'],['legacyWa','WhatsApp anterior'],
     ['legacyCm','Cubamax anterior'],['studio','Webs propias'],
     ['associated','Asociados a cuentas']
    ];
    const types=categories.filter(([key])=>u.sources?.[key]?.links>0)
     .map(([key,name])=>name+': '+u.sources[key].links);
    row.append(node('strong','Telegram ID: '+u.actor),identity,
     node('p',u.links+' enlaces · '+u.active+' activos'+
      (types.length?' · '+types.join(' · '):'')));
    const actions=node('div');actions.className='wa-public-actions';
    const inspect=node('button','VER ENLACES'),del=node('button','ELIMINAR TODO DEL USUARIO');
    del.className='wa-public-danger';
    const details=node('div');details.hidden=true;details.className='wa-public-details';
    inspect.onclick=()=>{details.hidden=!details.hidden;if(!details.hidden)showLinks(u.actor,details);};
    del.onclick=async()=>{
     if(!confirm('¿Eliminar los enlaces públicos NUEVOS de WhatsApp del Telegram ID '+u.actor+'? Los enlaces Cubamax, antiguos y de otras categorías NO se eliminarán. Las cuentas y sesiones seguirán intactas.'))return;
     del.disabled=true;
     try{const result=await json('public-wa-delete-user',{actor:u.actor});status.textContent='Se eliminaron '+result.removed+' enlaces; las cuentas de WhatsApp permanecen intactas.';await refresh();}
     catch(e){status.textContent=e.message;del.disabled=false;}
    };
    const ban=node('button',u.banned?'✅ DESBANEAR USUARIO':'⛔ BANEAR USUARIO');
    ban.className=u.banned?'':'wa-public-danger';
    if(u.admin){ban.textContent='ADMINISTRADOR · NO BANEABLE';ban.disabled=true;}
    ban.onclick=async()=>{
     if(u.admin)return;
     const nextBanned=!u.banned;
     const prompt=nextBanned
      ?'¿Banear al Telegram ID '+u.actor+'? Se bloqueará su acceso y se revocarán sus enlaces públicos. Las cuentas de WhatsApp conectadas NO se desconectarán.'
      :'¿Desbanear al Telegram ID '+u.actor+'? Podrá recuperar los permisos que conserve, pero sus enlaces seguirán revocados hasta que se reactiven.';
     if(!confirm(prompt))return;
     ban.disabled=true;
     try{
      await json('public-wa-ban-user',{actor:u.actor,banned:nextBanned});
      await refresh();
      status.textContent=nextBanned
       ?'🚫 Usuario '+u.actor+' baneado; las cuentas vinculadas permanecen intactas.'
       :'✅ Usuario '+u.actor+' desbaneado; sus enlaces permanecen en su estado actual.';
     }catch(e){status.textContent=e.message;ban.disabled=false;}
    };
    actions.append(inspect,del,ban);row.append(actions,details);list.append(row);
   }
   if(!data.users.length)list.append(node('p','Todavía no hay enlaces públicos creados.'));
   status.textContent='Enlaces atribuibles a cada Telegram ID. ELIMINAR TODO conserva su alcance original: solo enlaces públicos nuevos de WhatsApp.';
  }catch(e){status.textContent=e.message;}
  finally{loading=false;}
 }
 button.onclick=async()=>{await check();if(!admin)return;dialog.showModal();refresh();};
 close.onclick=()=>dialog.close();
 // Dedicated admin control. Only wa_public_sender_phone is changed.
 if(changeNumberButton&&numberDialog&&numberForm&&numberInput&&numberCurrent&&
    numberSave&&numberCancel&&numberStatus){
  changeNumberButton.onclick=async()=>{
   await check();if(!admin)return;
   numberDialog.showModal();
   numberForm.hidden=true;
   numberCurrent.textContent='Consultando número actual…';
   numberStatus.textContent='';
   try{
    const info=await json('public-wa-system-number');
    numberCurrent.textContent='Número actual: '+info.phone+(info.connected?' · Conectado':' · Sin conexión');
    numberInput.value=info.phone;
    numberForm.hidden=false;
   }catch(e){numberStatus.textContent=e.message;}
  };
  numberForm.onsubmit=async event=>{
   event.preventDefault();
   const phone=String(numberInput.value||'').trim();
   if(!phone){numberStatus.textContent='Escribe el nuevo número con código de país.';return;}
   if(!confirm('¿Cambiar el número emisor del sistema a '+phone+'? Los siguientes envíos usarán el número nuevo. Las cuentas anteriores no se desconectarán.'))return;
   numberSave.disabled=true;
   numberStatus.textContent='Comprobando cuenta vinculada…';
   try{
    const result=await json('public-wa-system-number',{phone});
    numberCurrent.textContent='Número actual: '+result.phone+' · Conectado';
    numberInput.value=result.phone;
    numberStatus.textContent='✅ Número del sistema actualizado. Los próximos envíos utilizarán '+result.phone+'.';
   }catch(e){numberStatus.textContent=e.message;}
   finally{numberSave.disabled=false;}
  };
  numberCancel.onclick=()=>numberDialog.close();
 }
 if(addButton&&addDialog&&addList&&addForm&&addInput&&addSave&&addCancel&&addStatus){
  const reloadNumbers=async()=>{
   const response=await json('public-wa-system-numbers');
   addList.replaceChildren();
   for(const entry of response.numbers)
    addList.append(node('p',entry.phone+
     (entry.primary?' · PRINCIPAL':' · ADICIONAL')+
     (entry.connected?' · Conectado':' · Sin conexión')));
  };
  addButton.onclick=async()=>{
   await check();if(!admin)return;
   addDialog.showModal();
   addStatus.textContent='';
   addInput.value='';
   try{await reloadNumbers();}
   catch(error){addStatus.textContent=error.message;}
  };
  addForm.onsubmit=async event=>{
   event.preventDefault();
   const phone=String(addInput.value||'').trim();
   if(!phone){addStatus.textContent='Escribe un número con código de país.';return;}
   addSave.disabled=true;
   addStatus.textContent='Comprobando el nuevo emisor…';
   try{
    const result=await json('public-wa-system-numbers',{phone});
    addStatus.textContent=result.alreadyAdded
     ?'Este número ya figura entre los emisores del sistema.'
     :'✅ Número agregado. Podrás elegirlo cuando envíes un mensaje.';
    addInput.value='';
    await reloadNumbers();
   }catch(error){addStatus.textContent=error.message;}
   finally{addSave.disabled=false;}
  };
  addCancel.onclick=()=>addDialog.close();
 }
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 check();
 const workplace=document.getElementById('workspace');
 if(workplace&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(!workplace.hidden)check();}).observe(workplace,{attributes:true,attributeFilter:['hidden']});
})();