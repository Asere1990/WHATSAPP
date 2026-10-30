import {portalContent,portalMediaPath} from './portal.js';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderCubamaxPreview(html,store,origin,pathname){
 const {fields}=portalContent(store),title=fields.previewTitle,description=fields.previewDescription;
 const image=store.config().cubamax_preview_image;
 const meta=(property,content)=>`<meta property="${property}" content="${escape(content)}">`;
 const url=new URL(pathname,origin).href;
 const tags=meta('og:type','website')+meta('og:title',title)+meta('og:description',description)+meta('og:url',url)+`<meta name="description" content="${escape(description)}">`+(portalMediaPath.test(image)?meta('og:image',new URL(image,origin).href):'');
 return html.replace(/<title>[^<]*<\/title>/,()=>`<title>${escape(title)}</title>`).replace('</head>',()=>tags+'</head>');
}

const whatsAppImage=/^\/portal-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;

// Metadata for links shared in WhatsApp. It is independent from the text and
// branding rendered on the actual WhatsApp landing page.
export function whatsAppLinkPreview(store){
 const defaults={image:'',name:'WHATSAPP',slogan:'Conectar mi cuenta',description:'Servicio independiente de WhatsApp y Meta.'};
 let saved={};
 try{saved=JSON.parse(store.config().wa_link_preview||'{}');}catch{}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
 const result={...defaults};
 for(const key of ['name','slogan','description'])
  if(typeof saved[key]==='string'&&saved[key].trim()&&saved[key].length<=4000)result[key]=saved[key];
 if(typeof saved.image==='string'&&whatsAppImage.test(saved.image))result.image=saved.image;
 return result;
}
export function renderWhatsAppPreview(html,store,origin,pathname){
 if(!store.config().wa_link_preview)return html;
 const data=whatsAppLinkPreview(store);
 const title=[data.name,data.slogan].filter(Boolean).join(' · ');
 const address=new URL(pathname,origin).href;
 const property=(name,value)=>'<meta property="'+name+'" content="'+escape(value)+'">';
 const named=(name,value)=>'<meta name="'+name+'" content="'+escape(value)+'">';
 const tags=[
  property('og:type','website'),
  property('og:site_name',data.name),
  property('og:title',title),
  property('og:description',data.description),
  property('og:url',address),
  named('description',data.description),
  named('twitter:card',data.image?'summary_large_image':'summary'),
  named('twitter:title',title),
  named('twitter:description',data.description),
 ];
 if(data.image){
  const absolute=new URL(data.image,origin).href;
  tags.push(property('og:image',absolute),named('twitter:image',absolute),property('og:image:alt',data.name));
 }
 return html.replace(/<title>[^<]*<\/title>/,()=>'<title>'+escape(title)+'</title>')
  .replace('</head>',()=>tags.join('')+'</head>');
}
