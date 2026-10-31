// Optional OCR overlays for the EXISTING WhatsApp welcome popup.
// This script never opens or replaces the dialog, changes its CTA or affects
// personalized associated-link / Cubamax operator popups.
(()=>{
 const dialog=document.getElementById('wa-welcome');
 const photo=document.getElementById('wa-welcome-photo');
 if(!dialog||!photo)return;
 const content=photo.parentElement;
 if(!content)return;
 const validPhoto=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
 let paint=null,targets=null,activeLayers=[],currentPhoto='',active=false;
 let onTextDoubleTap=null;
 const inEditor=()=>document.body?.dataset?.visualPreview==='true';
 function nodes(){
  if(paint&&targets)return;
  paint=document.createElement('canvas');
  paint.id='wa-welcome-photo-ocr-paint';
  paint.hidden=true;paint.setAttribute('aria-hidden','true');
  targets=document.createElement('div');
  targets.id='wa-welcome-photo-ocr-targets';targets.hidden=true;
  content.insertBefore(paint,photo.nextSibling);
  content.insertBefore(targets,paint.nextSibling);
 }
 function updatePreview(){
  if(!paint)return;
  if(!active||!currentPhoto||!photo.complete||!photo.naturalWidth||!photo.naturalHeight){
   paint.hidden=true;dialog.classList.remove('has-ocr-paint');return;
  }
  const draw=globalThis.SiteInitialPopup?.paintInto;
  if(typeof draw!=='function'){paint.hidden=true;return;}
  draw({photo,paint,targets,cover:content},activeLayers,{
   onTextDoubleTap:inEditor()?onTextDoubleTap:null
  });
  dialog.classList.toggle('has-ocr-paint',!paint.hidden);
 }
 function render(value,isOriginal=true){
  const published=globalThis.currentPublicContent?.welcomePopup;
  const photoPath=typeof value?.photo==='string'?value.photo:'';
  const isOwn=!!isOriginal&&validPhoto.test(photoPath)&&photoPath===published?.photo;
  const layers=isOwn&&Array.isArray(value?.layers)
   ?value.layers.filter(x=>x&&x.source===photoPath):[];
  active=!!layers.length;activeLayers=layers;currentPhoto=active?photoPath:'';
  if(!active){
   if(paint){paint.hidden=true;targets.hidden=true;targets.replaceChildren();dialog.classList.remove('has-ocr-paint');}
   return;
  }
  nodes();
  // Welcome's pre-existing renderer is still the sole owner of photo.src.
  // Repaint only once the correct original photo has actually loaded.
  photo.onload=()=>{
   if(currentPhoto===photo.getAttribute('src'))updatePreview();
  };
  if(photo.complete&&photo.naturalWidth&&photo.getAttribute('src')===currentPhoto)updatePreview();
  else {paint.hidden=true;targets.hidden=true;dialog.classList.remove('has-ocr-paint');}
 }
 function enableEditing(callback){
  onTextDoubleTap=typeof callback==='function'?callback:null;
  updatePreview();
 }
 globalThis.WelcomePhotoOCR={render,enableEditing};
 // welcome-popup.js executes before this module. Refresh its already-rendered
 // page once, without triggering its associated-link or login workflow.
 render(globalThis.currentPublicContent?.welcomePopup,true);
})();
