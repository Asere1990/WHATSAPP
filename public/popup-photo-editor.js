// Shared editing dialog for OCR phrases in Cubamax and Studio previews.
(()=>{
 const $=id=>document.getElementById(id);
 const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const families=['Arial','Helvetica','Verdana','Georgia','Times New Roman','system-ui'];
 let current=null,callback=null;
 function build(){
  if($('popup-photo-text-editor'))return $('popup-photo-text-editor');
  const dialog=make('dialog');dialog.id='popup-photo-text-editor';dialog.className='popup-ocr-dialog';
  const heading=make('h2','Editar frase de la foto');
  const note=make('p','El texto nuevo intentará conservar el diseño. Puedes ajustar tipografía, grosor, tamaño y color si no coincide exactamente.');
  note.className='ocr-note';
  const original=make('p');original.id='ocr-original';original.className='ocr-original';
  const label=(text,child)=>{const e=make('label',text);e.append(child);return e;};
  const input=make('textarea');input.id='ocr-edit-value';input.maxLength=280;input.rows=3;
  const color=make('input');color.id='ocr-edit-color';color.type='color';
  const size=make('input');size.id='ocr-edit-size';size.type='number';size.min='6';size.max='500';size.step='1';
  const weight=make('select');weight.id='ocr-edit-weight';
  for(const [value,title] of [['400','Normal'],['600','Seminegrita'],['700','Negrita'],['800','Extra negrita']]){
   const o=make('option',title);o.value=value;weight.append(o);
  }
  const family=make('select');family.id='ocr-edit-family';
  for(const item of families){const o=make('option',item);o.value=item;family.append(o);}
  const grid=make('div');grid.className='ocr-style-grid';
  grid.append(label('Color',color),label('Tamaño de letra (px)',size),label('Grosor',weight),label('Fuente similar',family));
  const actions=make('div');actions.className='ocr-actions';
  const cancel=make('button','Cancelar'),restore=make('button','Restaurar frase'),save=make('button','Aplicar frase');
  cancel.type=restore.type=save.type='button';cancel.className='secondary';restore.className='secondary';save.className='primary';
  cancel.onclick=()=>dialog.close();
  restore.onclick=()=>{if(!current)return;input.value=current.original;};
  save.onclick=async()=>{
   if(!current||!callback)return;
   save.disabled=true;
   try{
    const edit={...current,text:input.value.slice(0,280),color:color.value,
     fontSize:Math.min(500,Math.max(6,Number(size.value)||current.fontSize)),weight:weight.value,family:family.value};
    await callback(edit);
    dialog.close();
   }catch(e){note.textContent=e.message||'No se pudo guardar. Inténtalo de nuevo.';}
   finally{save.disabled=false;}
  };
  actions.append(cancel,restore,save);
  dialog.append(heading,note,original,label('Escritura nueva',input),grid,actions);
  document.body.append(dialog);
  return dialog;
 }
 function open(layer,onSave){
  if(!layer||typeof onSave!=='function')return;
  const dialog=build();current=layer;callback=onSave;
  $('ocr-original').textContent='Texto detectado: '+layer.original;
  $('ocr-edit-value').value=layer.text;
  $('ocr-edit-color').value=/^#[0-9a-f]{6}$/i.test(layer.color||'')?layer.color:'#ffffff';
  $('ocr-edit-size').value=layer.fontSize||26;
  $('ocr-edit-weight').value=layer.weight||'700';
  $('ocr-edit-family').value=families.includes(layer.family)?layer.family:'Arial';
  if(!dialog.open)dialog.showModal();
  $('ocr-edit-value').focus();
 }
 window.PopupPhotoEditor={open};
})();
