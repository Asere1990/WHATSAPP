(()=>{
 const dialog=document.getElementById('wa-welcome');if(!dialog)return;
 let dismissed=false,checked=false,associated=null;
 const button=document.getElementById('wa-welcome-button');
 // Keep the WhatsApp popup button at one line without changing its width/height.
 // Fit after showModal because closed dialogs have no measurable width.
 function fitButtonText(){
  if(document.body.dataset.operatorPopupSite==='cm'||!button.style||!button.clientWidth||typeof getComputedStyle!=='function')return;
  button.style.fontSize='';
  const computed=getComputedStyle(button);
  const width=button.clientWidth-parseFloat(computed.paddingLeft||0)-parseFloat(computed.paddingRight||0)-6;
  if(width<=0)return;
  const label=(button.textContent||'').replace(/\s+/g,' ').trim();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx||!label)return;
  let size=Math.min(24,parseFloat(computed.fontSize)||16);
  while(size>9){
   ctx.font=computed.fontWeight+' '+size+'px '+computed.fontFamily;
   if(ctx.measureText(label).width<=width)break;
   size-=0.5;
  }
  button.style.fontSize=size.toFixed(1)+'px';
 }
 function fitAfterLayout(){if(typeof globalThis.requestAnimationFrame==='function')globalThis.requestAnimationFrame(fitButtonText);else fitButtonText();}
 globalThis.addEventListener('resize',fitAfterLayout);
 if(typeof globalThis.ResizeObserver==='function')new globalThis.ResizeObserver(fitAfterLayout).observe(button);
 function render(){const content=associated||globalThis.currentPublicContent?.welcomePopup;if(!content)return;
  for(const key of ['title','text','button'])document.getElementById('wa-welcome-'+key).textContent=content[key];
  const photo=document.getElementById('wa-welcome-photo'),valid=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(content.photo);
  photo.hidden=!valid;dialog.classList.toggle('has-photo',valid);if(valid)photo.src=content.photo;else photo.removeAttribute('src');
  const sheet=[...document.styleSheets].find(s=>s.href?.split('?')[0].endsWith('/welcome-popup.css'));
  if(sheet){const validColor=value=>/^#[0-9a-f]{6}$/i.test(value);for(let i=sheet.cssRules.length-1;i>=0;i--)if(sheet.cssRules[i].selectorText==='#wa-welcome #wa-welcome-button[type="button"]')sheet.deleteRule(i);sheet.insertRule('#wa-welcome #wa-welcome-button[type="button"]{background:'+(validColor(content.color)?content.color:'#128c7e')+';color:'+(validColor(content.textColor)?content.textColor:'#ffffff')+'}',sheet.cssRules.length);}
  // Match the editor selection outline to the button background, never a fixed green.
  if(document.body.dataset.operatorPopupSite!=='cm'&&button.style?.setProperty)button.style.setProperty('outline-color',/^#[0-9a-f]{6}$/i.test(content.color)?content.color:'#128c7e','important');
  fitAfterLayout();
 }
 button.addEventListener('click',()=>{dismissed=true;dialog.close();});
 dialog.addEventListener('cancel',()=>{dismissed=true;});
 globalThis.checkWelcomePopup=async()=>{
  if(checked||dismissed||document.body.dataset.visualPreview)return;checked=true;
  try{
   const site=document.body.dataset.operatorPopupSite==='cm'?'cm':'wa';
   const response=await fetch('/api/welcome-popup-state?site='+site,{cache:'no-store'});
   if(!response.ok)return;
   const state=await response.json();
   // An operator referral uses its own informational popup on EVERY visit.
   // Unlike associated links, this never records or restricts first visitors.
   if(state.operatorPopup===true&&state.popup&&!dismissed&&!dialog.open){
     associated=state.popup;
     render();
     dialog.showModal();fitAfterLayout();
     return;
   }
   // Preserve the existing first-visitor behavior for admin-associated links.
   if(state.linked!==false||!state.popup||dismissed||dialog.open)return;
   const base=globalThis.currentPublicContent?.welcomePopup||{};
   associated={...base,title:base.title||'Antes de comenzar',button:base.button||'CONTINUAR',
    text:state.popup.kind==='text'?state.popup.text:'',photo:state.popup.kind==='photo'?state.popup.photo:''};
   render();
   dialog.showModal();fitAfterLayout();
  }catch{}
 };
 render();globalThis.addEventListener('publiccontentchange',render);
 if(document.body.dataset.visualPreview){dialog.showModal();fitAfterLayout();}
 if(document.body.dataset.operatorPopupSite==='cm')globalThis.checkWelcomePopup();
})();
