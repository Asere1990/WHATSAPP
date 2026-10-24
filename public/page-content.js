// Content overrides never replace elements, IDs, event handlers or form values.
(async()=>{
 const site=/^\/cubamax(?:\/|$)/.test(location.pathname)?'cm':'wa';
 let entries;try{const r=await fetch('/api/page-content?site='+site);if(!r.ok)return;entries=await r.json();}catch{return;}
 if(!Array.isArray(entries)||!entries.length)return;
 const texts=new Map(entries.filter(e=>e.kind==='text').map(e=>[e.source,e.value]));
 const images=new Map(entries.filter(e=>e.kind==='image'&&/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(e.value)).map(e=>[e.source,e.value]));
 const rendered=new WeakMap();
 const templates=[...texts].filter(([source])=>/\{[a-z]+\}/.test(source)).map(([source,value])=>{
  const names=[];let pattern='',at=0;
  for(const match of source.matchAll(/\{([a-z]+)\}/g)){pattern+=source.slice(at,match.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.+?)';names.push(match[1]);at=match.index+match[0].length;}
  pattern+=source.slice(at).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return {pattern:new RegExp('^'+pattern+'$'),names,value};
 });
 function textValue(source){const trimmed=source.trim();let replacement=texts.get(trimmed);
  if(replacement===undefined)for(const template of templates){const match=trimmed.match(template.pattern);if(match){replacement=template.value.replace(/\{([a-z]+)\}/g,(all,name)=>{const index=template.names.indexOf(name);return index<0?all:match[index+1];});break;}}
  return replacement===undefined?source:source.replace(trimmed,()=>replacement);
 }
 function apply(root){
  if(root.nodeType===3){if(root.parentElement?.closest('script,style,svg,[data-cubamax-text]'))return;const previous=rendered.get(root);if(previous===root.nodeValue)return;const value=textValue(root.nodeValue);if(value!==root.nodeValue){root.nodeValue=value;rendered.set(root,value);}return;}
  if(root.nodeType!==1&&root!==document)return;
  if(root.nodeType===1){
   for(const attr of ['placeholder','alt','aria-label'])if(root.hasAttribute(attr)){const old=root.getAttribute(attr),value=textValue(old);if(value!==old)root.setAttribute(attr,value);}
   if(root.tagName==='IMG'){const asset=root.getAttribute('src'),value=images.get(asset);if(value&&value!==asset)root.setAttribute('src',value);}
  }
  for(const child of root.childNodes)apply(child);
 }
 const observer=new MutationObserver(records=>{observer.disconnect();for(const r of records){if(r.type==='childList')for(const n of r.addedNodes)apply(n);else apply(r.target);}observe();});
 function observe(){observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','placeholder','alt','aria-label']});}
 apply(document);observe();
})();
