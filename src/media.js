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
  // Current per-chat index may repeat cursors; query it directly with an
  // explicit safety ceiling, and label reaching that ceiling as partial.
  const limit=20000;
  const result=await find({chat:chat.id,count:limit,direction:'before'});
  const rows=Array.isArray(result)?result:result?.messages;
  if(!Array.isArray(rows))throw Error('WA_GALLERY_INVALID_RESULT');
  const mediaRows=Number.isInteger(result.mediaCount)?rows.slice(0,result.mediaCount):rows.filter(raw=>['image','video','audio','ptt','sticker'].includes(raw.type));
  for(const raw of mediaRows){
    const remote=api.keyString(raw.id?.remote);
    if(!remote||!peers.has(remote))throw Error('WA_GALLERY_WRONG_CHAT');
    const key=api.keyString(raw.id);if(!key)throw Error('WA_GALLERY_INVALID_ID');
    if(seen.has(key))continue;seen.add(key);
    if(!['image','video'].includes(raw.type))continue;
    const model=typeof raw.serialize==='function'?raw:Msg.get(key)||new Msg.modelClass({...raw,recvFresh:false});
    messages.push(api.getMessageModel(model));
  }
  messages.sort((a,b)=>(a.t||0)-(b.t||0));
  return {messages,complete:mediaRows.length<limit,pages:1};
}
