// Shared renderer ONLY for Cubamax and standalone Studio initial popups.
// WhatsApp's original welcome popup remains isolated.
(()=>{
 const defaults={enabled:false,title:'Antes de comenzar',text:'Consulta la información y continúa.',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''};
 const validPhoto=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
 const validColor=/^#[0-9a-f]{6}$/i;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function ensure(id){
  let dialog=document.getElementById(id);
  if(dialog)return dialog;
  dialog=make('dialog','site-initial-popup');dialog.id=id;dialog.setAttribute('aria-modal','true');
  const frame=make('div','site-initial-frame'),cover=make('div','site-initial-cover'),photo=make('img','site-initial-photo');
  photo.alt='';photo.dataset.initialPart='photo';photo.hidden=true;
  const paint=make('canvas','site-initial-paint');paint.hidden=true;paint.setAttribute('aria-hidden','true');
  const targets=make('div','site-initial-targets');targets.hidden=true;
  const copy=make('div','site-initial-copy'),title=make('h2','site-initial-title'),text=make('p','site-initial-text');
  title.id=id+'-title';title.dataset.initialPart='title';text.dataset.initialPart='text';
  dialog.setAttribute('aria-labelledby',title.id);
  copy.append(title,text);cover.append(photo,paint,copy,targets);
  const button=make('button','site-initial-button');button.type='button';button.dataset.initialPart='button';
  button.addEventListener('click',()=>dialog.close());
  frame.append(cover,button);dialog.append(frame);document.body.append(dialog);
  dialog.initialParts={cover,photo,paint,targets,copy,title,text,button};
  return dialog;
 }
 function validLayers(value){
  if(!Array.isArray(value))return [];
  return value.filter(a=>a&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.w)&&Number.isFinite(a.h)&&a.x>=0&&a.y>=0&&a.x+a.w<=1.01&&a.y+a.h<=1.01&&typeof a.text==='string'&&typeof a.original==='string').slice(0,60);
 }
 // The original image is never rewritten; a canvas renders a derived preview.
 // Background reconstruction is approximate on patterned/photographic surfaces.
 function redraw(dialog,layers){
  const {photo,paint,cover}=dialog.initialParts;
  const edited=layers.filter(a=>a.text!==a.original);
  if(!edited.length||!photo.complete||!photo.naturalWidth||!photo.naturalHeight){paint.hidden=true;return;}
  const scale=Math.min(1,1600/photo.naturalWidth,2400/photo.naturalHeight),w=Math.round(photo.naturalWidth*scale),h=Math.round(photo.naturalHeight*scale);
  if(!w||!h)return;
  if(paint.width!==w)paint.width=w;if(paint.height!==h)paint.height=h;
  const ctx=paint.getContext?.('2d',{willReadFrequently:true});if(!ctx)return;
  try{ctx.clearRect(0,0,w,h);ctx.drawImage(photo,0,0,w,h);}
  catch{paint.hidden=true;return;}
  for(const layer of edited){
   const x=clamp(Math.round(layer.x*w),0,w-1),y=clamp(Math.round(layer.y*h),0,h-1);
   const right=clamp(Math.ceil((layer.x+layer.w)*w),x+1,w),bottom=clamp(Math.ceil((layer.y+layer.h)*h),y+1,h);
   const width=right-x,height=bottom-y;
   // Reconstruct a background band, reading pixels on both sides of the
   // original phrase. This is reversible because the underlying img is kept.
   try{
    for(let row=y;row<bottom;row++){
     const left=ctx.getImageData(clamp(x-3,0,w-1),row,1,1).data;
     const rightSide=ctx.getImageData(clamp(right+2,0,w-1),row,1,1).data;
     const gradient=ctx.createLinearGradient(x,row,right,row);
     gradient.addColorStop(0,'rgb('+left[0]+','+left[1]+','+left[2]+')');
     gradient.addColorStop(1,'rgb('+rightSide[0]+','+rightSide[1]+','+rightSide[2]+')');
     ctx.fillStyle=gradient;ctx.fillRect(x,row,width,1);
    }
   }catch{continue;}
   const phrase=layer.text.slice(0,280).trim();if(!phrase)continue;
   const family=['Arial','Helvetica','Georgia','Times New Roman','Verdana','system-ui'].includes(layer.family)?layer.family:'Arial';
   const weight=['400','500','600','700','800','900'].includes(String(layer.weight))?String(layer.weight):'700';
   let font=clamp(Number(layer.fontSize||height)*scale,6,500);
   const maxWidth=Math.max(1,width-4);
   ctx.font=weight+' '+font+'px "'+family+'"';
   let measured=ctx.measureText(phrase).width;
   if(measured>maxWidth){font=Math.max(5,font*maxWidth/Math.max(1,measured));ctx.font=weight+' '+font+'px "'+family+'"';}
   const background=ctx.getImageData(clamp(x+2,0,w-1),clamp(y+1,0,h-1),1,1).data;
   const bright=(background[0]*0.21+background[1]*0.72+background[2]*0.07)>170;
   ctx.fillStyle=validColor.test(layer.color||'')?(layer.color.toLowerCase()==='#ffffff'&&bright?'#151515':layer.color):(bright?'#151515':'#ffffff');
   ctx.textAlign='left';ctx.textBaseline='middle';
   ctx.fillText(phrase,x+2,y+height/2,maxWidth);
  }
  paint.hidden=false;
 }
 function setTargets(dialog,layers,options){
  const {targets}=dialog.initialParts;
  if(typeof targets.replaceChildren==='function')targets.replaceChildren();else targets.children=[];
  if(typeof options.onTextDoubleTap!=='function'||!layers.length){targets.hidden=true;return;}
  targets.hidden=false;
  layers.forEach((layer,index)=>{
   const target=make('button','site-initial-target');
   target.type='button';target.setAttribute('aria-label','Doble toque para editar: '+layer.text.slice(0,100));
   target.title='Doble toque para editar frase';
   target.style.left=(layer.x*100)+'%';target.style.top=(layer.y*100)+'%';
   target.style.width=(layer.w*100)+'%';target.style.height=(layer.h*100)+'%';
   target.dataset.layerIndex=String(index);
   let last=0;
   target.addEventListener('click',event=>{
    event.preventDefault();
    const now=Date.now();
    if(now-last<480){last=0;options.onTextDoubleTap(index,layer);}
    else last=now;
   });
   targets.append(target);
  });
 }
 function render(dialog,value={},options){
  const config={...defaults,...(value&&typeof value==='object'?value:{})};
  if(options)dialog.initialOptions=options;
  const controls=dialog.initialOptions||{};
  const {cover,photo,paint,copy,title,text,button}=dialog.initialParts||ensure(dialog.id).initialParts;
  const hasPhoto=validPhoto.test(config.photo||'');
  const layers=hasPhoto?validLayers(config.layers):[];
  dialog.classList.toggle('has-photo',hasPhoto);
  photo.hidden=!hasPhoto;
  if(!hasPhoto){photo.removeAttribute('src');paint.hidden=true;cover.style.aspectRatio='';}
  else{
   const repaint=()=>{if(photo.naturalWidth&&photo.naturalHeight)cover.style.aspectRatio=photo.naturalWidth+' / '+photo.naturalHeight;redraw(dialog,layers);};
   photo.onload=repaint;
   if(photo.getAttribute?.('src')!==config.photo)photo.src=config.photo;
   else if(photo.complete&&photo.naturalWidth)repaint();
  }
  copy.classList.toggle('is-visually-hidden',hasPhoto);
  title.textContent=String(config.title||defaults.title).slice(0,120);
  text.textContent=String(config.text||defaults.text).slice(0,4000);
  button.textContent=String(config.button||defaults.button).slice(0,80);
  button.style.backgroundColor=validColor.test(config.color||'')?config.color:defaults.color;
  button.style.color=validColor.test(config.textColor||'')?config.textColor:defaults.textColor;
  setTargets(dialog,layers,controls);
  return dialog;
 }
 function show(id,value,options={}){
  const dialog=ensure(id);render(dialog,value,options);
  if(value?.enabled||options.preview){if(!dialog.open)dialog.showModal();}
  else if(dialog.open)dialog.close();
  return dialog;
 }
 window.SiteInitialPopup={defaults,ensure,render,show};
})();
