(()=>{
 const el=id=>document.getElementById(id);
 const msg=(id,s,error=false)=>{const n=el(id);n.textContent=s;n.hidden=!s;n.style.color=error?'#a32731':'#0b8269';};
 const allowed=path=>path==='/panel'||path==='/studio'||path==='/editor'||/^\/editor\?site=(?:wa|cm)$/.test(path);
 const next=new URLSearchParams(location.search).get('next')||'/panel';
 const destination=allowed(next)?next:'/panel';
 const idValid=id=>/^[1-9][0-9]{4,19}$/.test(id);
 el('login').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=el('telegram-id').value.trim(),password=el('password').value,button=el('enter');
  if(!idValid(id)){msg('login-message','Introduce un Telegram ID válido.',true);return;}
  button.disabled=true;button.textContent='COMPROBANDO…';msg('login-message','');
  try{
   const result=await fetch('/api/panel/password-login',{
    method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
    body:JSON.stringify({telegram_id:id,password})
   });
   const data=await result.json();
   if(!result.ok)throw Error(data.error||'No fue posible iniciar sesión.');
   el('password').value='';
   location.replace(destination);
  }catch(error){el('password').value='';msg('login-message',error.message||'Error de conexión.',true);}
  finally{button.disabled=false;button.textContent='ENTRAR';}
 });
 const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 el('generator').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=el('generator-id').value.trim(),password=el('generator-password').value,button=el('protect');
  if(!idValid(id)){msg('generator-message','El ID debe ser numérico y tener entre 5 y 20 cifras.',true);return;}
  if(password.length<8||password.length>256){msg('generator-message','La contraseña debe tener una longitud válida.',true);return;}
  if(!crypto?.subtle||!crypto?.getRandomValues){msg('generator-message','Este navegador no admite el generador seguro.',true);return;}
  button.disabled=true;button.textContent='PROTEGIENDO…';msg('generator-message','');
  try{
   const salt=crypto.getRandomValues(new Uint8Array(16));
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
   const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},key,256);
   el('protected-line').value=id+',pbkdf2_sha256$310000$'+hex(salt)+'$'+hex(new Uint8Array(bytes));
   el('generator-password').value='';
   msg('generator-message','Línea creada. Copia y sustituye únicamente la línea de este ID en GitHub.');
  }catch(error){msg('generator-message','No se pudo generar la línea. Inténtalo de nuevo.',true);}
  finally{button.disabled=false;button.textContent='GENERAR LÍNEA PROTEGIDA';}
 });
 el('copy').addEventListener('click',async()=>{
  const value=el('protected-line').value;
  if(!value){msg('generator-message','Genera primero la línea protegida.',true);return;}
  try{await navigator.clipboard.writeText(value);msg('generator-message','Línea copiada.');}
  catch{el('protected-line').select();msg('generator-message','Selecciona la línea y utiliza Copiar.');}
 });
})();
