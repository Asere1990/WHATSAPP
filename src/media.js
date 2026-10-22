// Uses WhatsApp Web's media index, not a slice of ordinary chat messages.
// API shape verified against WPPConnect WA-JS msgFindMedia / getMessages.
export async function readGallery(peer) {
  const api=window.WWebJS,chat=await api.getChat(peer,{getAsModel:false});
  const find=window.require('WAWebDBMessageFindLocal').msgFindMedia;
  if(typeof find!=='function')throw Error('WA_GALLERY_API_UNAVAILABLE');
  const Msg=window.require('WAWebCollections').Msg,seen=new Set(),messages=[];
  let anchor,complete=false,pages=0;
  const started=Date.now();
  while(messages.length<20000&&Date.now()-started<30000){
    const result=await find({chat:chat.id,anchor,count:100,mediaType:'allMedia',direction:'before'});
    const rows=Array.isArray(result)?result:result?.messages;
    if(!Array.isArray(rows))throw Error('WA_GALLERY_INVALID_RESULT');
    pages++;
    if(!rows.length){complete=true;break;}
    let oldest=null,added=0;
    for(const raw of rows){
      const key=api.keyString(raw.id);if(!key)throw Error('WA_GALLERY_INVALID_ID');
      if(!oldest||Number(raw.t||0)<Number(oldest.t||0))oldest=raw;
      if(seen.has(key))continue;seen.add(key);added++;
      const model=typeof raw.serialize==='function'?raw:Msg.get(key)||new Msg.modelClass({...raw,recvFresh:false});
      messages.push(api.getMessageModel(model));
    }
    if(!added)break; // A repeated cursor means partial data, never a claimed total.
    anchor=oldest.id;
  }
  messages.sort((a,b)=>(a.t||0)-(b.t||0));
  return {messages,complete,pages};
}

// Temporary read-only diagnostic: aggregate counts only; no messages, IDs or media.
export async function auditGallery(peer) {
  const api=window.WWebJS,chat=await api.getChat(peer,{getAsModel:false});
  const find=window.require('WAWebDBMessageFindLocal').msgFindMedia;
  const summarize=result=>{
    const rows=Array.isArray(result)?result:result?.messages;
    if(!Array.isArray(rows))throw Error('WA_GALLERY_INVALID_RESULT');
    const types={},mimeTypes={},keys=new Set();let invalidIds=0,missingTimestamp=0;
    for(const row of rows){
      const type=String(row.type||'missing');types[type]=(types[type]||0)+1;
      const mime=String(row.mimetype||'missing');mimeTypes[mime]=(mimeTypes[mime]||0)+1;
      const key=api.keyString(row.id);if(key)keys.add(key);else invalidIds++;
      if(!Number.isFinite(Number(row.t)))missingTimestamp++;
    }
    const counts={};if(!Array.isArray(result))for(const key of ['mediaCount','docCount','linkCount'])if(typeof result?.[key]==='number')counts[key]=result[key];
    return {rows:rows.length,unique:keys.size,types,mimeTypes,invalidIds,missingTimestamp,counts,keys};
  };
  const candidates=[['selected',chat.id]];
  try{
    const prefs=window.require('WAWebUserPrefsMeUser');
    for(const [label,id]of [['phone',prefs.getMaybeMePnUser()],['lid',prefs.getMaybeMeLidUser()]])
      if(id&&!candidates.some(([,value])=>api.keyString(value)===api.keyString(id)))candidates.push([label,id]);
  }catch{}
  const queries=[],combined=new Set();
  for(const [namespace,id]of candidates){
    for(const direction of ['before','after']){
      try{
        const result=summarize(await find({chat:id,count:20000,mediaType:'allMedia',direction}));
        for(const key of result.keys)combined.add(key);
        const {keys,...summary}=result;queries.push({namespace,direction,...summary});
      }catch{queries.push({namespace,direction,error:'QUERY_FAILED'});}
    }
  }
  const modules={};
  for(const name of ['WAWebDBMessageFindLocal'])try{modules[name]=Object.keys(window.require(name)).filter(k=>/media|count/i.test(k));}catch{}
  const signatures={};
  const native=window.require('WAWebDBMessageFindLocal');
  for(const name of ['getAllMediaMessages','getMediaAvailableMsgBoundary'])if(typeof native[name]==='function')signatures[name]=String(native[name]).slice(0,5000);
  const internals={};
  try{internals.maxDays=window.require('WAWebABProps').getABPropConfigValue('media_hub_history_max_days');internals.boundary=native.getMediaAvailableMsgBoundary();}catch{}
  try{
    const map=window.require('__debug').modulesMap;
    for(const name of ['WAWebDBMessageFindLocal','WAWebSendNonMessageDataRequest']){
      const entry=map?.[name];if(!entry)continue;
      internals[name]={fields:Object.keys(entry)};
      for(const key of Object.keys(entry))if(typeof entry[key]==='function')internals[name][key]=String(entry[key]).slice(0,45000);
    }
  }catch{}
  return {queries,combinedUnique:combined.size,endOfHistoryTransferType:chat.endOfHistoryTransferType??null,modules,signatures,internals};
}

// Read the implementation of the native media-query closure for diagnostics.
// Only function source is returned, never closure data or conversation content.
export async function nativeGalleryImplementation(page) {
  const handle=await page.evaluateHandle(()=>window.require('WAWebDBMessageFindLocal').getAllMediaMessages);
  try{
    const client=handle.client,info=await client.send('Runtime.getProperties',{objectId:handle.id,ownProperties:true});
    const scopes=info.internalProperties?.find(p=>p.name==='[[Scopes]]')?.value?.objectId;
    if(!scopes)return {error:'NO_SCOPE_METADATA'};
    const list=await client.send('Runtime.getProperties',{objectId:scopes,ownProperties:true});
    for(const scope of list.result){
      if(!scope.value?.objectId||!scope.value.description?.startsWith('Closure'))continue;
      const props=await client.send('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});
      const implementation=props.result.find(p=>p.name==='w'&&p.value?.type==='function');
      if(implementation){
        const result=await client.send('Runtime.callFunctionOn',{objectId:implementation.value.objectId,functionDeclaration:'function(){return String(this)}',returnByValue:true});
        let source=String(result.result.value),objectId=implementation.value.objectId;
        if(source.includes('var r=this,o=arguments')){
          const inner=await client.send('Runtime.getProperties',{objectId,ownProperties:true});
          const innerScopes=inner.internalProperties?.find(p=>p.name==='[[Scopes]]')?.value?.objectId;
          if(innerScopes){
            const chain=await client.send('Runtime.getProperties',{objectId:innerScopes,ownProperties:true});
            for(const local of chain.result){
              if(!local.value?.objectId||!local.value.description?.startsWith('Closure'))continue;
              const locals=await client.send('Runtime.getProperties',{objectId:local.value.objectId,ownProperties:true});
              const generator=locals.result.find(p=>p.name==='t'&&p.value?.type==='function');
              if(generator){const original=await client.send('Runtime.callFunctionOn',{objectId:generator.value.objectId,functionDeclaration:'function(){return String(this)}',returnByValue:true});source=String(original.result.value);break;}
            }
          }
        }
        return {implementation:source.slice(0,30000)};
      }
    }
    return {error:'NO_IMPLEMENTATION_BINDING'};
  }finally{await handle.dispose();}
}
