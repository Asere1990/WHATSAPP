// Generic, informational initial popup for Cubamax and independently created
// Studio pages only. WhatsApp's wa-welcome popup is not modified or reused.
(()=>{
 const defaults={enabled:false,title:'Antes de comenzar',text:'Consulta la información y continúa.',button:'CONTINUAR',color:'#128c7e',textColor:'#ffffff',photo:''};
 const validPhoto=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
 const validColor=/^#[0-9a-f]{6}$/i;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 function ensure(id){
  let dialog=document.getElementById(id);
  if(dialog)return dialog;
  dialog=make('dialog','site-initial-popup');dialog.id=id;dialog.setAttribute('aria-modal','true');
  const frame=make('div','site-initial-frame'),cover=make('div','site-initial-cover'),photo=make('img','site-initial-photo');
  photo.alt='';photo.dataset.initialPart='photo';photo.hidden=true;
  const copy=make('div','site-initial-copy'),title=make('h2','site-initial-title'),text=make('p','site-initial-text');
  title.id=id+'-title';title.dataset.initialPart='title';text.dataset.initialPart='text';
  dialog.setAttribute('aria-labelledby',title.id);
  copy.append(title,text);cover.append(photo,copy);
  const button=make('button','site-initial-button');button.type='button';button.dataset.initialPart='button';
  button.addEventListener('click',()=>dialog.close());
  frame.append(cover,button);dialog.append(frame);document.body.append(dialog);
  dialog.initialParts={cover,photo,copy,title,text,button};
  return dialog;
 }
 function render(dialog,value={}){
  const config={...defaults,...(value&&typeof value==='object'?value:{})};
  const {photo,copy,title,text,button}=dialog.initialParts||ensure(dialog.id).initialParts;
  const hasPhoto=validPhoto.test(config.photo||'');
  dialog.classList.toggle('has-photo',hasPhoto);
  photo.hidden=!hasPhoto;
  if(hasPhoto)photo.src=config.photo;else photo.removeAttribute('src');
  // A full-cover alert picture already contains its own text; do not overlay
  // duplicated paragraphs, but preserve them for accessible fallback.
  copy.classList.toggle('is-visually-hidden',hasPhoto);
  title.textContent=String(config.title||defaults.title).slice(0,120);
  text.textContent=String(config.text||defaults.text).slice(0,4000);
  button.textContent=String(config.button||defaults.button).slice(0,80);
  button.style.backgroundColor=validColor.test(config.color||'')?config.color:defaults.color;
  button.style.color=validColor.test(config.textColor||'')?config.textColor:defaults.textColor;
  return dialog;
 }
 function show(id,value,options={}){
  const dialog=ensure(id);render(dialog,value);
  if(value?.enabled||options.preview){if(!dialog.open)dialog.showModal();}
  else if(dialog.open)dialog.close();
  return dialog;
 }
 window.SiteInitialPopup={defaults,ensure,render,show};
})();
