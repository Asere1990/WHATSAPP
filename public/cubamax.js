const corporateServices={money:'Recibir dinero',combo:'Recibir combo',packages:'Recibir paquetes',topup:'Recarga móvil'};
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
  document.getElementById('selected-service-name').textContent=corporateServices[corporateService];
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
let carouselTimer=null,carouselIndex=0,carouselPaused=false,carouselHovered=false,carouselFocused=false,carouselSlides=[];
const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
function carouselSchedule(){
 clearInterval(carouselTimer);carouselTimer=null;
 if(carouselSlides.length>1&&!carouselPaused&&!carouselHovered&&!carouselFocused&&!document.hidden&&!reducedMotion)carouselTimer=setInterval(()=>carouselShow(carouselIndex+1),5000);
}
function carouselShow(index){
 if(!carouselSlides.length)return;
 const next=(index+carouselSlides.length)%carouselSlides.length;if(next===carouselIndex)return;
 const previous=carouselSlides[carouselIndex],active=carouselSlides[next];
 for(const slide of carouselSlides)slide.classList.remove('is-leaving');
 previous.classList.remove('is-active');previous.classList.add('is-leaving');previous.setAttribute('aria-hidden','true');active.classList.add('is-active');active.setAttribute('aria-hidden','false');carouselIndex=next;
 document.querySelectorAll('#carousel-dots button').forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===next)));
}
function renderCarousel(slides){
 const stage=document.getElementById('cubamax-slides'),dots=document.getElementById('carousel-dots');if(!stage||!dots)return;
 clearInterval(carouselTimer);carouselIndex=0;carouselSlides=[];stage.replaceChildren();dots.replaceChildren();
 for(const [i,slide]of slides.entries()){
  const article=document.createElement('article');article.className='carousel-slide'+(i===0?' is-active':'');article.setAttribute('aria-hidden',String(i!==0));
  const image=document.createElement('img');image.src=slide.asset;image.alt=slide.title;image.width=600;image.height=420;image.loading=i===0?'eager':'lazy';image.decoding='async';
  const caption=document.createElement('h3');caption.textContent=slide.title;article.append(image,caption);stage.appendChild(article);carouselSlides.push(article);
  const dot=document.createElement('button');dot.type='button';dot.setAttribute('aria-label',`Ver imagen ${i+1}: ${slide.title}`);dot.setAttribute('aria-pressed',String(i===0));dot.onclick=()=>{carouselShow(i);carouselSchedule();};dots.appendChild(dot);
 }
 carouselSchedule();
}
async function loadCorporateContent(){
 try{
  const response=await fetch('/api/cubamax');if(!response.ok)return;const content=await response.json();
  for(const el of document.querySelectorAll('[data-cubamax-text]')){const value=content.fields?.[el.dataset.cubamaxText];if(typeof value==='string')el.textContent=value;}
  for(const service of ['money','combo','packages','topup']){const title=content.fields?.[service+'Title'];if(typeof title==='string')corporateServices[service]=title;}
  const validAsset=asset=>typeof asset==='string'&&(/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset)||/^\/cubamax-slides\/(money|combo|packages|topup)\.svg$/.test(asset));
  if(content.logo==='/cubamax-logo.svg'||validAsset(content.logo))document.querySelectorAll('.corporate-brand img').forEach(img=>img.src=content.logo);
  if(Array.isArray(content.slides)){const slides=content.slides.filter(s=>validAsset(s.asset)&&typeof s.title==='string');if(slides.length)renderCarousel(slides);}
 }catch{}
}
for(const [id,offset]of [['carousel-prev',-1],['carousel-next',1]])document.getElementById(id)?.addEventListener('click',()=>{carouselShow(carouselIndex+offset);carouselSchedule();});
document.getElementById('carousel-pause')?.addEventListener('click',event=>{carouselPaused=!carouselPaused;event.currentTarget.textContent=carouselPaused?'▶':'Ⅱ';event.currentTarget.setAttribute('aria-label',carouselPaused?'Reanudar carrusel':'Pausar carrusel');carouselSchedule();});
const carousel=document.querySelector?.('.hero-carousel');
carousel?.addEventListener('mouseenter',()=>{carouselHovered=true;carouselSchedule();});carousel?.addEventListener('mouseleave',()=>{carouselHovered=false;carouselSchedule();});
carousel?.addEventListener('focusin',()=>{carouselFocused=true;carouselSchedule();});carousel?.addEventListener('focusout',event=>{if(!carousel.contains(event.relatedTarget)){carouselFocused=false;carouselSchedule();}});
document.addEventListener?.('visibilitychange',carouselSchedule);
loadCorporateContent();
