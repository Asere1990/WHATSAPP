// Cubamax only: review the existing guide before any registration or code request.
const prelinkTutorial=(()=>{
 const dialog=document.getElementById('prelink-tutorial');
 if(!dialog)return ()=>true;
 const get=id=>document.getElementById('prelink-'+id);
 let device=null,index=0,pending=null,approved=null;
 const whatsApp=!!document.body&&!document.body.classList.contains('corporate-portal');
 const copy=()=>whatsApp?globalThis.currentPublicContent?.prelinkCopy||{}:{};
 const stepsFor=name=>whatsApp?globalThis.currentPublicContent?.prelinkGuides?.[name]||guideData?.[name]:guideData?.[name];
 function updateCopy(){
  if(!whatsApp)return;
  const c=copy(),introduction=dialog.querySelector('.prelink-body > p'),prompt=dialog.querySelector('.prelink-body > h3');
  if(c.heading)get('heading').textContent=c.heading;
  if(c.introduction&&introduction)introduction.textContent=c.introduction;
  if(c.prompt&&prompt)prompt.textContent=c.prompt;
  if(c.android)get('android').textContent=c.android;
  if(c.iphone)get('iphone').textContent=c.iphone;
  if(c.choose)get('choose').textContent=c.choose;
  if(c.back)get('back').textContent=c.back;
  if(c.close)get('close').setAttribute('aria-label',c.close);
 }
 const signature=input=>JSON.stringify([input.phone,input.country,input.service,input.consent]);
 function pause(){get('video').pause();}
 function render(){
  pause();const steps=stepsFor(device);
  get('content').hidden=!steps;get('choose').hidden=!!steps;
  for(const name of ['android','iphone'])get(name).setAttribute('aria-pressed',String(device===name));
  if(!steps)return;
  const step=steps[index];get('count').textContent=`PASO ${index+1} DE ${steps.length}`;
  get('title').textContent=step.title;get('text').textContent=step.text;
  const image=get('image'),video=get('video');image.hidden=true;video.hidden=true;
  const asset=step.asset;
  if(typeof asset==='string'&&(/^\/guides\/(android|iphone)-(prepare|open|linked|number|approve)\.svg$/.test(asset)||/^\/guides\/(android|iphone)-2026\/step-[1-5]\.gif$/.test(asset)||/^\/guide-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(asset))){
   const media=asset.endsWith('.mp4')?video:image;media.src=asset;media.hidden=false;
  }
  get('back').disabled=index===0;
  get('next').textContent=index===steps.length-1?(whatsApp?copy().confirm||'ENTENDIDO':'¿ENTENDISTE?'):(whatsApp?copy().next||'SIGUIENTE →':'SIGUIENTE →');
 }
 for(const name of ['android','iphone'])get(name).onclick=()=>{device=name;index=0;render();};
 get('back').onclick=()=>{if(index>0){index--;render();}};
 get('next').onclick=()=>{
  const steps=stepsFor(device);if(!steps)return;
  if(index<steps.length-1){index++;render();return;}
  approved=pending;pending=null;
  get('next').textContent='Obtener código';
  dialog.close();pause();document.getElementById('connect').requestSubmit();
 };
 get('close').onclick=()=>{pending=null;approved=null;pause();dialog.close();};
 dialog.addEventListener('cancel',()=>{pending=null;approved=null;pause();});
 dialog.addEventListener('close',pause);
 if(whatsApp)window.addEventListener('publiccontentchange',()=>{updateCopy();if(device)render();});
 return input=>{
  const key=signature(input);
  if(approved===key){approved=null;return true;}
  approved=null;pending=key;device=null;index=0;updateCopy();render();dialog.showModal();return false;
 };
})();
