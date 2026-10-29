// A layout layer independent of forms, events and the existing slider animations.
(()=>{
  const regular={x:0,y:0,scale:1};
  const stored=()=>window.currentPublicContent?.layout||{};
  const pending=new Map();
  const valid=/^(?:id:[A-Za-z][\w-]{0,70}|text:[\w-]{1,70}|service:[\w-]{1,70}|child:[A-Za-z][\w-]{0,70}:\d{1,3}(?:\.\d{1,3}){0,19}|node:\d{1,3}(?:\.\d{1,3}){0,19})$/;
  function keyFor(element){
    if(!element||element===document.body||element===document.documentElement)return null;
    if(element.id&&/^[A-Za-z][\w-]{0,70}$/.test(element.id))return 'id:'+element.id;
    const label=element.getAttribute?.('data-cubamax-text');
    if(label&&/^[\w-]{1,70}$/.test(label))return 'text:'+label;
    const service=element.getAttribute?.('data-service');
    if(service&&/^[\w-]{1,70}$/.test(service))return 'service:'+service;
    const indices=[];let current=element;
    while(current&&current!==document.body&&indices.length<20){
      const parent=current.parentElement;
      if(!parent)return null;
      const at=Array.prototype.indexOf.call(parent.children,current);
      if(at<0||at>999)return null;
      indices.push(at);
      if(parent.id&&/^[A-Za-z][\w-]{0,70}$/.test(parent.id))return 'child:'+parent.id+':'+indices.reverse().join('.');
      current=parent;
    }
    return current===document.body?'node:'+indices.reverse().join('.'):null;
  }
  function resolve(key){
    if(!valid.test(key||''))return null;
    if(key.startsWith('id:'))return document.getElementById(key.slice(3));
    if(key.startsWith('text:'))return Array.from(document.querySelectorAll('[data-cubamax-text]')).find(el=>el.getAttribute('data-cubamax-text')===key.slice(5))||null;
    if(key.startsWith('service:'))return Array.from(document.querySelectorAll('[data-service]')).find(el=>el.getAttribute('data-service')===key.slice(8))||null;
    let current=document.body,path=key.slice(5);
    if(key.startsWith('child:')){const split=key.indexOf(':',6);current=document.getElementById(key.slice(6,split));path=key.slice(split+1);}
    for(const n of path.split('.'))current=current?.children?.[Number(n)];
    return current||null;
  }
  function normalize(pos){
    const x=Number(pos?.x),y=Number(pos?.y),scale=Number(pos?.scale);
    return Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(scale)?
      {x:Math.max(-150,Math.min(150,x)),y:Math.max(-150,Math.min(150,y)),scale:Math.max(.35,Math.min(3.5,scale))}:{...regular};
  }
  const convertedInline=new WeakSet();
  function draw(el,position){
    if(!el||!el.style)return;
    const p=normalize(position),changed=!!(p.x||p.y||p.scale!==1);
    if(changed&&!convertedInline.has(el)&&typeof getComputedStyle==='function'&&getComputedStyle(el).display==='inline'){
      el.style.display='inline-block';convertedInline.add(el);
    }else if(!changed&&convertedInline.has(el)){el.style.display='';convertedInline.delete(el);}
    el.style.translate=p.x||p.y?p.x+'vw '+p.y+'vw':'';
    el.style.scale=p.scale!==1?String(p.scale):'';
  }
  function get(key){return normalize(pending.get(key)||stored()[key]||regular);}
  function set(key,position){if(!valid.test(key||''))return;const value=normalize(position);pending.set(key,value);draw(resolve(key),value);}
  function applyAll(){
    const saved=stored();
    for(const [key,position] of Object.entries(saved))if(valid.test(key))draw(resolve(key),pending.get(key)||position);
    for(const [key,position] of pending)if(!Object.hasOwn(saved,key))draw(resolve(key),position);
  }
  window.pageElementLayout={keyFor,resolve,get,set,applyAll};
  applyAll();
  const observer=new MutationObserver(mutations=>{
    if(mutations.some(m=>m.addedNodes?.length||m.removedNodes?.length))applyAll();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('publiccontentchange',()=>{pending.clear();applyAll();});
})();