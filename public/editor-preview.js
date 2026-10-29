(()=>{
const site=document.body.classList.contains('corporate-portal')?'cm':'wa';let fields=[],editing=true,selected=null,section='',guideStep=0;
const tell=m=>parent.postMessage(m,location.origin);
function select(id,el){if(selected)selected.removeAttribute('data-editor-selected');selected=el;el?.setAttribute('data-editor-selected','');tell({type:'selection',id,scroll:scrollY,service:section|| (site==='cm'&&typeof corporateService!=='undefined'?corporateService:''),step:guideStep});}
function pick(target){
 const find=id=>fields.find(f=>f.id===id);
 if(section==='guide-iphone'||section==='guide-android'){
  const device=section.slice(6),step=globalThis.currentPublicContent?.guides?.[device]?.[guideStep];
  if(step){const prefix=site==='cm'?'prelink':'guide';
   for(const [part,kind] of [['title','title'],['text','text'],['image','asset'],['video','asset']]){
    const el=target.closest('#'+prefix+'-'+part);
    if(el)return {field:find('guide:'+device+':'+step.id+':'+kind),el};
   }
  }
 }
 if(site==='wa'){
  const badge=target.closest('#wa-verified-badge');if(badge)return {field:find('brand:verified'),el:badge};
  const logo=target.closest('#wa-brand-logo');if(logo)return {field:find('brand:logo'),el:logo};
  const subtitle=target.closest('#wa-brand-description');if(subtitle)return {field:find('brand:subtitle'),el:subtitle};
  const title=target.closest('#wa-brand-name,.wordmark .brand-title');
  if(title){
   const name=title.id==='wa-brand-name'?title:title.querySelector?.('#wa-brand-name');
   if(name)return {field:find(globalThis.currentPublicContent?.identity?.mode==='photo'?'identity:photo':'identity:text'),el:name};
  }
 }
 const siteName=target.closest('header .corporate-brand>img,header .corporate-brand>.page-name-text');
 if(siteName)return {field:find('identity:mode'),el:siteName};
 if(site==='wa')for(const key of ['title','text','button','photo']){const el=target.closest('#wa-welcome-'+key);if(el)return {field:find('welcome:'+key),el};}
 const pairingInstruction=target.closest('#pairing-account + p');if(pairingInstruction)return {field:find('pairing:instructions'),el:pairingInstruction};
 const pairingAccount=target.closest('#pairing-account');if(pairingAccount)return {field:fields.find(f=>f.source==='Número que estás vinculando: {numero}'),el:pairingAccount};
 const country=target.closest('#country');if(country){const option=country.options[0],text=option?.textContent.trim();return {field:fields.find(f=>f.kind==='text'&&(f.value===text||f.source===text)),el:country};}
 const explicit=target.closest('[data-cubamax-text]');if(explicit)return {field:find('portal:'+explicit.dataset.cubamaxText),el:explicit};
 // Only the service-specific elements use portal fields. Other popup
 // text belongs to the regular page catalog, not to the popup title.
 if(site==='cm'&&typeof corporateService!=='undefined'&&corporateService){
  for(const [selector,suffix,prefix]of [['#service-dialog-photo','PopupPhoto','extra:'],['#service-continue','PopupButton','portal:'],['#service-dialog-description','PopupDescription','portal:'],['#service-dialog-title','PopupTitle','portal:'],['#selected-service-name','Title','portal:']]){const el=target.closest(selector);if(el)return {field:find(prefix+corporateService+suffix),el};}
 }

 const media=target.closest('img,video');if(media){const src=media.dataset.publicSource||media.getAttribute('src'),card=media.closest('[data-service]');if(card)return {field:find('card:'+card.dataset.service),el:media};if(media.closest('.corporate-brand'))return {field:find('logo'),el:media};const slide=media.closest('#cubamax-slides > article');if(slide){const i=[...slide.parentElement.children].indexOf(slide);return {field:fields.filter(f=>f.id.startsWith('slide:'))[i],el:media};}return {field:fields.find(f=>f.source===src||f.kind!=='text'&&f.value===src),el:media};}
 if(site==='wa'){for(const [selector,id]of [['#title','brand:title'],['#description','brand:description'],['#begin','brand:button'],['#logo,#mark','brand:logo']])if(target.closest(selector))return {field:find(id),el:target.closest(selector)};}
 for(let el=target;el&&el!==document.body;el=el.parentElement){const texts=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean);for(const text of [texts.join(' '),...texts].filter(Boolean)){const normalize=v=>String(v||'').replace(/\s+/g,' ').trim();const field=fields.find(f=>f.kind==='text'&&(normalize(f.value)===normalize(text)||normalize(f.source)===normalize(text)));if(field)return {field,el};}for(const attr of ['placeholder','aria-label','alt']){const value=el.getAttribute(attr);const field=value&&fields.find(f=>f.kind==='text'&&(f.source===value||f.value===value));if(field)return {field,el};}}
 return null;
}
let lastTextTap=null;
function renderGuideStep(){
 const device=section.slice(6),steps=globalThis.currentPublicContent?.guides?.[device];
 if(!Array.isArray(steps)||!steps.length)return;
 guideStep=Math.max(0,Math.min(guideStep,steps.length-1));
 const prefix=site==='cm'?'prelink':'guide',get=name=>document.getElementById(prefix+'-'+name),step=steps[guideStep];
 get('content').hidden=false;get('choose').hidden=true;
 for(const name of ['android','iphone']){const button=document.getElementById((site==='cm'?'prelink-':'device-')+name);if(button)button.setAttribute('aria-pressed',String(device===name));}
 get('count').textContent='PASO '+(guideStep+1)+' DE '+steps.length;
 if(site==='wa')get('device').textContent=device.toUpperCase();
 get('title').textContent=step.title;get('text').textContent=step.text;get('text').hidden=false;
 const image=get('image'),video=get('video');video.pause();image.hidden=true;video.hidden=true;
 if(step.asset){const media=step.asset.endsWith('.mp4')?video:image;media.src=step.asset;media.hidden=false;}
 if(site==='wa'){const note=get('art-note');if(note)note.hidden=!step.asset?.startsWith('/guides/');}
 get('back').disabled=guideStep===0;get('next').disabled=guideStep===steps.length-1;
 get('next').textContent=guideStep===steps.length-1?'FIN DEL TUTORIAL':'SIGUIENTE →';
 tell({type:'guide-step',step:guideStep});
}
function popup(service,step=0){const previous=section;section=service;guideStep=Number.isInteger(step)?step:0;
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 if(previous.startsWith('guide-')&&site==='wa'){
  const guide=document.getElementById('guide');if(guide)guide.hidden=true;
  const content=document.getElementById('guide-content');if(content)content.hidden=true;
  const welcome=document.getElementById('welcome');if(welcome)welcome.hidden=false;
 }
 if(service==='guide-iphone'||service==='guide-android'){
  if(site==='cm'){renderGuideStep();document.getElementById('prelink-tutorial')?.showModal();}
  else{
   for(const id of ['welcome','loading','connect','pairing','connected','owner-actions']){const el=document.getElementById(id);if(el)el.hidden=true;}
   const guide=document.getElementById('guide');if(guide)guide.hidden=false;
   renderGuideStep();guide?.scrollIntoView({block:'start'});
  }
  return;
 }
 if(service==='pairing'){
  if(typeof corporateService!=='undefined')corporateService='';
  for(const id of ['access-panel','pairing','owner-actions','guide']){const el=document.getElementById(id);if(el)el.hidden=false;}
  for(const id of ['welcome','loading','connect','connected']){const el=document.getElementById(id);if(el)el.hidden=true;}
  const account=document.getElementById('pairing-account');if(account)account.textContent='Número que estás vinculando: +1 *** *** ****';
  const code=document.getElementById('code');if(code){code.textContent='ABCD EFGH';code.hidden=false;}
  const codeLoading=document.getElementById('code-loading');if(codeLoading)codeLoading.hidden=true;
  const copy=document.getElementById('copy');if(copy)copy.disabled=false;
  const expiry=document.getElementById('expires');if(expiry)expiry.textContent='Copia el código e introdúcelo en WhatsApp. Se renueva automáticamente.';
  const guideContent=document.getElementById('guide-content');if(guideContent)guideContent.hidden=true;
  const guideChoose=document.getElementById('guide-choose');if(guideChoose)guideChoose.hidden=false;
  document.getElementById('pairing')?.scrollIntoView({block:'start'});
  return;
 }
 if(service==='copy-help'){document.getElementById('copy-help')?.showModal();return;}
 if(service==='connect'){
  if(typeof corporateService!=='undefined')corporateService='';
  for(const id of ['access-panel','connect','guide']){const el=document.getElementById(id);if(el)el.hidden=false;}
  for(const id of ['welcome','loading','pairing','connected','owner-actions']){const el=document.getElementById(id);if(el)el.hidden=true;}
  document.getElementById('connect')?.scrollIntoView({block:'start'});
  return;
 }
 if(site==='wa'){if(service==='welcome')document.getElementById('wa-welcome')?.showModal();return;}corporateService=service;renderServicePopup();document.getElementById('service-dialog').showModal();}
// Touch gestures work only inside the administration preview, never on public pages.
let hold=null,drag=null,suppressClickUntil=0;
const limit=(v,min,max)=>Math.max(min,Math.min(max,v));
const distance=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
const center=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});
const clean=p=>({x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,scale:Math.round(p.scale*100)/100});
function moveTarget(target){
 if(!editing||!window.pageElementLayout||!target?.closest||target.closest('input,textarea,select,[contenteditable=true]'))return null;
 const hit=pick(target);
 let el=hit?.el||target.closest('[data-cubamax-text],h1,h2,h3,h4,p,button,a,img,video,li,label,article,figure,.service-card,.card,.brand-title,span');
 if(el?.tagName==='SPAN'&&!el.id&&!el.hasAttribute('data-cubamax-text')&&!el.classList.contains('brand-title'))el=el.closest('h1,h2,h3,h4,p,button,a,label,li')||el;
 const key=window.pageElementLayout.keyFor(el);
 return key?{el,key}:null;
}
function clearHold(){if(hold){clearTimeout(hold.timer);hold=null;}}
function beginHold(candidate,point){
 clearHold();if(!candidate)return;
 hold={...candidate,x:point.clientX,y:point.clientY,timer:setTimeout(activate,480)};
}
function activate(){
 if(!hold||drag||!editing)return;
 const h=hold;clearHold();lastTextTap=null;
 const pos=window.pageElementLayout.get(h.key);
 drag={el:h.el,key:h.key,current:{...pos},anchor:{x:h.x,y:h.y,pos:{...pos}},pinch:null,moved:false};
 drag.el.setAttribute('data-element-dragging','');
 suppressClickUntil=Date.now()+800;
 tell({type:'placement-selected',key:h.key});
}
function pinchStart(touches){
 if(!drag||touches.length<2)return;
 const midpoint=center(touches[0],touches[1]);
 drag.pinch={distance:Math.max(distance(touches[0],touches[1]),12),midpoint,pos:{...drag.current}};
}
function updateTouch(touches){
 if(!drag||!touches.length)return;
 let next;
 if(touches.length>=2){
  if(!drag.pinch)pinchStart(touches);
  const first=touches[0],second=touches[1],mid=center(first,second),origin=drag.pinch;
  next={x:origin.pos.x+(mid.x-origin.midpoint.x)/innerWidth*100,y:origin.pos.y+(mid.y-origin.midpoint.y)/innerWidth*100,scale:origin.pos.scale*distance(first,second)/origin.distance};
 }else{
  if(drag.pinch){drag.pinch=null;drag.anchor={x:touches[0].clientX,y:touches[0].clientY,pos:{...drag.current}};}
  const t=touches[0],origin=drag.anchor;
  next={x:origin.pos.x+(t.clientX-origin.x)/innerWidth*100,y:origin.pos.y+(t.clientY-origin.y)/innerWidth*100,scale:origin.pos.scale};
 }
 next=clean({x:limit(next.x,-150,150),y:limit(next.y,-150,150),scale:limit(next.scale,.35,3.5)});
 if(next.x!==drag.current.x||next.y!==drag.current.y||next.scale!==drag.current.scale){
  drag.current=next;drag.moved=true;window.pageElementLayout.set(drag.key,next);
 }
}
function finishDrag(){
 clearHold();if(!drag)return;
 const finished=drag;drag=null;finished.el.removeAttribute('data-element-dragging');
 suppressClickUntil=Date.now()+650;
 if(finished.moved)tell({type:'placement-changed',key:finished.key,position:finished.current});
}
document.addEventListener('touchstart',e=>{
 if(!editing)return;
 if(e.touches.length===1&&!drag){const target=moveTarget(e.target);if(target)beginHold(target,e.touches[0]);}
 else if(e.touches.length>=2){if(hold)activate();if(drag)pinchStart(e.touches);}
},{passive:true,capture:true});
document.addEventListener('touchmove',e=>{
 if(hold&&!drag&&e.touches.length){if(Math.hypot(e.touches[0].clientX-hold.x,e.touches[0].clientY-hold.y)>11)clearHold();return;}
 if(drag){if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();updateTouch(e.touches);}
},{passive:false,capture:true});
document.addEventListener('touchend',e=>{
 if(hold&&!drag)clearHold();
 if(drag){if(e.touches.length===0)finishDrag();else if(e.touches.length===1){drag.pinch=null;const t=e.touches[0];drag.anchor={x:t.clientX,y:t.clientY,pos:{...drag.current}};}}
},{passive:true,capture:true});
document.addEventListener('touchcancel',()=>finishDrag(),true);
document.addEventListener('gesturestart',e=>{if(editing&&(hold||drag)&&e.cancelable)e.preventDefault();},{passive:false});
document.addEventListener('pointerdown',e=>{
 if(!editing||e.pointerType==='touch'||e.button!==0||drag)return;
 beginHold(moveTarget(e.target),e);
},true);
document.addEventListener('pointermove',e=>{
 if(e.pointerType==='touch')return;
 if(hold&&!drag&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>11)clearHold();
 if(drag){e.preventDefault();updateTouch([e]);}
},true);
document.addEventListener('pointerup',e=>{if(e.pointerType==='touch')return;if(hold)clearHold();finishDrag();},true);
document.addEventListener('contextmenu',e=>{if(editing&&(drag||hold||e.target.closest?.('a')))e.preventDefault();},true);
document.addEventListener('dragstart',e=>{if(editing&&drag)e.preventDefault();},true);
document.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
// Only the visual editor closes a preview popup when its dark backdrop is tapped.
document.addEventListener('click',e=>{
 const dialog=e.target;
 if(dialog?.tagName!=='DIALOG'||!dialog.open)return;
 const rect=dialog.getBoundingClientRect();
 if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom)return;
 e.preventDefault();e.stopImmediatePropagation();dialog.close();
 section='';lastTextTap=null;
 if(site==='cm'&&typeof corporateService!=='undefined')corporateService='';
 tell({type:'popup-closed',dialog:dialog.id});
},true);
document.addEventListener('click',e=>{const target=e.target.closest?.('*');if(!target)return;
 if(section==='guide-iphone'||section==='guide-android'){
  if(target.closest('#prelink-close')){e.preventDefault();e.stopImmediatePropagation();document.getElementById('prelink-tutorial')?.close();return;}
  const navigation=target.closest('#prelink-back,#prelink-next,#guide-back,#guide-next');
  if(navigation){e.preventDefault();e.stopImmediatePropagation();lastTextTap=null;guideStep+=navigation.id.endsWith('-back')?-1:1;renderGuideStep();return;}
  const deviceButton=target.closest('#prelink-iphone,#prelink-android,#device-iphone,#device-android');
  if(deviceButton){e.preventDefault();e.stopImmediatePropagation();lastTextTap=null;section='guide-'+(deviceButton.id.endsWith('iphone')?'iphone':'android');guideStep=0;renderGuideStep();tell({type:'guide-device',service:section});return;}
 }
 if(target.closest('#service-close,.dialog-close'))return;const anchor=target.closest('a');if(!editing){if(anchor&&!anchor.getAttribute('href')?.startsWith('#'))e.preventDefault();if(target.closest('#service-continue,#begin,#connect-button')){e.preventDefault();e.stopImmediatePropagation();}return;}const hit=pick(target);if(hit?.field){e.preventDefault();e.stopImmediatePropagation();
 if(hit.field.kind==='text'){
  const now=Date.now(),previous=lastTextTap;
  if(previous&&previous.id===hit.field.id&&previous.el===hit.el&&now-previous.time<=450){lastTextTap=null;select(hit.field.id,hit.el);}
  else lastTextTap={id:hit.field.id,el:hit.el,time:now};
 }else select(hit.field.id,hit.el);return;}const card=target.closest('[data-service]');if(card){e.preventDefault();e.stopImmediatePropagation();popup(card.dataset.service);return;}if(target.closest('button,a,input,select,textarea')){if(anchor?.getAttribute('href')?.startsWith('#'))return;e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;const m=e.data;if(m?.type==='mode'){editing=!!m.editing;document.body.dataset.editing=String(editing);if(!editing)selected?.removeAttribute('data-editor-selected');}if(m?.type==='unselect')selected?.removeAttribute('data-editor-selected');if(m?.type==='popup')popup(m.service,m.step);if(m?.type==='restore'){scrollTo(0,Number(m.scroll)||0);if(m.dismissedWelcome&&!m.service)document.getElementById('wa-welcome')?.close();if(m.service)popup(m.service,m.step);}
if(m?.type==='dismiss-overlays'){for(const d of document.querySelectorAll('dialog[open]'))d.close();section='';}
if(m?.type==='placement-reset'&&typeof m.key==='string'){const pos={x:0,y:0,scale:1};window.pageElementLayout?.set(m.key,pos);tell({type:'placement-changed',key:m.key,position:pos});}
if(m?.type==='placement-revert'&&typeof m.key==='string'){window.pageElementLayout?.set(m.key,window.currentPublicContent?.layout?.[m.key]||{x:0,y:0,scale:1});}});
// Scrolling or dragging must never count as the first half of a double tap.
document.addEventListener('pointercancel',()=>{lastTextTap=null;},true);
window.addEventListener('scroll',()=>{lastTextTap=null;},{passive:true});
let positionTimer;window.addEventListener('scroll',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(()=>tell({type:'position',scroll:scrollY}),150);},{passive:true});
const loading=document.getElementById('loading');if(loading)loading.hidden=true;const welcome=document.getElementById('welcome');if(welcome)welcome.hidden=false;const access=document.getElementById('access-panel');if(access)access.hidden=false;
if(site==='wa'){const b=window.currentPublicContent?.branding;if(b?.logo){const logo=document.getElementById('logo');logo.src=b.logo;logo.hidden=false;document.getElementById('mark').hidden=true;}}
fetch('/api/panel/editor/data?site='+site,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{fields=data.fields;document.body.dataset.editing='true';tell({type:'ready'});}).catch(()=>{document.body.textContent='El acceso al editor venció. Vuelve a abrirlo desde Telegram.';});
})();
