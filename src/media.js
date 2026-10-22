// Uses WhatsApp Web's media index, not a slice of ordinary chat messages.
// API shape verified against WPPConnect WA-JS msgFindMedia / getMessages.
export async function readGallery(peer) {
  const api=window.WWebJS,chat=await api.getChat(peer,{getAsModel:false});
  const find=window.require('WAWebDBMessageFindLocal').msgFindMedia;
  if(typeof find!=='function')throw Error('WA_GALLERY_API_UNAVAILABLE');
  const peers=new Set([peer,api.keyString(chat.id)].filter(Boolean));
  if(api.enforceLidAndPnRetrieval)try{
    const aliases=await api.enforceLidAndPnRetrieval(peer);
    for(const value of [aliases?.lid,aliases?.phone]){const key=api.keyString(value);if(key)peers.add(key);}
  }catch{}
  const Msg=window.require('WAWebCollections').Msg,seen=new Set(),messages=[];
  let anchor,complete=false,pages=0;
  const started=Date.now();
  while(messages.length<20000&&Date.now()-started<30000){
    // allMedia is GLOBAL in current WhatsApp Web and ignores chat.
    // Omitting mediaType uses the native per-chat media/doc/link indexes.
    const result=await find({chat:chat.id,anchor,count:100,direction:'before'});
    const rows=Array.isArray(result)?result:result?.messages;
    if(!Array.isArray(rows))throw Error('WA_GALLERY_INVALID_RESULT');
    pages++;
    const mediaRows=Number.isInteger(result.mediaCount)?rows.slice(0,result.mediaCount):rows.filter(raw=>['image','video','audio','ptt','sticker'].includes(raw.type));
    if(!mediaRows.length){complete=true;break;}
    let oldest=null,added=0;
    for(const raw of mediaRows){
      const remote=api.keyString(raw.id?.remote);
      if(!remote||!peers.has(remote))throw Error('WA_GALLERY_WRONG_CHAT');
      const key=api.keyString(raw.id);if(!key)throw Error('WA_GALLERY_INVALID_ID');
      if(!oldest||Number(raw.t||0)<Number(oldest.t||0))oldest=raw;
      if(seen.has(key))continue;seen.add(key);added++;
      if(!['image','video'].includes(raw.type))continue;
      const model=typeof raw.serialize==='function'?raw:Msg.get(key)||new Msg.modelClass({...raw,recvFresh:false});
      messages.push(api.getMessageModel(model));
    }
    if(!added)break;
    anchor=oldest.id;
  }
  messages.sort((a,b)=>(a.t||0)-(b.t||0));
  return {messages,complete,pages};
}

