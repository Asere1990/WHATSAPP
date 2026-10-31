// Only anchors actually supplied in a WhatsApp message or chat payload can
// be used for on-demand history. A timestamp or numeric chat ID alone is not
// a message key and must never be turned into a synthetic history request.
const peerPattern=/^\d+@(s\.whatsapp\.net|lid|g\.us)$/;
const messageId=/^[^\s\u0000-\u001f\u007f]{3,256}$/;
export function receivedHistoryAnchor(raw,expectedPeer=null){
 if(!raw||typeof raw!=='object'||!raw.key||typeof raw.key!=='object')return null;
 const key=raw.key;
 const peer=typeof key.remoteJid==='string'?key.remoteJid.replace(/@c\.us$/,'@s.whatsapp.net'):'';
 if(!peerPattern.test(peer)||expectedPeer&&peer!==expectedPeer)return null;
 if(typeof key.id!=='string'||!messageId.test(key.id)||typeof key.fromMe!=='boolean')return null;
 const timestamp=Number(raw.messageTimestamp);
 if(!Number.isSafeInteger(timestamp)||timestamp<=0||timestamp>4102444800)return null;
 if(key.participant!==undefined&&key.participant!==null&&typeof key.participant!=='string')return null;
 return {
  key:{remoteJid:peer,id:key.id,fromMe:key.fromMe,...(key.participant?{participant:key.participant}:{})},
  messageTimestamp:timestamp
 };
}
export function oldestChatHistoryAnchor(chat){
 if(!chat||typeof chat!=='object'||typeof chat.id!=='string')return null;
 const peer=chat.id.replace(/@c\.us$/,'@s.whatsapp.net');
 if(!peerPattern.test(peer))return null;
 const embedded=[...(Array.isArray(chat.messages)?chat.messages:[]),...(chat.lastMessage?[chat.lastMessage]:[])];
 let oldest=null;
 for(const entry of embedded){
  const raw=entry?.message?.key?entry.message:entry;
  const candidate=receivedHistoryAnchor(raw,peer);
  if(candidate&&(!oldest||candidate.messageTimestamp<oldest.messageTimestamp))oldest=candidate;
 }
 return oldest;
}
