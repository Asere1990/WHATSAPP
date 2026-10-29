(()=>{
const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
window.StudioCanvas={render(canvas,design,{editing=false,select=()=>{},move=()=>{},selected=''}={}){
 let lastTextTap=null;
 canvas.replaceChildren();canvas.className='studio-canvas';canvas.style.aspectRatio=design.width+'/'+design.height;canvas.style.maxWidth=design.width+'px';
 if(design.background){const bg=make('img');bg.src=design.background;bg.alt='Diseño de la página';bg.className='canvas-background';canvas.append(bg);}
 for(const e of design.elements){const box=make('div');box.className='canvas-element'+(editing?' editable':'')+(selected===e.id?' selected':'');box.dataset.element=e.id;Object.assign(box.style,{left:e.x+'%',top:e.y+'%',width:e.w+'%',height:e.h+'%',color:e.color,backgroundColor:['image','video','text'].includes(e.kind)?'transparent':e.background,fontSize:(e.size/design.width*100)+'cqw',borderRadius:e.radius+'px',border:e.border+'px solid '+e.color});let control;
 if(e.kind==='image'||e.kind==='video'){control=make(e.kind==='image'?'img':'video');control.src=e.asset;control.alt=e.label;if(e.kind==='video'){control.controls=!editing;control.playsInline=true;control.preload='none';}}
 else if(['username','password','field'].includes(e.kind)){control=make('input');control.id='input-'+e.id;control.name=e.id;control.placeholder=e.label;control.setAttribute('aria-label',e.label);control.maxLength=e.kind==='password'?256:e.kind==='username'?80:500;control.type=e.kind==='password'||e.masked?'password':'text';control.required=e.kind!=='field';control.autocomplete=e.kind==='password'?(design.mode==='signup'?'new-password':'current-password'):e.kind==='username'?'username':'off';control.readOnly=editing;if(e.kind==='password')control.minLength=10;if(e.kind==='username'){control.autocapitalize='none';control.spellcheck=false;}if(e.masked||e.kind==='password'){const toggle=make('button','◉');toggle.type='button';toggle.className='reveal';toggle.setAttribute('aria-label','Mostrar u ocultar '+e.label);toggle.onclick=()=>{control.type=control.type==='password'?'text':'password';};box.append(toggle);}}
 else if(e.kind==='submit'){control=make('button',e.label);control.type=editing?'button':'submit';}
 else if(e.kind==='link'){control=make('a',e.label);control.href=editing?'#':e.href;control.rel='noreferrer';}
 else control=make('span',e.label);
 control.classList.add('canvas-control');if(editing)control.tabIndex=-1;box.prepend(control);canvas.append(box);
 if(editing){const textElement=!['image','video'].includes(e.kind);let start=null;box.addEventListener('pointerdown',event=>{event.preventDefault();start={x:event.clientX,y:event.clientY,px:e.x,py:e.y,time:Date.now(),moved:false};box.setPointerCapture(event.pointerId);canvas.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));box.classList.add('selected');if(!textElement)select(e.id);});box.addEventListener('pointermove',event=>{if(!start)return;if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>8){start.moved=true;lastTextTap=null;}const bounds=canvas.getBoundingClientRect();e.x=Math.round(Math.max(0,Math.min(100-e.w,start.px+(event.clientX-start.x)/bounds.width*100))*10)/10;e.y=Math.round(Math.max(0,Math.min(100-e.h,start.py+(event.clientY-start.y)/bounds.height*100))*10)/10;box.style.left=e.x+'%';box.style.top=e.y+'%';move(e);});box.addEventListener('pointerup',event=>{
  if(textElement&&start){const now=Date.now(),tap=!start.moved&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<=8&&now-start.time<=450;
   if(tap&&lastTextTap?.id===e.id&&now-lastTextTap.time<=450){lastTextTap=null;select(e.id);}
   else lastTextTap=tap?{id:e.id,time:now}:null;
  }start=null;
 });box.addEventListener('pointercancel',()=>{start=null;lastTextTap=null;});box.addEventListener('click',event=>event.preventDefault());}
 }
}};
})();
