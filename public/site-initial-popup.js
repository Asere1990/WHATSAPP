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
  const {photo,paint}=dialog.initialParts;
  const edited=layers.filter(a=>a.text!==a.original||a.styled===true||
    (Number.isFinite(a.drawX)&&a.drawX!==a.x)||(Number.isFinite(a.drawY)&&a.drawY!==a.y));
  if(!edited.length||!photo.complete||!photo.naturalWidth||!photo.naturalHeight){paint.hidden=true;return;}
  const scale=Math.min(1,1600/photo.naturalWidth,2400/photo.naturalHeight);
  const w=Math.round(photo.naturalWidth*scale),h=Math.round(photo.naturalHeight*scale);
  if(!w||!h)return;
  if(paint.width!==w)paint.width=w;if(paint.height!==h)paint.height=h;
  const ctx=paint.getContext?.('2d',{willReadFrequently:true});if(!ctx)return;
  try{ctx.clearRect(0,0,w,h);ctx.drawImage(photo,0,0,w,h);}
  catch{paint.hidden=true;return;}

  // Sample ALL background colors from the untouched image before painting.
  // Nearby white letters otherwise contaminate edge colors and make stripes.
  const edge=(x,y,side)=>{
   const points=[];
   for(const gap of [9,19,31])for(const dy of [-5,0,5]){
    try{
     const c=ctx.getImageData(clamp(x+side*gap,0,w-1),clamp(y+dy,0,h-1),1,1).data;
     points.push({color:[c[0],c[1],c[2]],light:c[0]*.2126+c[1]*.7152+c[2]*.0722});
    }catch{}
   }
   if(!points.length)return [0,0,0];
   points.sort((a,b)=>a.light-b.light);
   const clean=points.slice(0,Math.max(1,Math.ceil(points.length*.65)));
   return [0,1,2].map(i=>Math.round(clean.reduce((sum,p)=>sum+p.color[i],0)/clean.length));
  };
  const planned=edited.map(layer=>{
   const x=clamp(Math.round(layer.x*w),0,w-1),y=clamp(Math.round(layer.y*h),0,h-1);
   const right=clamp(Math.ceil((layer.x+layer.w)*w),x+1,w);
   const bottom=clamp(Math.ceil((layer.y+layer.h)*h),y+1,h);
   const bands=[];
   for(let row=y;row<bottom;row+=6){
    const bandH=Math.min(6,bottom-row),mid=row+Math.floor(bandH/2);
    bands.push({row,bandH,left:edge(x,mid,-1),right:edge(right-1,mid,1)});
   }
   return {layer,x,y,right,bottom,bands,
    background:edge(x,y+Math.floor((bottom-y)/2),-1)};
  });
  // First remove all old OCR boxes. This prevents the next overlapping OCR
  // line from erasing the text that was already moved/drawn.
  for(const {x,right,bands} of planned){
   for(const {row,bandH,left,right:other} of bands){
    const gradient=ctx.createLinearGradient(x,row,right,row);
    gradient.addColorStop(0,'rgb('+left.join(',')+')');
    gradient.addColorStop(1,'rgb('+other.join(',')+')');
    ctx.fillStyle=gradient;ctx.fillRect(x,row,right-x,bandH);
   }
  }
  // Only when the entire background is restored, draw each changed phrase.
  // This keeps manual font sizes and dragged coordinates completely intact.
  for(const {layer,y,bottom,background} of planned){
   const phrase=layer.text.slice(0,280).trim();if(!phrase)continue;
   const family=['Arial','Helvetica','Georgia','Times New Roman','Verdana','system-ui'].includes(layer.family)?layer.family:'Arial';
   const weight=['400','500','600','700','800','900'].includes(String(layer.weight))?String(layer.weight):'700';
   const font=Math.max(1,Number(layer.fontSize||(bottom-y)/scale)*scale);
   const textX=clamp(Math.round((layer.drawX??layer.x)*w),0,w-1);
   const textY=clamp(Math.round((layer.drawY??layer.y)*h),0,h-1);
   ctx.font=weight+' '+font+'px "'+family+'"';
   const bright=(background[0]*.21+background[1]*.72+background[2]*.07)>170;
   ctx.fillStyle=validColor.test(layer.color||'')?
    (layer.color.toLowerCase()==='#ffffff'&&bright?'#151515':layer.color):
    (bright?'#151515':'#ffffff');
   ctx.textAlign='left';ctx.textBaseline='middle';
   ctx.fillText(phrase,textX+2,textY+(bottom-y)/2);
  }
  paint.hidden=false;
 }
 function setTargets(dialog,layers,options){
  const {targets,cover}=dialog.initialParts;
  if(typeof targets.replaceChildren==='function')targets.replaceChildren();else targets.children=[];
  const editable=typeof options.onTextDoubleTap==='function'||typeof options.onTextDragEnd==='function';
  if(!editable||!layers.length){targets.hidden=true;return;}
  targets.hidden=false;
  // Never mutate the public snapshot while moving the phrase in a draft.
  const preview=layers.map(layer=>({...layer}));
  layers.forEach((_,index)=>{
   const layer=preview[index],target=make('button','site-initial-target');
   target.type='button';target.setAttribute('aria-label','Doble toque para editar: '+layer.text.slice(0,100));
   target.title='Doble toque para editar; mantener pulsado para mover';
   target.style.left=((layer.drawX??layer.x)*100)+'%';
   target.style.top=((layer.drawY??layer.y)*100)+'%';
   target.style.width=(layer.w*100)+'%';target.style.height=(layer.h*100)+'%';
   target.dataset.layerIndex=String(index);
   let last=0,press=null,skipClickUntil=0,raf=false;
   const cancelTimer=()=>{if(press?.timer&&typeof clearTimeout==='function')clearTimeout(press.timer);};
   const repaint=()=>{
    if(typeof requestAnimationFrame==='function'){
     if(raf)return;raf=true;requestAnimationFrame(()=>{raf=false;redraw(dialog,preview);});
    }else redraw(dialog,preview);
   };
   target.addEventListener('pointerdown',event=>{
    if(typeof options.onTextDragEnd!=='function'||event.button>0)return;
    if(press)cancelTimer();
    press={id:event.pointerId,sx:event.clientX,sy:event.clientY,
     x:layer.drawX??layer.x,y:layer.drawY??layer.y,active:false,moved:false,timer:null};
    if(typeof setTimeout==='function')press.timer=setTimeout(()=>{
     if(!press||press.id!==event.pointerId)return;
     press.active=true;last=0;
     target.classList?.add?.('is-dragging');
     target.setPointerCapture?.(event.pointerId);
    },420);
   });
   target.addEventListener('pointermove',event=>{
    if(!press||press.id!==event.pointerId)return;
    if(!press.active){
     if(Math.hypot(event.clientX-press.sx,event.clientY-press.sy)>12){cancelTimer();press=null;}
     return;
    }
    event.preventDefault?.();
    const rect=cover.getBoundingClientRect?.();
    if(!rect?.width||!rect?.height)return;
    const drawX=clamp(press.x+(event.clientX-press.sx)/rect.width,0,Math.max(0,1-layer.w));
    const drawY=clamp(press.y+(event.clientY-press.sy)/rect.height,0,Math.max(0,1-layer.h));
    layer.drawX=Math.round(drawX*10000)/10000;
    layer.drawY=Math.round(drawY*10000)/10000;
    press.moved=press.moved||layer.drawX!==press.x||layer.drawY!==press.y;
    target.style.left=(layer.drawX*100)+'%';target.style.top=(layer.drawY*100)+'%';
    repaint();
   });
   const finish=event=>{
    if(!press||event.pointerId!==press.id)return;
    const done=press;cancelTimer();press=null;
    if(done.active){
     skipClickUntil=Date.now()+650;
     target.classList?.remove?.('is-dragging');
     target.releasePointerCapture?.(event.pointerId);
     if(done.moved){
      redraw(dialog,preview);
      options.onTextDragEnd(index,{drawX:layer.drawX,drawY:layer.drawY});
     }
     event.preventDefault?.();
    }
   };
   target.addEventListener('pointerup',finish);
   target.addEventListener('pointercancel',event=>{cancelTimer();press=null;target.classList?.remove?.('is-dragging');});
   target.addEventListener('click',event=>{
    event.preventDefault();
    if(Date.now()<skipClickUntil)return;
    const now=Date.now();
    if(now-last<480){last=0;options.onTextDoubleTap?.(index,layer);}
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
 // Reuse the same non-destructive image painting logic in WhatsApp's
 // existing welcome dialog. No replacement of its popup or button is needed.
 function paintInto(parts,layers,options={}){
  const dialog={initialParts:parts},valid=validLayers(layers);
  redraw(dialog,valid);
  setTargets(dialog,valid,options);
 }
 window.SiteInitialPopup={defaults,ensure,render,show,paintInto};
})();
