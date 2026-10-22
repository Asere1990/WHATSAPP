import { countryOf } from './identity.js';
const peerOK=peer=>typeof peer==='string'&&/^[0-9]+@(c\.us|lid)$/.test(peer);
export class AccountTools {
  constructor(accounts){this.accounts=accounts;this.busy=new Set();}
  client(id,write=false){
    const a=this.accounts.store.account(id),e=this.accounts.live.get(id);
    if(this.accounts.stopping||!a?.consent||!e?.ready)throw new Error('Cuenta desconectada.');
    if(write&&a.paused)throw new Error('Cuenta pausada.');
    return e.client;
  }
  async identity(id,peer,refresh=false){
    if(!peerOK(peer))throw new Error('Contacto inválido.');
    const s=this.accounts.store,a=s.account(id),self=peer===`${a.phone}@c.us`,cached=s.profile(id,peer);
    if(cached&&!refresh)return {...cached,country:countryOf(cached.phone)};
    const client=this.accounts.live.get(id)?.client;
    let phone=peer.endsWith('@c.us')?peer.split('@')[0]:'',contact;
    try{contact=await client?.getContactById?.(peer);}catch{}
    if(!phone&&client?.getContactLidAndPhone)try{
      const found=await client.getContactLidAndPhone([peer]);
      const pn=found?.[0]?.pn;if(typeof pn==='string'&&/^[0-9]+@c\.us$/.test(pn))phone=pn.split('@')[0];
    }catch{}
    const name=(self?client?.info?.pushname:contact?.pushname)||contact?.name||contact?.shortName||(self?a.name:phone?'+'+phone:'Sin nombre');
    s.saveProfile(id,peer,name,phone);
    return {peer,name,phone,country:countryOf(phone)};
  }
  async list(id){return (await this.client(id).getChats()).filter(c=>!c.isGroup&&peerOK(c.id?._serialized)).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));}
  async chat(id,peer){if(!peerOK(peer))throw new Error('Contacto inválido.');return this.client(id).getChatById(peer);}
  async history(id,peer,limit=500){return (await (await this.chat(id,peer)).fetchMessages({limit})).filter(m=>!m.isStatus);}
  counts(messages){return {photos:messages.filter(m=>m.type==='image').length,videos:messages.filter(m=>m.type==='video').length};}
  async overview(id){
    const client=this.client(id),a=this.accounts.store.account(id),chats=await this.list(id);
    const profile=await this.identity(id,`${a.phone}@c.us`,true);
    let blocked=null,photo=null;
    try{blocked=(await client.getBlockedContacts()).length;}catch{}
    try{photo=await client.getProfilePicUrl(`${a.phone}@c.us`);}catch{}
    return {profile,photo,chats,total:chats.length,open:chats.filter(c=>!c.archived).length,locked:chats.filter(c=>c.isLocked).length,blocked};
  }
  async lastOutgoing(id,peer){return (await (await this.chat(id,peer)).fetchMessages({limit:1,fromMe:true})).filter(m=>m.fromMe&&m.type!=='revoked').at(-1);}
  async deleteOutgoing(id,peer,messageId){
    const client=this.client(id,true),msg=await client.getMessageById(messageId);
    if(!msg?.fromMe||msg.to!==peer)throw new Error('El mensaje ya no está disponible en esa conversación.');
    // The library otherwise silently falls back to deleting only for this account.
    const allowed=await client.pupPage.evaluate(async serialized=>{
      const Msg=window.require('WAWebCollections').Msg;
      const m=Msg.get(serialized)||(await Msg.getMessagesById([serialized]))?.messages?.[0];
      return !!m&&window.require('WAWebMsgActionCapability').canSenderRevokeMsg(m);
    },messageId);
    if(!allowed)throw new Error('WhatsApp no permite borrar este mensaje para todos.');
    await msg.delete(true);this.accounts.store.audit(id,'delete_outgoing');
  }
  async downloadRecent(id,peer,kind,onFile){
    const key=id+':'+peer;if(this.busy.has(key))throw new Error('Ya hay una descarga en este chat.');
    this.busy.add(key);
    try{
      this.client(id,true);const s=this.accounts.store,messages=await this.history(id,peer),allowed=kind==='photos'?['image']:kind==='videos'?['video']:['image','video'];
      const candidates=messages.slice().reverse().filter(m=>allowed.includes(m.type)&&m.hasMedia&&!m.isEphemeral&&!m.rawData?.isViewOnce&&!s.exportState(id,m.id._serialized));
      let sent=0,skipped=0;
      for(const msg of candidates){
        if(sent>=10)break;this.client(id,true);
        const size=Number(msg.rawData?.size||msg.rawData?.fileSize||0),cap=Number(process.env.MAX_MEDIA_MB||20)*1024*1024;
        if(!(size>0&&size<=cap)){skipped++;continue;}
        const media=await msg.downloadMedia();if(!media){skipped++;continue;}
        const data=Buffer.from(media.data,'base64');if(data.length>cap){skipped++;continue;}
        if(!s.claimExport(id,msg.id._serialized))continue;
        try{await onFile(msg,{data,name:media.filename||'archivo',mime:media.mimetype});s.finishExport(id,msg.id._serialized,'done');sent++;}
        catch(e){s.finishExport(id,msg.id._serialized,'review');throw e;}
      }
      return {sent,skipped,scanned:messages.length};
    }finally{this.busy.delete(key);}
  }
}
