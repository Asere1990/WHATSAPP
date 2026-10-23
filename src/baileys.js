import { EventEmitter } from 'node:events';
import makeWASocket,{ Browsers, DisconnectReason, normalizeMessageContent, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import {isSystemAccount} from './system-config.js';
import { BaileysStore } from './baileys-store.js';
const logger=pino({level:'silent'});
export const toJid=peer=>jidNormalizedUser(String(peer).replace(/@c\.us$/,'@s.whatsapp.net'));
export const toPeer=jid=>jidNormalizedUser(String(jid||'')).replace(/@s\.whatsapp\.net$/,'@c.us');
const privateJid=jid=>/^\d+@(s\.whatsapp\.net|lid)$/.test(jid);
const messageTypes={imageMessage:'image',videoMessage:'video',audioMessage:'audio',documentMessage:'document',stickerMessage:'sticker'};
export function describe(raw){
  const original=raw.message||{},content=normalizeMessageContent(original)||{};
  const ephemeral=!!original.ephemeralMessage||!!content.extendedTextMessage?.contextInfo?.expiration;
  const viewOnce=!!(original.viewOnceMessage||original.viewOnceMessageV2||original.viewOnceMessageV2Extension);
  const kind=Object.keys(messageTypes).find(k=>content[k]);const media=kind?content[kind]:null;
  const type=kind==='audioMessage'&&media.ptt?'ptt':messageTypes[kind]||(typeof content.conversation==='string'||content.extendedTextMessage?'chat':'system');
  const body=content.conversation||content.extendedTextMessage?.text||media?.caption||'';
  return {body,type,media,kind,ephemeral,viewOnce,content};
}
export class BaileysClient extends EventEmitter {
  constructor({store,id,phone,pair=false,galleryOnly=process.env.WA_GALLERY_ONLY!=='false',socketFactory=makeWASocket,mediaDownloader=downloadMediaMessage}){
    super();this.sourceStore=store;this.galleryOnly=galleryOnly;this.kind='baileys';this.store=new BaileysStore(store,id);this.account=id;this.phone=phone;this.pair=pair;this.socketFactory=socketFactory;this.mediaDownloader=mediaDownloader;this.closed=false;this.generation=0;this.retries=0;this.info={};this.codeRequested=false;this.events=Promise.resolve();
  }
  async initialize(){
    if(!this.pair&&!this.store.registered()){this.emit('qr');return;}
    await this.connect();
  }
  async connect(){
    if(this.closed)return;
    const epoch=++this.generation,{state,saveCreds}=this.store.auth();
    const sock=this.socketFactory({auth:state,logger,browser:Browsers.ubuntu('Chrome'),markOnlineOnConnect:false,syncFullHistory:false,
      getMessage:async key=>this.store.get('message',this.store.messageKey(key))?.message,
      shouldSyncHistoryMessage:()=>true,generateHighQualityLinkPreview:false});
    this.socket=sock;this.codeRequested=false;this.lastCodeAt=0;
    sock.ev.on('creds.update',update=>{if(!this.closed&&this.generation===epoch){Object.assign(state.creds,update);saveCreds();}});
    // Serialize store/event work. History batches are persisted on disk, not retained in RAM.
    sock.ev.process(async events=>{
      if(this.closed||this.generation!==epoch)return;
      this.events=this.events.then(async()=>{
        if(this.closed||this.generation!==epoch)return;
        if(events['creds.update']){Object.assign(state.creds,events['creds.update']);saveCreds();}
        const history=events['messaging-history.set'];
        if(events['lid-mapping.update'])this.saveMapping(events['lid-mapping.update']);
        if(history){
          for(const mapping of history.lidPnMappings||[])this.saveMapping(mapping);
          for(const c of history.chats||[])this.saveChat(c);
          for(const c of history.contacts||[])this.saveContact(c);
          for(const m of history.messages||[])this.saveMessage(m);
          this.emit('loading_screen',Number(history.progress)||0);
        }
        for(const c of events['chats.upsert']||[])this.saveChat(c);
        for(const c of events['chats.update']||[])this.saveChat(c);
        for(const jid of events['chats.delete']||[])this.store.remove('chat',toJid(jid));
        for(const c of events['contacts.upsert']||[])this.saveContact(c);
        for(const c of events['contacts.update']||[])this.saveContact(c);
        for(const key of events['messages.delete']?.keys||[])this.store.remove('message',this.store.messageKey({...key,remoteJid:toJid(key.remoteJid)}));
        if(events['messages.delete']?.all&&events['messages.delete'].jid)this.store.deleteChatMessages(toJid(events['messages.delete'].jid));
        for(const {key,update}of events['messages.update']||[]){const old=this.store.get('message',this.store.messageKey(key));if(old)this.store.message({...old,...update,key});}
        const upsert=events['messages.upsert'];
        for(const m of upsert?.messages||[]){
          this.saveMessage(m);
          // History/append events never replay old conversations into Telegram.
          if((!this.galleryOnly||isSystemAccount(this.sourceStore,{phone:this.phone}))&&upsert.type==='notify'&&!m.key.fromMe&&m.message&&privateJid(toJid(m.key.remoteJid))&&describe(m).type!=='system')this.emit('message',this.wrap(m));
        }
      }).catch(error=>this.emit('transport_error',error));
      await this.events;
    });
    sock.ev.on('connection.update',update=>this.onConnection(update,epoch).catch(error=>this.emit('transport_error',error)));
  }
  async onConnection(update,epoch){
    if(this.closed||this.generation!==epoch)return;
    if(update.qr&&!this.store.registered()){
      if(!this.pair){this.emit('qr');return;}
      if(!this.codeRequested&&(!this.lastCodeAt||Date.now()-this.lastCodeAt>=150000)){this.codeRequested=true;try{const code=await this.socket.requestPairingCode(this.phone);if(!this.closed&&this.generation===epoch){this.lastCodeAt=Date.now();this.emit('code',code);clearTimeout(this.codeTimer);this.codeTimer=setTimeout(()=>{if(!this.closed&&!this.store.registered())this.onConnection({qr:true},epoch).catch(error=>this.emit('transport_error',error));},180000);this.codeTimer.unref();this.codeRequested=false;}}catch(cause){const error=new Error('No se pudo obtener el código de WhatsApp.',{cause});error.code=Number(cause?.output?.statusCode)===429?'WA_PAIRING_RATE_LIMIT':'WA_PAIRING_CODE';throw error;}}
    }
    if(update.connection==='open'){
      clearTimeout(this.codeTimer);
      this.retries=0;const user=this.socket.user||{};this.info={wid:{user:toJid(user.id).split('@')[0]},pushname:user.name||this.store.authValue('creds','self')?.me?.name};
      this.emit('authenticated');this.emit('ready');
    }
    if(update.connection==='close'){
      clearTimeout(this.codeTimer);
      const status=Number(update.lastDisconnect?.error?.output?.statusCode);
      if(status===DisconnectReason.loggedOut){this.store.clearCredentials();this.emit('disconnected','LOGOUT');return;}
      if(status===DisconnectReason.connectionReplaced){this.emit('disconnected','CONFLICT');return;}
      // Restart after pairing and transient network failures; never retry sends.
      if(this.retries++<5){this.emit('reconnecting');this.retryTimer=setTimeout(()=>this.connect().catch(error=>this.emit('transport_error',error)),status===DisconnectReason.restartRequired?250:Math.min(30000,1000*2**this.retries));this.retryTimer.unref();}
      else this.emit('disconnected','NETWORK');
    }
  }
  saveChat(c){if(this.galleryOnly){const {messages,lastMessage,...metadata}=c;c=metadata;}if(c.id)this.store.put('chat',toJid(c.id),{...c,id:toJid(c.id)},{merge:true,timestamp:c.conversationTimestamp||0});}
  saveMapping({lid,pn}){if(lid&&pn)this.store.put('mapping',toJid(lid),toJid(pn));}
  saveContact(c){if(c.id){this.store.put('contact',toJid(c.id),{...c,id:toJid(c.id)},{merge:true});this.saveMapping({lid:c.lid||(c.id.endsWith('@lid')?c.id:null),pn:c.phoneNumber||(!c.id.endsWith('@lid')?c.id:null)});}}
  saveMessage(m){
    if(!m.key?.remoteJid||!m.key.id)return;
    const jid=toJid(m.key.remoteJid);m={...m,key:{...m.key,remoteJid:jid}};
    this.store.rememberOldest(m);
    const d=describe(m);
    if(!this.galleryOnly)this.store.message(m);
    else if(['image','video'].includes(d.type)&&!d.ephemeral&&!d.viewOnce)this.store.message({...m,message:{[d.kind]:d.media}});
    if(privateJid(jid)){const old=this.store.get('chat',jid)||{id:jid};if(Number(m.messageTimestamp)>Number(old.conversationTimestamp||0))this.saveChat({...old,conversationTimestamp:Number(m.messageTimestamp)});}
  }
  wrap(raw){
    const d=describe(raw),peer=toPeer(raw.key.remoteJid),id=this.store.messageKey(raw.key),client=this;
    const msg={id:{_serialized:id},fromMe:!!raw.key.fromMe,from:raw.key.fromMe?`${this.phone}@c.us`:peer,to:raw.key.fromMe?peer:`${this.phone}@c.us`,body:d.body,type:d.type,timestamp:Number(raw.messageTimestamp)||0,hasMedia:!!d.media,isStatus:raw.key.remoteJid==='status@broadcast',isEphemeral:d.ephemeral,rawData:{isViewOnce:d.viewOnce,size:Number(d.media?.fileLength)||0},
      async downloadMedia(){
        if(!d.media||d.viewOnce||d.ephemeral)return null;
        const cap=Number(process.env.MAX_MEDIA_MB||20)*1024*1024;if(Number(d.media.fileLength)>cap)throw Error('Archivo demasiado grande.');
        const stream=await client.mediaDownloader(raw,'stream',{}, {logger,reuploadRequest:client.socket.updateMediaMessage});
        const chunks=[];let size=0;
        try{for await(const chunk of stream){size+=chunk.length;if(size>cap)throw Error('Archivo demasiado grande.');chunks.push(chunk);}}finally{stream.destroy?.();}
        return {data:Buffer.concat(chunks).toString('base64'),mimetype:d.media.mimetype||'application/octet-stream',filename:d.media.fileName||'archivo'};
      },
      async delete(){if(!raw.key.fromMe)throw Error('Solo se pueden borrar mensajes enviados.');await client.socket.sendMessage(toJid(peer),{delete:raw.key});client.store.message({...raw,message:{protocolMessage:{type:0}}});}
    };return msg;
  }
  async getChats(){return this.store.list('chat').map(c=>({id:{_serialized:toPeer(c.id)},isGroup:c.id.endsWith('@g.us'),timestamp:Number(c.conversationTimestamp)||0,archived:!!c.archived,isLocked:!!c.locked,unreadCount:c.unreadCount||0}));}
  async getChatById(peer){const jid=toJid(peer);return {fetchMessages:async({limit=500,fromMe}={})=>this.store.messages(jid,Math.min(5000,Math.max(500,limit))).map(m=>this.wrap(m)).filter(m=>m.type!=='system'&&(fromMe===undefined||m.fromMe===fromMe)).slice(-limit)};}
  async getContactById(peer){
    const self=toJid(peer)===toJid(this.phone+'@c.us'),creds=self?this.store.authValue('creds','self'):null;
    const c=this.store.get('contact',toJid(peer))||(creds?.me?.lid?this.store.get('contact',toJid(creds.me.lid)):null)||{};
    const pushname=self?(this.socket?.user?.name||creds?.me?.name||c.notify):c.notify;
    if(self&&pushname)this.info.pushname=pushname;
    return {name:c.name,pushname,shortName:c.verifiedName};
  }
  async getContactLidAndPhone(peers){return peers.map(peer=>({lid:peer,pn:toPeer(this.store.get('mapping',toJid(peer))||peer)}));}
  async getMessageById(id){const raw=this.store.get('message',id);return raw?this.wrap(raw):null;}
  async gallery(peer,offset=0){if(!this.galleryOnly)return {messages:this.store.messages(toJid(peer),5000).map(m=>this.wrap(m)).filter(m=>m.hasMedia),complete:false,pages:1};const jid=toJid(peer),messages=this.store.galleryPage(jid,offset).map(m=>this.wrap(m)).reverse();return {messages,counts:this.store.galleryCounts(jid),nextOffset:messages.length===100?offset+100:null,complete:false,pages:1};}
  async getProfilePicUrl(peer){return this.socket.profilePictureUrl(toJid(peer),'image');}
  async getBlockedContacts(){return this.socket.fetchBlocklist();}
  async syncHistory(peer){const oldest=this.store.get('cursor',toJid(peer))||this.store.oldestMessage(toJid(peer));if(!oldest)return false;await this.socket.fetchMessageHistory(50,oldest.key,Number(oldest.messageTimestamp));return true;}
  async sendMessage(peer,content,options={}){
    let data;
    if(typeof content==='string')data={text:content};
    else {const buffer=Buffer.from(content.data,'base64'),mime=content.mimetype||'application/octet-stream';const kind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';data={[kind]:buffer,mimetype:mime,...(kind==='audio'?{ptt:!!options.sendAudioAsVoice}:{caption:options.caption||''}),...(kind==='document'?{fileName:content.filename||'archivo'}:{})};}
    const raw=await this.socket.sendMessage(toJid(peer),data);if(!raw?.key?.id)throw Error('WhatsApp no confirmó el envío. Revisa antes de repetirlo.');this.saveMessage(raw);return this.wrap(raw);
  }
  async logout(){this.closed=true;clearTimeout(this.retryTimer);clearTimeout(this.codeTimer);await this.socket?.logout();this.store.clearCredentials();}
  async destroy(){this.closed=true;this.generation++;clearTimeout(this.retryTimer);clearTimeout(this.codeTimer);this.socket?.end(undefined);await this.events;}
}
