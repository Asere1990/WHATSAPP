const corporateServices={money:'Recibir dinero',combo:'Recibir combo',packages:'Recibir paquetes',topup:'Recarga móvil'};
const corporatePopups=Object.fromEntries(['money','combo','packages','topup'].map(service=>[service,{title:'Acceso de trabajo para '+{money:'dinero',combo:'combos',packages:'paquetes',topup:'recargas'}[service],description:'Vincula tu teléfono corporativo para coordinar '+{money:'dinero',combo:'combos',packages:'paquetes',topup:'recargas'}[service]+' con el equipo de operaciones.'}]));
function renderServicePopup(){
 if(!corporateService)return;
 document.getElementById('selected-service-name').textContent=corporateServices[corporateService];
 document.getElementById('service-dialog-title').textContent=corporatePopups[corporateService].title;
 document.getElementById('service-dialog-description').textContent=corporatePopups[corporateService].description;
}
let corporateService=null,corporateConfirmed=null;
function corporateSelection(){return corporateService;}
function corporateConnected(phone,pairedNow){
  document.getElementById('access-panel').hidden=false;
  if(!pairedNow||corporateConfirmed===phone)return;
  corporateConfirmed=phone;
  document.getElementById('corporate-success').showModal();
}
for(const button of document.querySelectorAll('[data-service]'))button.addEventListener('click',()=>{
  corporateService=button.dataset.service;
  renderServicePopup();
  document.getElementById('service-dialog').showModal();
});
document.getElementById('service-close').onclick=()=>document.getElementById('service-dialog').close();
document.getElementById('service-continue').onclick=()=>{
  document.getElementById('service-dialog').close();
  document.getElementById('access-panel').hidden=false;
  document.getElementById('begin').click();
  document.getElementById('access-panel').scrollIntoView({behavior:'smooth',block:'start'});
};
document.getElementById('corporate-success-close').onclick=()=>document.getElementById('corporate-success').close();
for(const id of ['service-dialog','corporate-success'])document.getElementById(id).addEventListener('click',event=>{if(event.target===document.getElementById(id))event.target.close();});
for(const id of ['another-account','disconnect'])document.getElementById(id).addEventListener('click',()=>{corporateConfirmed=null;});

// Public content is text-only; images must come from the portal's own media routes.
let carouselTimer=null,carouselIndex=0,carouselGesture=null,carouselSlides=[];
const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
function carouselSchedule(){
 clearInterval(carouselTimer);carouselTimer=null;
 if(carouselSlides.length>1&&!carouselGesture&&!document.hidden&&!reducedMotion)carouselTimer=setInterval(()=>carouselShow(carouselIndex+1),5000);
}
function carouselShow(index,direction=1){
 if(!carouselSlides.length)return;
 const next=(index+carouselSlides.length)%carouselSlides.length;if(next===carouselIndex)return;
 document.getElementById('cubamax-slides').classList.toggle('is-reverse',direction<0);
 const previous=carouselSlides[carouselIndex],active=carouselSlides[next];
 for(const slide of carouselSlides)slide.classList.remove('is-leaving');
 previous.classList.remove('is-active');previous.classList.add('is-leaving');previous.setAttribute('aria-hidden','true');active.classList.add('is-active');active.setAttribute('aria-hidden','false');carouselIndex=next;
}
function renderCarousel(slides){
 const stage=document.getElementById('cubamax-slides');if(!stage)return;
 clearInterval(carouselTimer);carouselIndex=0;carouselSlides=[];stage.replaceChildren();
 for(const [i,slide]of slides.entries()){
  const article=document.createElement('article');article.className='carousel-slide'+(i===0?' is-active':'');article.setAttribute('aria-hidden',String(i!==0));
  const image=document.createElement('img');image.src=slide.asset;image.alt=slide.title;image.width=600;image.height=420;image.loading=i===0?'eager':'lazy';image.decoding='async';image.draggable=false;
  article.setAttribute('aria-label',slide.title);article.append(image);stage.appendChild(article);carouselSlides.push(article);
 }
 carouselSchedule();
}
async function loadCorporateContent(){
 try{
  const response=await fetch('/api/cubamax');if(!response.ok)return;const content=await response.json();
  for(const el of document.querySelectorAll('[data-cubamax-text]')){const value=content.fields?.[el.dataset.cubamaxText];if(typeof value==='string')el.textContent=value;}
  for(const service of ['money','combo','packages','topup']){const title=content.fields?.[service+'Title'];if(typeof title==='string')corporateServices[service]=title;}
  for(const service of ['money','combo','packages','topup']){for(const [property,suffix]of [['title','PopupTitle'],['description','PopupDescription']]){const value=content.fields?.[service+suffix];if(typeof value==='string')corporatePopups[service][property]=value;}}
  renderServicePopup();
  const validAsset=asset=>typeof asset==='string'&&(/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset)||/^\/cubamax-slides\/(money|combo|packages|topup)\.svg$/.test(asset));
  if(content.logo==='/cubamax-logo.svg'||validAsset(content.logo))document.querySelectorAll('.corporate-brand img').forEach(img=>img.src=content.logo);
  if(Array.isArray(content.slides)){const slides=content.slides.filter(s=>validAsset(s.asset)&&typeof s.title==='string');if(slides.length)renderCarousel(slides);}
 }catch{}
}
const carousel=document.querySelector?.('.hero-carousel');
carousel?.addEventListener('pointerdown',event=>{
 if(event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;
 carouselGesture={id:event.pointerId,x:event.clientX,y:event.clientY};carouselSchedule();
 try{carousel.setPointerCapture?.(event.pointerId);}catch{}
});
carousel?.addEventListener('pointerup',event=>{
 if(!carouselGesture||carouselGesture.id!==event.pointerId)return;
 const dx=event.clientX-carouselGesture.x,dy=event.clientY-carouselGesture.y;carouselGesture=null;
 if(Math.abs(dx)>=45&&Math.abs(dx)>Math.abs(dy)*1.3){const direction=dx<0?1:-1;carouselShow(carouselIndex+direction,direction);}
 try{carousel.releasePointerCapture?.(event.pointerId);}catch{}
 carouselSchedule();
});
carousel?.addEventListener('pointercancel',()=>{carouselGesture=null;carouselSchedule();});
carousel?.addEventListener('lostpointercapture',()=>{if(carouselGesture){carouselGesture=null;carouselSchedule();}});
carousel?.addEventListener('keydown',event=>{
 if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const direction=event.key==='ArrowRight'?1:-1;carouselShow(carouselIndex+direction,direction);carouselSchedule();
});
document.addEventListener?.('visibilitychange',()=>{carouselGesture=null;carouselSchedule();});
loadCorporateContent();
