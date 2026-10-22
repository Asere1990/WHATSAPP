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
