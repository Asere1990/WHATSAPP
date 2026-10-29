import {welcomeContent} from './welcome-popup.js';
import {createHash} from 'node:crypto';
import {pageContent} from './page-editor.js';
import {portalContent} from './portal.js';
import {guides} from './guides.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=value=>value.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",nbsp:'\u00a0'}[s]));
const media=/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/;
export function publicSnapshot(store,site){
  const config=store.config(),branding={title:'Tu WhatsApp, bien atendido.',description:'Conecta tu cuenta para que nuestro equipo te ayude a gestionar tus conversaciones y archivos.',button:'CONECTAR CUENTA',color:'#128c7e',...Object.fromEntries(['title','description','button','color','logo'].filter(k=>config[k]).map(k=>[k,config[k]]))};
  const pairingInstruction=config['pairing_instruction_'+site];
  let identity={},layout={};try{identity=JSON.parse(config['site_identity_'+site]||'{}');}catch{}
  try{layout=JSON.parse(config['element_layout_'+site]||'{}');}catch{}
  if(!identity||typeof identity!=='object'||Array.isArray(identity))identity={};
  if(!layout||typeof layout!=='object'||Array.isArray(layout))layout={};
  layout=Object.fromEntries(Object.entries(layout).filter(([key,v])=>/^(?:id:[A-Za-z][\w-]{0,70}|text:[\w-]{1,70}|service:[\w-]{1,70}|child:[A-Za-z][\w-]{0,70}:\d{1,3}(?:\.\d{1,3}){0,19}|node:\d{1,3}(?:\.\d{1,3}){0,19})$/.test(key)&&v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.scale)&&Math.abs(v.x)<=150&&Math.abs(v.y)<=150&&v.scale>=0.35&&v.scale<=3.5));
  const result={site,page:pageContent(store,site),...(typeof pairingInstruction==='string'&&pairingInstruction?{pairingInstruction}:{}),...(site==='wa'?{header:{subtitle:typeof config.wa_brand_subtitle==='string'?config.wa_brand_subtitle:'',badge:config.wa_brand_badge==='hidden'?'hidden':'visible'}}:{}),identity:{mode:['text','photo'].includes(identity.mode)?identity.mode:'original',text:String(identity.text|| (site==='wa'?'WhatsApp':'CUBAMAX')).slice(0,80),photo:media.test(identity.photo||'')?identity.photo:''},layout,...(site==='cm'?{portal:portalContent(store)}:{welcomePopup:welcomeContent(store)}),branding,guides:{android:guides(store,'android'),iphone:guides(store,'iphone')}};
  return {...result,revision:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}
