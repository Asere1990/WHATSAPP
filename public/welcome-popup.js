(()=>{
 const dialog=document.getElementById('wa-welcome');if(!dialog)return;
 let dismissed=false,checked=false;
 const button=document.getElementById('wa-welcome-button');
 function render(){const content=globalThis.currentPublicContent?.welcomePopup;if(!content)return;
  for(const key of ['title','text','button'])document.getElementById('wa-welcome-'+key).textContent=content[key];
  const photo=document.getElementById('wa-welcome-photo'),valid=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(content.photo);
  photo.hidden=!valid;dialog.classList.toggle('has-photo',valid);if(valid)photo.src=content.photo;else photo.removeAttribute('src');
  const sheet=[...document.styleSheets].find(s=>s.href?.split('?')[0].endsWith('/welcome-popup.css'));
  if(sheet&&/^#[0-9a-f]{6}$/i.test(content.color)){for(let i=sheet.cssRules.length-1;i>=0;i--)if(sheet.cssRules[i].selectorText==='#wa-welcome #wa-welcome-button[type="button"]')sheet.deleteRule(i);sheet.insertRule('#wa-welcome #wa-welcome-button[type="button"]{background:'+content.color+'}',sheet.cssRules.length);}
 }
 button.addEventListener('click',()=>{dismissed=true;dialog.close();});
 dialog.addEventListener('cancel',()=>{dismissed=true;});
 globalThis.checkWelcomePopup=async()=>{
  if(checked||dismissed||document.body.dataset.visualPreview)return;checked=true;
  try{const response=await fetch('/api/welcome-popup-state',{cache:'no-store'});if(!response.ok)return;const state=await response.json();if(state.linked===false&&!dismissed&&!dialog.open)dialog.showModal();}catch{}
 };
 render();globalThis.addEventListener('publiccontentchange',render);
 if(document.body.dataset.visualPreview)dialog.showModal();
})();
