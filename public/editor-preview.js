(()=>{
const site=document.body.classList.contains('corporate-portal')?'cm':'wa';let fields=[],editing=true,selected=null,section='';
const tell=m=>parent.postMessage(m,location.origin);
function select(id,el){if(selected)selected.removeAttribute('data-editor-selected');selected=el;el?.setAttribute('data-editor-selected','');tell({type:'selection',id,scroll:scrollY,service:section|| (site==='cm'&&typeof corporateService!=='undefined'?corporateService:'')});}
function pick(target){
 const find=id=>fields.find(f=>f.id===id);
 if(site==='wa')for(const key of ['title','text','button','photo']){const el=target.closest('#wa-welcome-'+key);if(el)return {field:find('welcome:'+key),el};}
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
function popup(service){section=service;
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 if(service==='connect'){
  if(typeof corporateService!=='undefined')corporateService='';
  for(const id of ['access-panel','connect','guide']){const el=document.getElementById(id);if(el)el.hidden=false;}
  for(const id of ['welcome','loading','pairing','connected','owner-actions']){const el=document.getElementById(id);if(el)el.hidden=true;}
  document.getElementById('connect')?.scrollIntoView({block:'start'});
  return;
 }
 if(site==='wa'){if(service==='welcome')document.getElementById('wa-welcome')?.showModal();return;}corporateService=service;renderServicePopup();document.getElementById('service-dialog').showModal();}
document.addEventListener('click',e=>{const target=e.target.closest?.('*');if(!target)return;if(target.closest('#service-close,.dialog-close'))return;const anchor=target.closest('a');if(!editing){if(anchor&&!anchor.getAttribute('href')?.startsWith('#'))e.preventDefault();if(target.closest('#service-continue,#begin,#connect-button')){e.preventDefault();e.stopImmediatePropagation();}return;}const hit=pick(target);if(hit?.field){e.preventDefault();e.stopImmediatePropagation();
 if(hit.field.kind==='text'){
  const now=Date.now(),previous=lastTextTap;
  if(previous&&previous.id===hit.field.id&&previous.el===hit.el&&now-previous.time<=450){lastTextTap=null;select(hit.field.id,hit.el);}
  else lastTextTap={id:hit.field.id,el:hit.el,time:now};
 }else select(hit.field.id,hit.el);return;}const card=target.closest('[data-service]');if(card){e.preventDefault();e.stopImmediatePropagation();popup(card.dataset.service);return;}if(target.closest('button,a,input,select,textarea')){if(anchor?.getAttribute('href')?.startsWith('#'))return;e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;const m=e.data;if(m?.type==='mode'){editing=!!m.editing;document.body.dataset.editing=String(editing);if(!editing)selected?.removeAttribute('data-editor-selected');}if(m?.type==='unselect')selected?.removeAttribute('data-editor-selected');if(m?.type==='popup')popup(m.service);if(m?.type==='restore'){scrollTo(0,Number(m.scroll)||0);if(m.service)popup(m.service);}});
// Scrolling or dragging must never count as the first half of a double tap.
document.addEventListener('pointercancel',()=>{lastTextTap=null;},true);
window.addEventListener('scroll',()=>{lastTextTap=null;},{passive:true});
let positionTimer;window.addEventListener('scroll',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(()=>tell({type:'position',scroll:scrollY}),150);},{passive:true});
const loading=document.getElementById('loading');if(loading)loading.hidden=true;const welcome=document.getElementById('welcome');if(welcome)welcome.hidden=false;const access=document.getElementById('access-panel');if(access)access.hidden=false;
if(site==='wa'){const b=window.currentPublicContent?.branding;if(b?.logo){const logo=document.getElementById('logo');logo.src=b.logo;logo.hidden=false;document.getElementById('mark').hidden=true;}}
fetch('/api/panel/editor/data?site='+site,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{fields=data.fields;document.body.dataset.editing='true';tell({type:'ready'});}).catch(()=>{document.body.textContent='El acceso al editor venció. Vuelve a abrirlo desde Telegram.';});
})();
