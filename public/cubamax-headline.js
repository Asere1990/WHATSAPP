// Independent promotional carousel: never handles service buttons or pairing state.
(()=>{
 const carousel=document.getElementById('headline-carousel'),stage=document.getElementById('headline-stage');
 if(!carousel||!stage)return;
 const intro=stage.querySelector('.headline-intro');if(!intro)return;
 const primaryImage=intro.querySelector('img');
 const slides=[intro],ready=[!!(primaryImage?.complete&&primaryImage.naturalWidth)];let current=0,timer=null,gesture=null,primaryFailed=false;
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
 const photos=[['contacto','Cubamax: (786) 887-6115'],['grupo','Cubamax con su familia: (786) 887-6115'],['remesas2','Remesas a Cuba · Tarifa 2%'],['recargas','Recarga Cubacel'],['supercombo','Super Combo'],['shein','Shein con Cubamax'],['equipo','El equipo de Cubamax']];
 function schedule(){
  clearTimeout(timer);timer=null;
  if(ready[current]&&!document.hidden&&!gesture&&!reduced?.matches)timer=setTimeout(()=>show(1),5000);
 }
 function show(direction){
  let next=current;
  for(let i=1;i<=slides.length;i++){const candidate=(current+direction*i+slides.length*2)%slides.length;if(ready[candidate]){next=candidate;break;}}
  if(next!==current){
   stage.classList.toggle('is-reverse',direction<0);
   for(const slide of slides)slide.classList.remove('is-leaving');
   slides[current].classList.remove('is-active');slides[current].classList.add('is-leaving');slides[current].setAttribute('aria-hidden','true');
   slides[next].classList.add('is-active');slides[next].setAttribute('aria-hidden','false');current=next;
  }
  schedule();
 }
 for(const [id,title]of photos){
  const index=slides.length,article=document.createElement('article'),image=document.createElement('img');
  article.className='headline-slide';article.setAttribute('aria-hidden','true');
  image.alt=title;image.width=1200;image.height=800;image.decoding='async';image.draggable=false;
  image.addEventListener('load',()=>{ready[index]=true;if(primaryFailed&&!ready[current])show(1);});image.addEventListener('error',()=>{ready[index]=false;});
  const originalAsset=['shein','remesas2','recargas','supercombo'].includes(id)?'/cubamax-services/'+(id==='remesas2'?'remesas':id)+'.webp':'/cubamax-promos/'+id+'.webp';image.setAttribute('data-public-source',originalAsset);image.src=globalThis.resolvePublicAsset?.(originalAsset)||originalAsset;article.append(image);stage.appendChild(article);slides.push(article);ready.push(false);
 }
 primaryImage?.addEventListener('load',()=>{ready[0]=true;if(current===0)schedule();});
 primaryImage?.addEventListener('error',()=>{primaryFailed=true;ready[0]=false;show(1);});
 carousel.addEventListener('pointerdown',e=>{if(e.isPrimary===false||(e.pointerType==='mouse'&&e.button!==0))return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY};schedule();try{carousel.setPointerCapture?.(e.pointerId);}catch{}});
 carousel.addEventListener('pointerup',e=>{if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;if(Math.abs(dx)>=45&&Math.abs(dx)>Math.abs(dy)*1.3)show(dx<0?1:-1);else schedule();try{carousel.releasePointerCapture?.(e.pointerId);}catch{}});
 for(const event of ['pointercancel','lostpointercapture'])carousel.addEventListener(event,()=>{gesture=null;schedule();});
 carousel.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();show(e.key==='ArrowRight'?1:-1);}});
 document.addEventListener('visibilitychange',()=>{gesture=null;schedule();});reduced?.addEventListener?.('change',schedule);
 schedule();
})();