export function renderPublicContent(html,snapshot,build){
  const images=new Map(snapshot.page.filter(e=>e.kind==='image'&&media.test(e.value)).map(e=>[e.source,e.value]));
  const texts=new Map(snapshot.page.filter(e=>e.kind==='text').map(e=>[e.source,e.value]));
  const image=asset=>images.get(asset)||asset;
  const text=value=>{const decoded=decode(value),trimmed=decoded.trim(),next=texts.get(trimmed);return next===undefined?value:escape(decoded.replace(trimmed,()=>next));};
  // Tokenize raw-text blocks separately so content never modifies scripts or CSS.
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/gi,token=>{
    if(/^<(script|style)\b|^<!--/i.test(token))return token;
    if(token.startsWith('<'))return token.replace(/\b(src|alt|placeholder|aria-label)="([^"]*)"/g,(all,attr,value)=>{
      if(attr==='src')return `src="${escape(image(decode(value)))}"`+(images.has(decode(value))?` data-public-source="${escape(decode(value))}"`:'');
      return `${attr}="${text(value)}"`;
    });
    return text(token);
  });
  if(snapshot.portal){
    const p=snapshot.portal;
    html=html.replace(/<([a-z][\w-]*)\b([^>]*\bdata-cubamax-text="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/gi,(all,tag,attrs,key)=>typeof p.fields[key]==='string'?`<${tag}${attrs}>${escape(p.fields[key])}</${tag}>`:all);
    html=html.replace(/(<div id="cubamax-slides"[^>]*>)[\s\S]*?(<\/div>)/,(_,start,end)=>start+p.slides.map((s,i)=>`<article class="carousel-slide${i===0?' is-active':''}" aria-hidden="${i!==0}"><img src="${escape(image(s.asset))}" data-public-source="${escape(s.asset)}" alt="${escape(s.title)}" width="600" height="420" decoding="async"${i?' loading="lazy"':''}></article>`).join('')+end);
    html=html.replace(/(<a class="corporate-brand"[^>]*>\s*<img[^>]*\bsrc=")[^"]*/g,(_,start)=>start+escape(image(p.logo)));
    for(const [service,asset]of Object.entries(p.cards))html=html.replace(new RegExp(`(<button\\b[^>]*data-service="${service}"[^>]*>)`),(_,tag)=>tag.replace('service-card','service-card has-image')+`<img class="service-card-photo" src="${escape(image(asset))}" data-public-source="${escape(asset)}" alt="" loading="lazy">`);
  }else{
    for(const [id,key]of [['title','title'],['description','description'],['begin','button']])html=html.replace(new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(<\\/\\2>)`),(_,start,tag,end)=>start+escape(snapshot.branding[key])+end);
  }
  const identity=snapshot.identity||{},validName=identity.mode==='text'||identity.mode==='photo'&&media.test(identity.photo||'');
  if(validName&&snapshot.site==='wa'){
    const display=identity.mode==='photo'?'<img class="page-name-photo" alt="'+escape(identity.text||'Nombre de la página')+'" src="'+escape(identity.photo)+'">':escape(identity.text);
    html=html.replace(/(<span id="wa-brand-name">)[\s\S]*?(<\/span>)/,(_,start,end)=>start+display+end);
  }
  if(validName&&snapshot.site==='cm'){
    const display=identity.mode==='photo'?'<img class="page-name-photo" alt="'+escape(identity.text||'Nombre de la página')+'" src="'+escape(identity.photo)+'">':'<span class="page-name-text">'+escape(identity.text)+'</span>';
    html=html.replace(/(<header><a class="corporate-brand"[^>]*>)<img[^>]*>/,(_,start)=>start+display);
  }
  if(snapshot.site==='wa'){
    if(typeof snapshot.header?.subtitle==='string'&&snapshot.header.subtitle)html=html.replace(/(<span id="wa-brand-description" class="brand-sub">)[\s\S]*?(<\/span>)/,(_,start,end)=>start+escape(snapshot.header.subtitle)+end);
    if(snapshot.header?.badge==='hidden')html=html.replace('<svg id="wa-verified-badge" class="verified-badge"','<svg id="wa-verified-badge" class="verified-badge" hidden');
  }
  if(typeof snapshot.pairingInstruction==='string'){
    const instruction=snapshot.pairingInstruction,emphasis='dentro de WhatsApp',at=instruction.indexOf(emphasis);
    const formatted=at<0?escape(instruction):escape(instruction.slice(0,at))+'<strong>'+escape(emphasis)+'</strong>'+escape(instruction.slice(at+emphasis.length));
    html=html.replace(/(<p id="pairing-account"[^>]*><\/p>\s*)<p>[\s\S]*?<\/p>/,(_,before)=>before+'<p data-whole-pairing-instruction="">'+formatted+'</p>');
  }
  html=html.replace(/<img\b([^>]*\bsrc="[^"]+\.mp4"[^>]*)>/gi,(_,attrs)=>`<video${attrs} muted playsinline autoplay loop preload="metadata"></video>`);
  // Immutable release URLs prevent a device from mixing old JS/CSS with new HTML.
  html=html.replace(/\b(src|href)="(\/[^"?]+\.(?:js|css))"/g,(_,attr,asset)=>`${attr}="${asset}?v=${build}"`);
  const payload=JSON.stringify(snapshot).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  html=html.replace(/<script\b[^>]*src=/,match=>`<script src="/public-content.js?v=${build}" defer></script><script src="/element-layout.js?v=${build}" defer></script>`+match);
  return html.replace('</head>',`<link rel="stylesheet" href="/name-layout.css?v=${build}"><script type="application/json" id="public-content-bootstrap">${payload}</script></head>`);
}
