// Content overrides never replace elements, IDs, event handlers or form values.
(async()=>{
 const site=(document.body?.classList.contains('corporate-portal')||/^\/cubamax(?:\/|$)/.test(location.pathname))?'cm':'wa';
 let entries=globalThis.currentPublicContent?.page;
 if(!entries)try{const r=await fetch('/api/page-content?site='+site,{cache:'no-store'});if(!r.ok)return;entries=await r.json();}catch{return;}
 if(!Array.isArray(entries))return;
 const texts=new Map(entries.filter(e=>e.kind==='text').map(e=>[e.source,e.value]));
 const images=new Map(entries.filter(e=>e.kind==='image'&&/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(e.value)).map(e=>[e.source,e.value]));
 const rendered=new WeakMap(),originals=new WeakMap(),attributes=new WeakMap();
 const initialSources=new Map(entries.filter(e=>e.kind==='text').map(e=>[e.value,e.source]));
 let templates=[...texts].filter(([source])=>/\{[a-z]+\}/.test(source)).map(([source,value])=>{
  const names=[];let pattern='',at=0;
  for(const match of source.matchAll(/\{([a-z]+)\}/g)){pattern+=source.slice(at,match.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.+?)';names.push(match[1]);at=match.index+match[0].length;}
  pattern+=source.slice(at).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return {pattern:new RegExp('^'+pattern+'$'),names,value};
 });
 function textValue(source){const trimmed=source.trim();let replacement=texts.get(trimmed);
  if(replacement===undefined)for(const template of templates){const match=trimmed.match(template.pattern);if(match){replacement=template.value.replace(/\{([a-z]+)\}/g,(all,name)=>{const index=template.names.indexOf(name);return index<0?all:match[index+1];});break;}}
  return replacement===undefined?source:source.replace(trimmed,()=>replacement);
 }
 function apply(root){
  if(root.nodeType===3){if(root.parentElement?.closest('script,style,svg,[data-cubamax-text]'))return;const previous=rendered.get(root);if(previous!==root.nodeValue||!originals.has(root))originals.set(root,initialSources.get(root.nodeValue.trim())||root.nodeValue);const value=textValue(originals.get(root));if(value!==root.nodeValue)root.nodeValue=value;rendered.set(root,value);return;}
  if(root.nodeType!==1&&root!==document)return;
  if(root.nodeType===1){
   const sources=attributes.get(root)||{};attributes.set(root,sources);
   for(const attr of ['placeholder','alt','aria-label'])if(root.hasAttribute(attr)){const old=root.getAttribute(attr);if(!sources[attr])sources[attr]=initialSources.get(old)||old;const value=textValue(sources[attr]);if(value!==old)root.setAttribute(attr,value);}
   if(root.tagName==='IMG'||root.tagName==='VIDEO'){const asset=root.getAttribute('src');if(asset){const declared=root.getAttribute('data-public-source');if(declared&&(asset===declared||asset===images.get(declared)||asset===sources.applied))sources.src=declared;else if(asset!==sources.applied)sources.src=[...images].find(([,value])=>value===asset)?.[0]||asset;const value=images.get(sources.src)||sources.src;sources.applied=value;if(value&&/\.mp4$/.test(value)!==(root.tagName==='VIDEO')){const next=document.createElement(value.endsWith('.mp4')?'video':'img');for(const a of root.attributes)next.setAttribute(a.name,a.value);next.setAttribute('data-public-source',sources.src);if(next.tagName==='VIDEO'){next.muted=true;next.autoplay=true;next.loop=true;next.playsInline=true;next.controls=false;next.preload='metadata';}next.setAttribute('src',value);root.replaceWith(next);return;}if(value&&value!==asset)root.setAttribute('src',value);}}
  }
  for(const child of root.childNodes)apply(child);
 }
 const observer=new MutationObserver(records=>{observer.disconnect();for(const r of records){if(r.type==='childList')for(const n of r.addedNodes)apply(n);else apply(r.target);}observe();});
 function observe(){observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','placeholder','alt','aria-label']});}
 apply(document);observe();
 globalThis.addEventListener?.('publiccontentchange',event=>{
  entries=event.detail.current.page;texts.clear();images.clear();
  for(const entry of entries){if(entry.kind==='text')texts.set(entry.source,entry.value);else if(entry.kind==='image'&&/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4)$/.test(entry.value))images.set(entry.source,entry.value);}
  templates=[];
  for(const [source,value]of texts){if(!/\{[a-z]+\}/.test(source))continue;const names=[];let pattern='',at=0;for(const match of source.matchAll(/\{([a-z]+)\}/g)){pattern+=source.slice(at,match.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.+?)';names.push(match[1]);at=match.index+match[0].length;}pattern+=source.slice(at).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');templates.push({pattern:new RegExp('^'+pattern+'$'),names,value});}
  observer.disconnect();apply(document);observe();
 });
})();
