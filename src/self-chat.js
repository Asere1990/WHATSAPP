// Self-chat IDs from the authenticated WhatsApp account only. These helpers
// never grant access to a different account or infer an ID from message text.
export function normalizedPrivateJid(value){
  const input=String(value||'').replace(/@c\.us$/,'@s.whatsapp.net');
  const parts=/^([0-9]+)(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/.exec(input);
  return parts?`${parts[1]}@${parts[2]}`:null;
}

export function authenticatedSelfJids(phone,me){
  const pn=/^[1-9][0-9]{7,14}$/.test(String(phone||''))?`${phone}@s.whatsapp.net`:null;
  // Never associate a LID with a different stored phone number.
  if(!pn||normalizedPrivateJid(me?.id)!==pn)return [];
  const lid=normalizedPrivateJid(me?.lid);
  return lid?.endsWith('@lid')?[pn,lid]:[pn];
}

// Older history batches can include the device-sent envelope even though
// newer socket events normally arrive with it already decoded by Baileys.
// Only unwrap if both the chat and destination match our authenticated self IDs.
export function projectAuthenticatedSelfMessage(raw,selfJids){
  const current=normalizedPrivateJid(raw?.key?.remoteJid);
  const sent=raw?.message?.deviceSentMessage;
  const destination=normalizedPrivateJid(sent?.destinationJid);
  if(!current||!destination||!selfJids?.includes(current)||!selfJids.includes(destination)
     ||!sent.message||typeof sent.message!=='object')return raw;
  return {...raw,message:sent.message};
}
