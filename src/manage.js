import WA from 'whatsapp-web.js';
import { readAccountPhoto } from './profile.js';
import { readGallery } from './media.js';
import { countryOf } from './identity.js';
import { connectionLabel } from './session.js';
const peerOK=peer=>typeof peer==='string'&&/^[0-9]+@(c\.us|lid)$/.test(peer);
export class AccountTools {
  constructor(accounts){this.accounts=accounts;this.busy=new Set();this.listProblems=new Map();}
  client(id,write=false){
    const a=this.accounts.store.account(id),e=this.accounts.live.get(id);
    if(this.accounts.stopping||!a?.consent||!e?.ready)throw new Error(a?`Estado: ${connectionLabel(this.accounts,a)}. Abre la ficha de la cuenta para recuperar la conexión.`:'Cuenta no encontrada.');
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
    const name=(self?client?.info?.pushname:contact?.pushname)||contact?.name||contact?.shortName||(self?(a.name&&!/^Cuenta\s*[·•]/.test(a.name)?a.name:'Cuenta de WhatsApp'):phone?'+'+phone:'Sin nombre');
    s.saveProfile(id,peer,name,phone);
    return {peer,name,phone,country:countryOf(phone)};
  }
  async list(id){
    const client=this.client(id);let chats;
    try{
      chats=await client.getChats();
      const failed=client.pupPage?.evaluate?await client.pupPage.evaluate(()=>Number(window.WWebJS?.chatReadFailures||0)):0;
      this.listProblems.set(id,failed);
      if(!chats.length&&failed)throw Error('No readable chats');
    }catch(cause){
      this.listProblems.set(id,null);
      const error=new Error('WhatsApp no pudo leer la lista de chats. La cuenta sigue vinculada; vuelve a intentarlo.',{cause});error.code='WA_CHAT_READ';throw error;
    }
    return chats.filter(c=>!c.isGroup&&peerOK(c.id?._serialized)).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  }
  async chat(id,peer){if(!peerOK(peer))throw new Error('Contacto inválido.');return this.client(id).getChatById(peer);}
  async history(id,peer,limit=500){return (await (await this.chat(id,peer)).fetchMessages({limit})).filter(m=>!m.isStatus);}
  async gallery(id,peer){
    if(!peerOK(peer))throw new Error('Contacto inválido.');
    const client=this.client(id);
    try{
      const result=await client.pupPage.evaluate(readGallery,peer);
      return {...result,messages:result.messages.map(raw=>new WA.Message(client,raw))};
    }catch(cause){const error=new Error('No se pudo consultar el índice multimedia de WhatsApp. No se mostrará un conteo incompleto como total.',{cause});error.code='WA_GALLERY_READ';throw error;}
  }
  counts(messages){return {photos:messages.filter(m=>m.type==='image').length,videos:messages.filter(m=>m.type==='video').length};}
  async profilePhoto(id){
    const client=this.client(id),a=this.accounts.store.account(id);
    if(!client.pupPage?.evaluate)return null;
    try{
      const result=await client.pupPage.evaluate(readAccountPhoto,`${a.phone}@c.us`);
      const data=result?.data?Buffer.from(result.data,'base64'):null;
      const valid=data?.length>0&&data.length<=5*1024*1024&&result.mime?.startsWith('image/');
      console.log('WHATSAPP: profile_photo',JSON.stringify({account:id,available:!!valid,source:result?.source||null,bytes:valid?data.length:0,attempts:result?.attempts||[]}));
      return valid?{data,mime:result.mime,name:'perfil.jpg'}:null;
    }catch(error){console.error('WHATSAPP: profile_photo_failed',JSON.stringify({account:id,code:error.code||'WA_PROFILE_READ'}));return null;}
  }
  async overview(id){
    const client=this.client(id),a=this.accounts.store.account(id);let chats=null;
    try{chats=await this.list(id);}catch(error){this.accounts.store.recordIncident(id,'consulta_chats',error);}
    const profile=await this.identity(id,`${a.phone}@c.us`,true);
    const photoData=await this.profilePhoto(id);
    let blocked=null,photo=null;
    try{blocked=(await client.getBlockedContacts()).length;}catch{}
    if(!photoData)try{photo=await client.getProfilePicUrl(`${a.phone}@c.us`);}catch{}
    return {profile,photo,photoData,chats,total:chats?.length??null,open:chats?.filter(c=>!c.archived).length??null,locked:chats?.filter(c=>c.isLocked).length??null,blocked,unreadable:this.listProblems.get(id)};
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
  async downloadRecent(id,peer,kind,onFile,onProgress=async()=>{}){
    const key=id+':'+peer;if(this.busy.has(key))throw new Error('Ya hay una descarga en este chat.');
    this.busy.add(key);
    try{
      this.client(id,true);const s=this.accounts.store,gallery=await this.gallery(id,peer),messages=gallery.messages,allowed=kind==='photos'?['image']:kind==='videos'?['video']:['image','video'];
      const candidates=messages.slice().reverse().filter(m=>allowed.includes(m.type)&&m.hasMedia&&!m.isEphemeral&&!m.rawData?.isViewOnce&&!s.exportState(id,m.id._serialized));
      let sent=0,skipped=0,failed=0;const target=Math.min(10,candidates.length);
      const progress=async phase=>{try{await onProgress({sent,target,skipped,failed,phase,percent:target?Math.floor(sent*100/target):0});}catch{}};
      await progress('downloading');
      for(const msg of candidates){
        if(sent>=10)break;this.client(id,true);
        await progress('downloading');
        const size=Number(msg.rawData?.size||msg.rawData?.fileSize||0),cap=Number(process.env.MAX_MEDIA_MB||20)*1024*1024;
        if(size>cap){skipped++;continue;}
        let media;try{media=await msg.downloadMedia();}catch(error){
          failed++;this.accounts.store.recordIncident(id,'descargar_whatsapp',{code:'WA_MEDIA_DOWNLOAD'},msg.id._serialized);continue;
        }
        if(!media){skipped++;continue;}
        const data=Buffer.from(media.data,'base64');if(!data.length||data.length>cap){skipped++;continue;}
        if(!s.claimExport(id,msg.id._serialized))continue;
        try{await progress('uploading');await onFile(msg,{data,name:media.filename||'archivo',mime:media.mimetype});s.finishExport(id,msg.id._serialized,'done');sent++;await progress('sent');}
        catch(e){s.finishExport(id,msg.id._serialized,'review');throw e;}
      }
      await progress('finished');
      return {sent,target,skipped,failed,scanned:messages.length,complete:gallery.complete};
    }finally{this.busy.delete(key);}
  }
}
