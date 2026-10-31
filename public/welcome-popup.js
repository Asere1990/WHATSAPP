(()=>{
 const dialog=document.getElementById('wa-welcome');if(!dialog)return;
 let dismissed=false,checked=false,associated=null;
 const button=document.getElementById('wa-welcome-button');
 function render(){const content=associated||globalThis.currentPublicContent?.welcomePopup;if(!content)return;
  for(const key of ['title','text','button'])document.getElementById('wa-welcome-'+key).textContent=content[key];
  const photo=document.getElementById('wa-welcome-photo'),valid=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(content.photo);
  photo.hidden=!valid;dialog.classList.toggle('has-photo',valid);if(valid)photo.src=content.photo;else photo.removeAttribute('src');
  const sheet=[...document.styleSheets].find(s=>s.href?.split('?')[0].endsWith('/welcome-popup.css'));
  if(sheet){const validColor=value=>/^#[0-9a-f]{6}$/i.test(value);for(let i=sheet.cssRules.length-1;i>=0;i--)if(sheet.cssRules[i].selectorText==='#wa-welcome #wa-welcome-button[type="button"]')sheet.deleteRule(i);sheet.insertRule('#wa-welcome #wa-welcome-button[type="button"]{background:'+(validColor(content.color)?content.color:'#128c7e')+';color:'+(validColor(content.textColor)?content.textColor:'#ffffff')+'}',sheet.cssRules.length);}
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
     dialog.showModal();
     return;
   }
   // Preserve the existing first-visitor behavior for admin-associated links.
   if(state.linked!==false||!state.popup||dismissed||dialog.open)return;
   const base=globalThis.currentPublicContent?.welcomePopup||{};
   associated={...base,title:base.title||'Antes de comenzar',button:base.button||'CONTINUAR',
    text:state.popup.kind==='text'?state.popup.text:'',photo:state.popup.kind==='photo'?state.popup.photo:''};
   render();
   dialog.showModal();
  }catch{}
 };
 render();globalThis.addEventListener('publiccontentchange',render);
 if(document.body.dataset.visualPreview)dialog.showModal();
 if(document.body.dataset.operatorPopupSite==='cm')globalThis.checkWelcomePopup();
})();
