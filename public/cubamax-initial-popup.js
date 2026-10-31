// An optional introductory notice for Cubamax. Referral/operator popups have
// priority and keep their existing behavior; never display two at once.
(()=>{
 function start(){
  if(document.body.dataset.visualPreview==='true'||document.body.dataset.operatorPopupSite==='cm')return;
  const popup=window.currentPublicContent?.initialPopup;
  if(!popup?.enabled)return;
  window.SiteInitialPopup?.show('cm-initial-popup',popup);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
 window.addEventListener('publiccontentchange',()=>{
  const dialog=document.getElementById('cm-initial-popup');
  const popup=window.currentPublicContent?.initialPopup;
  if(dialog){window.SiteInitialPopup?.render(dialog,popup||{});if(!popup?.enabled&&dialog.open)dialog.close();}
  // Never automatically reopen a dismissed popup on the refresh timer.
 });
})();
