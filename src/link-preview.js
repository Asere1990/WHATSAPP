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
