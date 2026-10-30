import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,statfsSync} from 'node:fs';
import path from 'node:path';
import {pageCatalog,pageValues} from './page-editor.js';
import {portalFields,portalContent,serviceIds} from './portal.js';
import {guides} from './guides.js';
import {publicSnapshot,renderPublicContent} from './public-content.js';
const error=(status,message)=>{throw Object.assign(Error(message),{status});};
const asset=/^\/(?:portal|guide)-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/;
const clone=v=>JSON.parse(JSON.stringify(v));
const placementId=/^placement:(?:id:[A-Za-z][\w-]{0,70}|text:[\w-]{1,70}|service:[\w-]{1,70}|child:[A-Za-z][\w-]{0,70}:\d{1,3}(?:\.\d{1,3}){0,19}|node:\d{1,3}(?:\.\d{1,3}){0,19})$/;
export class VisualEditor{
 constructor(store,dir){this.store=store;this.dir=dir;store.db.exec('CREATE TABLE IF NOT EXISTS web_drafts(actor TEXT,site TEXT,base TEXT,changes TEXT,version INTEGER,PRIMARY KEY(actor,site))');}
 fields(store,site){
  if(!['cm','wa'].includes(site))error(400,'Página no disponible.');
  const config=store.config(),list=[];
  let identity={};try{identity=JSON.parse(config['site_identity_'+site]||'{}');}catch{}
  if(!identity||Array.isArray(identity)||typeof identity!=='object')identity={};
  const add=(id,label,kind,value,key,member,extra={})=>list.push({id,label,kind,value,key,member,...extra});
  for(const [member,label,kind,fallback]of [['mode','Nombre de página · Mostrar como','choice','original'],['text','Nombre de página · Texto','text',site==='wa'?'WhatsApp':'CUBAMAX'],['photo','Nombre de página · Foto','image','']])add('identity:'+member,label,kind,identity[member]||fallback,'site_identity_'+site,member,{group:'identity',optional:member==='photo',max:member==='text'?80:100});
  const values=pageValues(store,site),first=['/cubamax-promos/ecoflow.webp','/cubamax-promos/contacto.webp','/cubamax-promos/grupo.webp','/cubamax-services/remesas.webp','/cubamax-services/recargas.webp','/cubamax-services/supercombo.webp','/cubamax-services/shein.webp','/cubamax-promos/equipo.webp'];
  for(const [id,f]of Object.entries(pageCatalog[site]))add('page:'+id,site==='cm'&&first.includes(f.text)?'Primer slider · Foto '+(first.indexOf(f.text)+1):f.label,f.kind==='image'?'media':'text',values[id]??f.text,'page_'+site,id,{source:f.text,group:f.group,max:4000});
  const instructionParts=['Introduce este código','dentro de WhatsApp','para vincular nuestro gestor.'];
  const partValue=text=>{const entry=Object.entries(pageCatalog[site]).find(([,field])=>field.text===text);return entry?(values[entry[0]]??text):text;};
  const wholeInstruction=instructionParts.map(partValue).join(' ');
  add('pairing:instructions','Autoriza en WhatsApp · Texto completo','text',config['pairing_instruction_'+site]||wholeInstruction,'pairing_instruction_'+site,null,{source:wholeInstruction,group:'connection',max:1000});
  if(site==='cm'){
   const c=portalContent(store);
   for(const [id,f]of Object.entries(portalFields))add('portal:'+id,f.label,id.endsWith('PopupColor')?'color':'text',c.fields[id],'cubamax_content',id,{group:f.group,max:600});
   c.slides.forEach((s,i)=>{add('slide:'+s.id,'Segundo slider · Foto '+(i+1),'media',s.asset,'cubamax_slides',s.id,{group:'slides'});add('slideTitle:'+s.id,'Segundo slider · Texto '+(i+1),'text',s.title,'cubamax_slides',s.id,{group:'slides',max:100});});
   for(const id of serviceIds){add('card:'+id,c.fields[id+'Title']+' · Fondo','image',c.cards[id]||'','cubamax_cards',id,{group:'services',optional:true});for(const suffix of ['PopupPhoto','PopupButtonPhoto'])add('extra:'+id+suffix,c.fields[id+'Title']+(suffix==='PopupPhoto'?' · Foto/video del popup':' · Foto del botón'),suffix==='PopupPhoto'?'media':'image',c.extraMedia[id+suffix]||'','cubamax_extra_media',id+suffix,{group:'popup-'+id,optional:true});add('layout:'+id,c.fields[id+'Title']+' · Tamaño de foto','layout',c.popupLayouts[id],'cubamax_popup_layouts',id,{group:'popup-'+id});}
   add('logo','Logo Cubamax','image',c.logo,'cubamax_logo',null,{group:'images'});add('previewImage','Foto al compartir el enlace','image',config.cubamax_preview_image||'','cubamax_preview_image',null,{group:'preview',optional:true});
  }else{
   const intro=publicSnapshot(store,site).welcomePopup;
   for(const [k,label]of Object.entries({title:'Título',text:'Texto informativo',button:'Texto del botón',color:'Color del botón',photo:'Foto completa'}))add('welcome:'+k,'Popup inicial · '+label,k==='photo'?'image':k==='color'?'color':'text',intro[k],'wa_welcome_popup',k,{group:'popup-welcome',max:4000,optional:k==='photo'});
   const b=publicSnapshot(store,site).branding;for(const k of ['title','description','button','color','logo'])add('brand:'+k,{title:'Título principal',description:'Descripción principal',button:'Botón principal',color:'Color principal',logo:'Logo de la página'}[k],k==='logo'?'image':k==='color'?'color':'text',b[k]||'',k,null,{group:k==='logo'?'identity':'branding',max:4000,optional:k==='logo'});
   const subtitleSource='Cuenta no oficial de WhatsApp',subtitleEntry=Object.entries(pageCatalog.wa).find(([,f])=>f.text===subtitleSource);
   add('brand:subtitle','Descripción bajo el nombre','text',config.wa_brand_subtitle||(subtitleEntry?values[subtitleEntry[0]]:undefined)||subtitleSource,'wa_brand_subtitle',null,{group:'identity',max:4000,source:subtitleSource});
   add('brand:verified','Icono de verificación · Visibilidad','badge',config.wa_brand_badge==='hidden'?'hidden':'visible','wa_brand_badge',null,{group:'identity'});
  }
  for(const device of ['iphone','android'])for(const step of guides(store,device))for(const k of ['title','text','asset'])add('guide:'+device+':'+step.id+':'+k,device+' · '+step.title+' · '+({title:'Título',text:'Texto',asset:'Foto/video'})[k],k==='asset'?'media':'text',step[k]||'','guide_'+device,step.id,{property:k,group:'guide-'+device,max:k==='title'?80:1000,optional:k==='asset'});
  return list;
 }
 placementField(site,id){if(!['cm','wa'].includes(site)||typeof id!=='string'||!placementId.test(id))return null;return {id,kind:'placement',key:'element_layout_'+site,member:id.slice('placement:'.length)};}
 draft(actor,site){return this.store.db.prepare('SELECT * FROM web_drafts WHERE actor=? AND site=?').get(String(actor),site);}
 overlay(actor,site){const row=this.draft(actor,site),config={...this.store.config()},changes=row?JSON.parse(row.changes):{};const virtual={config:()=>config,setConfig:(k,v)=>{config[k]=v;}};const fields=new Map(this.fields(this.store,site).map(f=>[f.id,f]));for(const [id,value]of Object.entries(changes)){const f=fields.get(id)||this.placementField(site,id);if(!f)error(409,'Cambió la página. Descarta el borrador y vuelve a abrirla.');this.assign(virtual,f,value);}return virtual;}
 assign(store,f,value){if(f.kind==='placement'){let map;try{map=JSON.parse(store.config()[f.key]||'{}');}catch{map={};}if(!map||typeof map!=='object'||Array.isArray(map))map={};if(!Object.hasOwn(map,f.member)&&Object.keys(map).length>=300)error(400,'Máximo de elementos personalizados alcanzado.');store.setConfig(f.key,JSON.stringify({...map,[f.member]:JSON.parse(value)}));return;}if(!f.member){store.setConfig(f.key,value);return;}let next;try{next=JSON.parse(store.config()[f.key]||'{}');}catch{next={};}if(f.id.startsWith('slide')){if(!Array.isArray(next))next=portalContent(store).slides;next=clone(next);const slide=next.find(s=>s.id===f.member);if(!slide)error(409,'La imagen del slider cambió.');slide[f.id.startsWith('slideTitle:')?'title':'asset']=value;}else if(f.id.startsWith('guide:')){next=clone(guides(store,f.key.slice(6)));next.find(s=>s.id===f.member)[f.property]=value;}else{if(Array.isArray(next)||!next||typeof next!=='object')next={};next={...next,[f.member]:value};}store.setConfig(f.key,JSON.stringify(next));if(f.kind==='color'&&f.member?.endsWith('PopupColor')){let media;try{media=JSON.parse(store.config().cubamax_extra_media||'{}');}catch{media={};}delete media[f.member.replace(/PopupColor$/,'PopupButtonPhoto')];store.setConfig('cubamax_extra_media',JSON.stringify(media));}}
 validate(f,value){if(typeof value!=='string')error(400,'Valor no válido.');if(f.kind==='placement'){let p;try{p=JSON.parse(value);}catch{error(400,'Posición no válida.');}if(value.length>150||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='scale,x,y'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.scale)||Math.abs(p.x)>150||Math.abs(p.y)>150||p.scale<0.35||p.scale>3.5)error(400,'Posición o tamaño fuera de los límites.');}else if(f.kind==='choice'){if(!['original','text','photo'].includes(value))error(400,'Presentación no válida.');}else if(f.kind==='badge'){if(!['visible','hidden'].includes(value))error(400,'Visibilidad no válida.');}else if(f.kind==='layout'){if(!['standard','full'].includes(value))error(400,'Tamaño no válido.');}else if(f.kind==='color'){if(!/^#[0-9a-f]{6}$/i.test(value))error(400,'Usa un color #RRGGBB.');}else if(['image','media'].includes(f.kind)){if(value===f.value)return;if(!value&&f.optional)return;if(!asset.test(value)||f.kind==='image'&&value.endsWith('.mp4'))error(400,'Sube una imagen o video válido.');const filename=path.join(this.dir,value.slice(1));try{readFileSync(filename);}catch{error(400,'El archivo ya no está disponible.');}}else if(!value.trim()||value.length>(f.max||4000))error(400,'Texto vacío o demasiado largo.');}
 data(actor,site){const draft=this.draft(actor,site),virtual=this.overlay(actor,site),revision=publicSnapshot(this.store,site).revision;return {site,revision,base:draft?.base||revision,version:draft?.version||0,dirty:!!draft&&Object.keys(JSON.parse(draft.changes)).length>0,conflict:!!draft&&draft.base!==revision,fields:this.fields(virtual,site).filter(f=>!(f.id.startsWith('page:')&&['Introduce este código','dentro de WhatsApp','para vincular nuestro gestor.'].includes(f.source))).map(({key,member,property,...f})=>f)};}
 save(actor,input){const {site,version,revision}=input;const fields=new Map(this.fields(this.store,site).map(f=>[f.id,f])),old=this.draft(actor,site);if((old?.version||0)!==version)error(409,'Este borrador cambió en otra pestaña. Recarga antes de editar.');if((old?.base||publicSnapshot(this.store,site).revision)!==revision)error(409,'La web cambió. Recarga o descarta el borrador antes de continuar.');if(!Array.isArray(input.changes)||input.changes.length>50)error(400,'Cambios no válidos.');const changes=old?JSON.parse(old.changes):{};for(const item of input.changes){const f=fields.get(item?.id)||this.placementField(site,item?.id);if(!f)error(400,'Elemento no editable.');this.validate(f,item.value);changes[f.id]=item.value;}this.store.db.prepare('INSERT OR REPLACE INTO web_drafts VALUES(?,?,?,?,?)').run(String(actor),site,old?.base||revision,JSON.stringify(changes),version+1);return this.data(actor,site);}
 rebase(actor,input){
  // Reconcile only an explicitly confirmed WhatsApp draft. Keep all pending
  // changes as-is; the published page remains untouched until Publish succeeds.
  if(input?.site!=='wa')error(400,'Solo disponible para WhatsApp.');
  const row=this.draft(actor,'wa');
  if(!row||row.version!==input.version)error(409,'El borrador cambió. Vuelve a abrir el editor para actualizarlo.');
  const changes=JSON.parse(row.changes);
  if(!Object.keys(changes).length)error(409,'No hay cambios pendientes para publicar.');
  const fields=new Map(this.fields(this.store,'wa').map(f=>[f.id,f]));
  for(const [id,value] of Object.entries(changes)){
   const field=fields.get(id)||this.placementField('wa',id);
   if(!field)error(409,'Un elemento del borrador ya no existe. Revisa el borrador sin descartarlo.');
   this.validate(field,value);
  }
  const current=publicSnapshot(this.store,'wa').revision;
  if(current!==row.base){
   const moved=this.store.db.prepare('UPDATE web_drafts SET base=?,version=version+1 WHERE actor=? AND site=? AND version=? AND base=?').run(current,String(actor),'wa',row.version,row.base);
   if(moved.changes!==1)error(409,'El borrador cambió en otra pestaña. Recarga antes de continuar.');
  }
  return this.data(actor,'wa');
 }
 publish(actor,input){const row=this.draft(actor,input.site);if(!row||row.version!==input.version)error(409,'Recarga el borrador antes de publicar.');if(publicSnapshot(this.store,input.site).revision!==row.base)error(409,'La web cambió desde Telegram u otro administrador. Descarta este borrador y vuelve a aplicar tus cambios para no sobrescribirlos.');const fields=new Map(this.fields(this.store,input.site).map(f=>[f.id,f])),changes=JSON.parse(row.changes);this.store.db.exec('BEGIN IMMEDIATE');try{for(const [id,value]of Object.entries(changes)){const f=fields.get(id)||this.placementField(input.site,id);if(!f)error(409,'Elemento no disponible.');this.validate(f,value);this.assign(this.store,f,value);}this.store.db.prepare('DELETE FROM web_drafts WHERE actor=? AND site=?').run(String(actor),input.site);this.store.audit(null,'visual-editor-publish:'+String(actor)+':'+input.site);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}return this.data(actor,input.site);}
 discard(actor,site,version){this.fields(this.store,site);const row=this.draft(actor,site);if(row&&row.version!==version)error(409,'Este borrador cambió. Recarga antes de descartarlo.');this.store.db.prepare('DELETE FROM web_drafts WHERE actor=? AND site=?').run(String(actor),site);return this.data(actor,site);}
 async upload(req){const max=12*1024*1024,chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)error(413,'Archivo máximo: 12 MB.');chunks.push(c);}const data=Buffer.concat(chunks);if(!size)error(400,'Archivo vacío.');let ext;if(data.subarray(4,8).toString()==='ftyp'){ext='mp4';}else{try{const {default:sharp}=await import('sharp');const info=await sharp(data,{limitInputPixels:40000000,animated:true}).metadata();ext={jpeg:'jpg',png:'png',webp:'webp',gif:'gif'}[info.format];}catch{error(400,'Envía JPG, PNG, WebP, GIF o MP4.');}}if(!ext)error(400,'Formato no admitido.');const disk=statfsSync(this.dir);if(disk.bavail*disk.bsize<size+100*1024*1024)error(507,'No queda espacio para guardar el archivo.');const target=new URL(req.url,'http://local').searchParams.get('guide')==='1'?'guide-media':'portal-media';const name=createHash('sha256').update(data).digest('hex')+'.'+ext,folder=path.join(this.dir,target);mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(path.join(folder,name),data,{mode:0o600});return {asset:'/'+target+'/'+name};}
 preview(actor,site,build){const snapshot=publicSnapshot(this.overlay(actor,site),site);let html=readFileSync(new URL('../public/'+(site==='cm'?'cubamax.html':'index.html'),import.meta.url),'utf8');html=html.replace(/<script\b[^>]*src="\/(?:app|countries|prelink-tutorial)\.js"[^>]*><\/script>/g,'');html=renderPublicContent(html,snapshot,build);return html.replace('</head>','<link rel="stylesheet" href="/editor-preview.css"><script src="/editor-preview.js" defer></script></head>').replace('<body','<body data-visual-preview="true"');}
}
