(()=>{
 window.addEventListener('hashchange',()=>{if(location.hash)location.reload();});
 const $=id=>document.getElementById(id),state={me:null,account:null,chat:null,mode:'messages',items:[],next:null,chatsNext:null,epoch:0,busy:false};let csrf='',searchTimer,noticeTimer,focusChain=Promise.resolve(),lastFocus='',lastFocusAt=0,refreshBusy=false;
 const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
 const avatarPhoto=(element,src,label)=>{const old=element.querySelector('img');if(old?.getAttribute('src')===src)return;old?.remove();if(!src)return;const image=node('img');image.src=src;image.alt='Foto de '+label;image.loading='lazy';image.decoding='async';image.onerror=()=>image.remove();element.append(image);};
 const view=value=>document.body.dataset.view=value;

 const loadTokens=new Map();
 function beginLoading(id,label,delay=0){
  const element=$(id),previous=loadTokens.get(id);
  if(previous)clearTimeout(previous.timer);
  const token={timer:null};loadTokens.set(id,token);
  const show=()=>{if(loadTokens.get(id)!==token)return;element.textContent=label;element.classList.remove('is-error');element.hidden=false;};
  if(delay>0)token.timer=setTimeout(show,delay);else show();
  return error=>{if(loadTokens.get(id)!==token)return;clearTimeout(token.timer);loadTokens.delete(id);element.hidden=!error;element.textContent=error||'';element.classList.toggle('is-error',!!error);};
 }
 const accountStatus=a=>a.connected?'Conectada':({connecting:'Reconectando…',needs_pairing:'Requiere vinculación',auth_failure:'Requiere vinculación',error:'Error de conexión',expired:'Conexión interrumpida',disconnected:'Sin conexión'})[a.status]||'Sin conexión';
 function notice(text){$('notice').textContent=text;$('notice').hidden=!text;clearTimeout(noticeTimer);if(text)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},8000);}
 function locked(text){state.me=null;state.account=null;state.chat=null;csrf='';$('accounts').replaceChildren();$('chats').replaceChildren();$('thread').replaceChildren();$('media-dialog').close();$('media-body').replaceChildren();$('message').value='';$('workspace').hidden=true;$('login').hidden=false;$('login-status').textContent=text||'Abre tu acceso personal desde Telegram: /panel.';}

 async function api(path,body,timeout=0){
  let response;
  try{
   response=await fetch('/api/panel/'+path,{cache:'no-store',method:body?'POST':'GET',
    headers:body?{'Content-Type':'application/json','X-Panel-CSRF':csrf}:{},
    body:body?JSON.stringify(body):undefined,...(timeout?{signal:AbortSignal.timeout(timeout)}:{})});
  }catch(error){
   if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('La consulta tardó demasiado. Puedes volver a intentarlo.');
   throw Error('No se pudo conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.');
  }
  let data;
  try{data=await response.json();}catch{throw Error('No se pudo leer la respuesta. Inténtalo de nuevo.');}
  if(!response.ok){if(response.status===401)locked(data.error);const error=Error(data.error||'No se pudo completar la consulta.');error.status=response.status;throw error;}
  return data;
 }
 const accountQuery=()=>encodeURIComponent(state.account.id),chatQuery=()=>`account=${accountQuery()}&peer=${encodeURIComponent(state.chat.peer)}`;
 // Only the account/chat currently visible receives a short-lived priority.
 // This is a scheduling hint, not a new data-access or download permission.
 function reportFocus(force=false){
  if(!state.me)return Promise.resolve();
  const visible=!document.hidden&&document.body.dataset.view!=='accounts';
  const account=visible?state.account?.id||null:null;
  const peer=visible&&document.body.dataset.view==='thread'?state.chat?.peer||null:null;
  const payload={account,peer},signature=JSON.stringify(payload),now=Date.now();
  if(!force&&signature===lastFocus&&now-lastFocusAt<15000)return focusChain;
  lastFocus=signature;lastFocusAt=now;
  focusChain=focusChain.catch(()=>{}).then(()=>api('focus',payload,5000)).catch(()=>{lastFocus='';});
  return focusChain;
 }
 const mediaUrl=(id,thumb=false)=>`/api/panel/${thumb?'thumb':'media'}?account=${accountQuery()}&message=${encodeURIComponent(id)}`;
 const time=seconds=>seconds?new Date(seconds*1000).toLocaleString('es',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 function clearConversation(){state.epoch++;state.chat=null;state.items=[];state.next=null;state.itemSignature=null;$('chat-name').textContent='Selecciona una conversación';$('chat-detail').textContent='Mensajes y archivos sincronizados';$('thread').classList.remove('gallery');$('thread').replaceChildren(node('p','empty','Selecciona una conversación.'));$('tabs').hidden=true;$('sync').hidden=true;$('composer').hidden=true;$('older').hidden=true;$('group-note').hidden=true;$('message').value='';}

 async function accounts(){
  const finish=beginLoading('accounts-load-state','Cargando cuentas vinculadas…',
   $('accounts').querySelector('.account-item')?900:0);
  try{
   const data=await api('accounts',undefined,22000);
   if(!state.me)return;
   const old=state.account?.id,signature=JSON.stringify([old,data.items]);
   if(state.accountSignature===signature)return;
   state.accountSignature=signature;
   $('accounts').replaceChildren();
   $('account-count').textContent='CUENTAS · '+data.items.length;
   for(const account of data.items){
    const button=node('button','account-item'+(old===account.id?' active':'')),
     avatar=node('span','avatar',account.name.slice(0,1).toUpperCase()),copy=node('span','account-copy');
    copy.append(node('strong','',account.name),node('small','','+'+account.phone));
    avatarPhoto(avatar,account.avatar,account.name);
    const status=node('small');
    status.append(node('i','status'+(account.connected?' online':'')),document.createTextNode(accountStatus(account)));
    copy.append(status);button.append(avatar,copy);
    button.onclick=()=>chooseAccount(account).catch(e=>notice(e.message));
    $('accounts').append(button);
   }
   if(!data.items.length)$('accounts').append(node('p','empty','Aún no hay cuentas disponibles. Vincula una desde tu enlace de Telegram.'));
   if(old&&!data.items.some(a=>a.id===old)){state.account=null;clearConversation();$('chats').replaceChildren();view('accounts');}
   else if(old){state.account=data.items.find(a=>a.id===old);accountHeader();}
  }catch(error){
   finish('No se pudieron consultar las cuentas. Puedes volver a intentarlo.');
   throw error;
  }finally{finish();}
 }

 function accountHeader(){
  $('account-name').textContent=state.account.name;
  $('account-detail').textContent='+'+state.account.phone
   +(state.me.role==='admin'&&state.account.owner?' · '+state.account.owner.name+' · Telegram '+state.account.owner.id:'')
   +' · '+accountStatus(state.account)+(state.account.connected?'':' · Puedes revisar el historial guardado');
 }

 async function chooseAccount(account){
  state.account=account;state.chatSignature=null;state.chatsNext=null;
  clearConversation();$('search').value='';$('chats').replaceChildren();
  accountHeader();view('chats');reportFocus();
  await chats();await accounts();
 }

 async function chats(append=false){
  if(!state.account)return;
  const id=state.account.id,query=$('search').value,offset=append?state.chatsNext:0;
  const finish=beginLoading('chats-load-state',append?'Cargando más conversaciones…':'Cargando conversaciones e historial…',
   $('chats').querySelector('.chat-item')?900:0);
  try{
   const data=await api('chats?account='+encodeURIComponent(id)+'&q='+encodeURIComponent(query)+'&offset='+(offset||0),undefined,25000);
   if(state.account?.id!==id||$('search').value!==query)return;
   const signature=JSON.stringify([id,query,data.items]);
   if(!append&&state.chatSignature===signature)return;
   state.chatSignature=append?null:signature;
   if(!append)$('chats').replaceChildren();
   state.chatsNext=data.next;$('more-chats').hidden=data.next===null;
   for(const chat of data.items){
    const button=node('button','chat-item'+(state.chat?.peer===chat.peer?' active':'')),
     avatar=node('span','avatar',chat.group?'▧':chat.name.slice(0,1).toUpperCase()),copy=node('span','chat-copy');
    avatarPhoto(avatar,chat.avatar,chat.name);
    copy.append(node('strong','',chat.name),node('small','chat-preview',
     (chat.lastFromMe?'Tú: ':'')+(chat.preview||(chat.group?'Grupo':chat.peer.split('@')[0]))));
    const meta=node('span','chat-meta');
    if(chat.timestamp)meta.append(node('time','',new Date(chat.timestamp*1000).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})));
    button.append(avatar,copy,meta);
    if(chat.unread)meta.append(node('span','unread',String(chat.unread)));
    button.onclick=()=>chooseChat(chat).catch(e=>notice(e.message));
    $('chats').append(button);
   }
   if(!$('chats').children.length)$('chats').append(node('p','empty',
    state.account.connected?'No hay conversaciones sincronizadas. El historial se amplía cuando WhatsApp lo entrega.':
     'Sin conexión. Todavía no hay conversaciones guardadas para consultar.'));
  }catch(error){
   if(state.account?.id===id){finish('No se pudieron cargar las conversaciones. Inténtalo nuevamente.');throw error;}
  }finally{finish();}
 }
 async function chooseChat(chat){state.epoch++;state.chat=chat;state.items=[];state.next=null;state.itemSignature=null;state.mode='messages';$('chat-name').textContent=chat.name;$('chat-detail').textContent=state.account.name+(chat.group?' · Grupo':'');$('chat-avatar').textContent=chat.group?'▧':chat.name.slice(0,1).toUpperCase();avatarPhoto($('chat-avatar'),chat.avatar,chat.name);$('tabs').hidden=false;$('sync').hidden=false;$('message').value='';$('composer').hidden=chat.group;$('group-note').hidden=!chat.group;view('thread');reportFocus();selectTab();$('thread').replaceChildren(node('p','empty','Cargando conversación…'));await messages();const key=state.account.id+':'+chat.peer;if(state.account.connected&&(!syncTimes.has(key)||Date.now()-syncTimes.get(key)>600000)){syncTimes.set(key,Date.now());api('sync',{account:state.account.id,peer:chat.peer}).catch(()=>{});}}
 function selectTab(){$('tab-messages').classList.toggle('selected',state.mode==='messages');$('tab-gallery').classList.toggle('selected',state.mode==='gallery');$('thread').classList.toggle('gallery',state.mode==='gallery');$('older').textContent=state.mode==='gallery'?'Cargar más fotos y videos':'Cargar mensajes anteriores';}

 async function messages(older=false){
  if(!state.chat||state.busy?.epoch===state.epoch)return;
  const epoch=state.epoch,mode=state.mode,lock={epoch};state.busy=lock;
  const gallery=mode==='gallery';
  const label=gallery?(older?'Cargando más fotos y videos…':'Cargando fotos y videos…'):
   (older?'Cargando mensajes anteriores…':'Cargando historial de mensajes…');
  const finish=beginLoading('thread-load-state',label,state.items.length?900:0);
  try{
   const data=await api((gallery?'gallery':'messages')+'?'+chatQuery()+
    (older&&state.next?'&before='+encodeURIComponent(state.next):''),undefined,25000);
   if(epoch!==state.epoch||mode!==state.mode)return;
   const found=new Map(state.items.map(m=>[m.logicalId||m.id,m]));
   for(const item of data.items)found.set(item.logicalId||item.id,item);
   state.items=[...found.values()].sort((a,b)=>a.timestamp-b.timestamp);
   if(older||state.next===null)state.next=data.next;
   const signature=JSON.stringify([state.mode,state.items,state.next]);
   if(state.itemSignature!==signature){if(renderMessages(!older)!==false)state.itemSignature=signature;}
  }catch(error){
   if(epoch!==state.epoch)return;
   if(error.status===404){clearConversation();await accounts();}
   else{
    finish('No se pudo cargar '+(gallery?'la galería':'el historial')+'. Se volverá a intentar.');
    if(!state.items.length)$('thread').replaceChildren(node('p','empty','No se pudo cargar el contenido. El panel volverá a consultarlo.'));
    notice(error.message);
   }
  }finally{finish();if(state.busy===lock)state.busy=false;}
 }
 const syncTimes=new Map();
 const duration=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
 function mediaButton(message){
  const url=mediaUrl(message.id);if(['audio','ptt'].includes(message.type)){
   const player=node('div','voice-player'),play=node('button','voice-play','▶'),body=node('div','voice-body'),wave=node('div','voice-wave'),audio=node('audio');audio.preload='none';audio.src=url;audio.hidden=true;play.setAttribute('aria-label','Reproducir audio');const values=message.waveform?.length?message.waveform:Array(36).fill(20),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 220 36');svg.setAttribute('aria-hidden','true');const bars=[];for(let i=0;i<36;i++){const v=values[Math.floor(i*values.length/36)]||0,h=4+Math.min(31,v/100*31),rect=document.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('x',String(i*6));rect.setAttribute('y',String((36-h)/2));rect.setAttribute('width','3');rect.setAttribute('height',String(h));rect.setAttribute('rx','1.5');svg.append(rect);bars.push(rect);}const range=node('input','voice-seek');range.type='range';range.min=0;range.max=1000;range.value=0;range.setAttribute('aria-label','Posición del audio');wave.append(svg,range);const foot=node('div','voice-foot'),clock=node('span','',duration(message.duration||0)),speed=node('button','voice-speed','1×');speed.setAttribute('aria-label','Velocidad del audio');speed.onclick=()=>{audio.playbackRate=audio.playbackRate===1?1.5:audio.playbackRate===1.5?2:1;speed.textContent=audio.playbackRate+'×';};foot.append(clock,speed);body.append(wave,foot);player.append(play,body,audio);play.onclick=()=>{if(audio.paused){for(const other of $('thread').querySelectorAll('audio,video'))if(other!==audio)other.pause();audio.play().catch(()=>notice('No se pudo reproducir el audio. Comprueba la conexión de la cuenta.'));}else audio.pause();};audio.onplay=()=>{play.textContent='Ⅱ';play.setAttribute('aria-label','Pausar audio');};audio.onpause=audio.onended=()=>{play.textContent='▶';play.setAttribute('aria-label','Reproducir audio');};audio.ontimeupdate=()=>{const progress=audio.duration?audio.currentTime/audio.duration:0;range.value=Math.round(progress*1000);clock.textContent=duration(audio.currentTime||message.duration||0);bars.forEach((b,i)=>b.classList.toggle('played',i/36<progress));};audio.onloadedmetadata=()=>{if(!audio.currentTime)clock.textContent=duration(Number.isFinite(audio.duration)?audio.duration:message.duration||0);};range.oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(range.value)/1000*audio.duration;};return player;
  }
  if(message.type==='video'&&state.mode!=='gallery'){const video=node('video','chat-video');video.controls=true;video.playsInline=true;video.preload='none';video.src=url;if(message.thumbnail)video.poster=mediaUrl(message.id,true);return video;}
  const button=node('button','media-open '+(['image','video','sticker'].includes(message.type)?'visual-media':'file-media'));button.setAttribute('aria-label',message.type==='video'?'Abrir video':message.type==='image'?'Abrir foto':'Abrir '+message.name);
  if(message.thumbnail){const image=node('img');image.alt=message.type==='video'?'Vista previa del video':'Vista previa de la foto';image.loading='lazy';image.src=mediaUrl(message.id,true);image.onerror=()=>{image.remove();button.prepend(node('span','media-placeholder',message.type==='video'?'▶ Abrir video':'▧ Abrir foto'));};button.append(image);}else button.append(node('span','media-placeholder',({image:'▧ Abrir foto',video:'▶ Abrir video',document:'▤ '+message.name,sticker:'◈ Abrir sticker'})[message.type]||message.name));
  if(message.type==='video')button.append(node('span','video-duration','▶ '+duration(message.duration||0)));
  if(!['image','video','sticker'].includes(message.type)&&message.size)button.append(node('small','', (message.size/1024/1024).toFixed(1)+' MB'));
  if(state.mode==='gallery')button.append(node('time','',time(message.timestamp)));button.onclick=()=>openMedia(message);return button;
 }
 function renderMessages(scrollLatest){
  const thread=$('thread');if([...thread.querySelectorAll('audio,video')].some(m=>!m.paused&&!m.ended))return false;
  const nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100,oldHeight=thread.scrollHeight,oldScroll=thread.scrollTop;thread.replaceChildren();let lastDate='';
  for(const message of state.mode==='gallery'?state.items.slice().reverse():state.items){if(state.mode==='gallery'){thread.append(mediaButton(message));continue;}const date=new Date(message.timestamp*1000),day=date.toLocaleDateString('es');if(lastDate!==day){const today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);const label=day===today.toLocaleDateString('es')?'HOY':day===yesterday.toLocaleDateString('es')?'AYER':date.toLocaleDateString('es',{day:'numeric',month:'long',year:'numeric'});thread.append(node('div','date-divider',label));lastDate=day;}
   const row=node('div','message-row'+(message.fromMe?' mine':'')),bubble=node('div','bubble'+(message.media?' with-media':''));if(!message.fromMe&&state.chat.group&&message.sender)bubble.append(node('span','sender',message.sender));if(message.media)bubble.append(mediaButton(message));if(message.text)bubble.append(node('span','message-text',message.text));else if(!message.media)bubble.append(node('span','',message.type==='system'?'Mensaje no disponible':'Mensaje'));const stamp=node('time','',date.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'}));if(message.fromMe&&message.status>=2){const ticks=node('span','ticks'+(message.status>=4?' read':''),message.status>=3?'✓✓':'✓');ticks.setAttribute('aria-label',message.status>=4?'Leído':message.status>=3?'Entregado':'Enviado');stamp.append(ticks);}bubble.append(stamp);row.append(bubble);thread.append(row);
  }
  if(!state.items.length)thread.append(node('p','empty',state.mode==='gallery'?(state.account.connected?'No hay fotos o videos sincronizados todavía.':'Sin conexión: todavía no hay fotos o videos guardados para mostrar.'):(state.account.connected?'No hay mensajes disponibles todavía. Puedes solicitar más historial.':'Sin conexión: todavía no hay mensajes guardados en este chat.')));$('older').hidden=!state.next;if(state.mode==='messages'){if(scrollLatest&&(nearBottom||oldHeight<thread.clientHeight))thread.scrollTop=thread.scrollHeight;else if(!scrollLatest)thread.scrollTop=oldScroll+thread.scrollHeight-oldHeight;}
 }
 function openMedia(message){$('media-title').textContent=message.name;$('media-body').replaceChildren(node('p','empty','Abriendo archivo…'));$('download').href=mediaUrl(message.id)+'&download=1';$('download').textContent='↓ Descargar archivo';$('media-dialog').showModal();const src=mediaUrl(message.id);let el;if(message.type==='image'||message.type==='sticker'){el=node('img');el.alt=message.text||message.name;}else if(message.type==='video'){el=node('video');el.controls=true;el.playsInline=true;el.preload='metadata';}else if(message.type==='audio'||message.type==='ptt'){el=node('audio');el.controls=true;el.playsInline=true;el.preload='metadata';}if(el){el.src=src;el.onerror=()=>{$('media-body').replaceChildren(node('p','empty','No se pudo abrir el archivo. La cuenta debe estar conectada y WhatsApp debe tenerlo disponible.'));};$('media-body').replaceChildren(el);}else $('media-body').replaceChildren(node('p','empty','Usa Descargar archivo para abrir este documento.'));}
 $('close-media').onclick=()=>{$('media-dialog').close();$('media-body').replaceChildren();};$('media-dialog').addEventListener('click',e=>{if(e.target===$('media-dialog'))$('close-media').click();});
 $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>chats().catch(e=>notice(e.message)),250);};$('more-chats').onclick=()=>chats(true).catch(e=>notice(e.message));$('older').onclick=()=>messages(true);
 for(const mode of ['messages','gallery'])$('tab-'+mode).onclick=()=>{state.mode=mode;state.epoch++;state.items=[];state.next=null;state.itemSignature=null;selectTab();reportFocus();$('thread').replaceChildren(node('p','empty',mode==='gallery'?'Preparando galería…':'Preparando conversación…'));messages();};
 $('sync').onclick=async()=>{if(!state.chat)return;$('sync').disabled=true;try{const data=await api('sync',{account:state.account.id,peer:state.chat.peer});notice(data.message);}catch(e){notice(e.message);}finally{$('sync').disabled=false;}};
 $('composer').onsubmit=async event=>{event.preventDefault();const text=$('message').value.trim();if(!text||!state.chat||state.chat.group)return;if(!confirm('¿Enviar este mensaje a '+state.chat.name+' desde +'+state.account.phone+'?\n\n'+text))return;const request=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');const epoch=state.epoch,account=state.account.id,peer=state.chat.peer;$('send').disabled=true;try{await api('send',{account,peer,text,request});if(state.epoch===epoch){if($('message').value.trim()===text)$('message').value='';await messages();}}catch(e){notice(e.message);}finally{$('send').disabled=false;}};
 $('back-accounts').onclick=()=>{view('accounts');reportFocus(true);};$('back-chats').onclick=()=>{view('chats');reportFocus(true);};$('logout').onclick=async()=>{try{await api('logout',{});}finally{locked('Sesión cerrada. Abre otro acceso desde Telegram cuando quieras volver.');}};
 async function start(){try{const token=location.hash.slice(1);if(token){history.replaceState(null,'',location.pathname);$('login-status').textContent='Comprobando tu acceso…';await api('login',{token});}state.me=await api('me');csrf=state.me.csrf;$('editor-link').hidden=state.me.role!=='admin';$('user-name').textContent=state.me.name+(state.me.role==='admin'?' · Administrador':'');$('login').hidden=true;$('workspace').hidden=false;view('accounts');await accounts().catch(e=>notice(e.message));}catch(e){locked(e.message);}}
 setInterval(async()=>{
  if(!state.me||document.hidden||refreshBusy)return;
  refreshBusy=true;reportFocus();
  try{
   // Refresh the displayed conversation/gallery before broad account lists.
   if(state.chat&&document.body.dataset.view==='thread')await messages();
   if(state.account&&document.body.dataset.view!=='accounts')await chats();
   await accounts();
  }catch(e){notice(e.message);}finally{refreshBusy=false;}
 },10000);
 window.addEventListener('online',()=>{if(state.me){reportFocus(true);accounts().catch(e=>notice(e.message));}});
 document.addEventListener('visibilitychange',()=>{
  if(!state.me)return;
  reportFocus(true);if(!document.hidden)accounts().catch(e=>notice(e.message));
 });start();
})();
