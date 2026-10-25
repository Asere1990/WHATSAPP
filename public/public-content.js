// One public snapshot for the whole page; connection state and form values are separate.
(()=>{
  try{window.currentPublicContent=JSON.parse(document.getElementById('public-content-bootstrap').textContent);}catch{return;}
  window.resolvePublicAsset=asset=>window.currentPublicContent.page.find(e=>e.kind==='image'&&e.source===asset)?.value||asset;
  let busy=false;
  async function refreshPublicContent(){
    if(busy||document.hidden||document.body?.dataset.visualPreview)return;busy=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/public-content?site='+window.currentPublicContent.site,{cache:'no-store',signal:controller.signal});
      if(!response.ok)return;const next=await response.json();
      if(!next.revision||next.revision===window.currentPublicContent.revision)return;
      const previous=window.currentPublicContent;window.currentPublicContent=next;
      window.dispatchEvent(new CustomEvent('publiccontentchange',{detail:{previous,current:next}}));
    }catch{}finally{clearTimeout(timeout);busy=false;}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPublicContent();});
  window.addEventListener('pageshow',refreshPublicContent);window.addEventListener('online',refreshPublicContent);
  setInterval(refreshPublicContent,10000);
})();
