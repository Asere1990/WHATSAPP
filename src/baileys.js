import { EventEmitter } from 'node:events';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import makeWASocket,{ Browsers, DisconnectReason, normalizeMessageContent, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import {isSystemAccount} from './system-config.js';
import { BaileysStore } from './baileys-store.js';
const logger=pino({level:'silent'});
// Spread concurrent account reconnects after transient network failures.
export function reconnectDelay(account,attempt,status){
 const hash=String(account||'').split('').reduce((v,c)=>((v*31+c.charCodeAt(0))>>>0),0);
 const base=status===DisconnectReason.restartRequired?750:Math.min(90000,1000*2**Math.min(attempt+1,7));
 return base+Math.floor(base*(hash%29)/100)+(hash%1100);
}
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
  constructor({store,id,phone,pair=false,galleryOnly=process.env.WA_GALLERY_ONLY!=='false',socketFactory=makeWASocket,mediaDownloader=downloadMediaMessage,persistentRecovery=false}){
    super();this.sourceStore=store;this.galleryOnly=galleryOnly;this.kind='baileys';this.store=new BaileysStore(store,id);this.archiveMessages=store.config().panel_archive==='1';if(this.archiveMessages)this.store.enableArchive();this.account=id;this.phone=phone;this.pair=pair;this.persistentRecovery=!!persistentRecovery;this.socketFactory=socketFactory;this.mediaDownloader=mediaDownloader;this.closed=false;this.generation=0;this.retries=0;this.info={};this.codeRequested=false;this.events=Promise.resolve();this.panelFocusPeer=null;this.panelFocusUntil=0;this.historyDue=0;this.historyPumpActive=false;
  }
  async initialize(){
    if(!this.pair&&!this.store.registered()){this.emit('qr');return;}
    await this.connect();
  }
  async connect(){
    if(this.closed)return;
    this.stopHistory();clearTimeout(this.retryTimer);this.retryTimer=null;
    const epoch=++this.generation;
    // Close the previous socket before replacing it; stale events are ignored
    // because they belong to a different generation.
    try{this.socket?.end?.(undefined);}catch{}
    const {state,saveCreds}=this.store.auth();
    const sock=this.socketFactory({auth:state,logger,browser:Browsers.ubuntu('Chrome'),markOnlineOnConnect:false,syncFullHistory:true,
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
          this.recordFirstMediaBatch(history.messages);
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
          this.saveMessage(m,{live:upsert.type==='notify'});
          // History/append events never replay old conversations into Telegram.
          if((!this.galleryOnly||isSystemAccount(this.sourceStore,{phone:this.phone}))&&upsert.type==='notify'&&!m.key.fromMe&&m.message&&privateJid(toJid(m.key.remoteJid))&&describe(m).type!=='system')this.emit('message',this.wrap(m));
        }
        if(history||upsert?.messages?.length)this.emit('history_saved');
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
      if(this.archiveMessages){const counts=this.store.db.prepare("SELECT COUNT(*) AS total,SUM(json_type(value,'$.message.conversation') IS NOT NULL OR json_type(value,'$.message.extendedTextMessage') IS NOT NULL) AS texts,SUM(json_type(value,'$.message.audioMessage') IS NOT NULL) AS audios FROM baileys_data WHERE account=? AND kind='message'").get(this.account);console.log('WHATSAPP: panel_history_index',JSON.stringify({account:this.account,...counts}));}
      this.historyOnline=true;this.scheduleHistory(this.panelFocusUntil>Date.now()?15000:this.archiveMessages&&this.persistentRecovery?30000:90000);
    }
    if(update.connection==='close'){
      this.stopHistory();
      clearTimeout(this.codeTimer);
      const status=Number(update.lastDisconnect?.error?.output?.statusCode);
      console.log('WHATSAPP: transport_closed',JSON.stringify({account:this.account,status:Number.isFinite(status)?status:null,attempt:this.retries}));
      if(status===DisconnectReason.loggedOut){this.store.clearCredentials();this.emit('disconnected','LOGOUT');return;}
      if(status===DisconnectReason.connectionReplaced){this.emit('disconnected','CONFLICT');return;}
      // Only confirmed and still-authorized WHATSAPP sessions with saved credentials
      // may keep retrying transient transport outages. Never override logout,
      // replacement, revoked consent, or a permanent authentication failure.
      const account=this.sourceStore.account(this.account);
      const transient=!Number.isFinite(status)||[408,428,503,515].includes(status);
      const persistent=transient&&this.persistentRecovery&&!!account?.consent&&!!account.confirmed&&this.store.registered();
      const attempt=this.retries++;
      if(attempt<8||persistent){
        this.emit('reconnecting');
        this.retryTimer=setTimeout(()=>this.connect().catch(error=>this.emit('transport_error',error)),reconnectDelay(this.account,attempt,status));
        this.retryTimer.unref();
      }else this.emit('disconnected','NETWORK');
    }
  }
  saveChat(c){
    if(!c.id)return;const id=toJid(c.id);this.saveMapping({lid:c.lidJid||c.lid||(id.endsWith('@lid')?id:null),pn:c.pnJid||c.phoneNumber||(id.endsWith('@s.whatsapp.net')?id:null)});
    const embedded=this.archiveMessages?[...(c.messages||[]),...(c.lastMessage?[c.lastMessage]:[])]:[];
    if(this.galleryOnly){const {messages,lastMessage,...metadata}=c;c=metadata;}
    this.store.put('chat',id,{...c,id},{merge:true,timestamp:c.conversationTimestamp||0});
    for(const entry of embedded){if(!entry)continue;const m=entry.message?.key?entry.message:entry;if(m?.key&&m.message)this.saveMessage(m);}
  }
  saveMapping({lid,pn}){if(lid&&pn)this.store.put('mapping',toJid(lid),toJid(pn));}
  saveContact(c){if(c.id){this.store.put('contact',toJid(c.id),{...c,id:toJid(c.id)},{merge:true});this.saveMapping({lid:c.lid||(c.id.endsWith('@lid')?c.id:null),pn:c.phoneNumber||(!c.id.endsWith('@lid')?c.id:null)});}}
  // Record the first HISTORY BATCH observed for each chat after this feature
  // is installed. Older initial batches cannot be reconstructed from the DB.
  // This adds only aggregate metadata; it never requests history or media.
  recordFirstMediaBatch(messages){
    if(this.sourceStore.config()['portal:'+this.account]==='cubamax-corporate')return;
    if(!messages?.length)return;
    const batches=new Map(),recordedAt=Date.now();
    for(const m of messages){
      if(!m?.key?.remoteJid||!m.key.id)continue;
      const peer=toJid(m.key.remoteJid);
      if(!privateJid(peer)&&!peer.endsWith('@g.us'))continue;
      if(this.store.get('media-first-batch',peer))continue;
      if(!batches.has(peer))batches.set(peer,{photos:0,videos:0,seen:new Set()});
      const entry=batches.get(peer),logical=JSON.stringify([m.key.id,!!m.key.fromMe,m.key.participant||'']);
      if(entry.seen.has(logical))continue;
      entry.seen.add(logical);
      const d=describe(this.store.projectSelfMessage({...m,key:{...m.key,remoteJid:peer}}));
      if(d.ephemeral||d.viewOnce)continue;
      if(d.type==='image')entry.photos++;
      if(d.type==='video')entry.videos++;
    }
    for(const [peer,{photos,videos}] of batches)
      this.store.put('media-first-batch',peer,{photos,videos,recordedAt});
  }
  saveMessage(m,{live=false}={}){
    if(!m.key?.remoteJid||!m.key.id)return;
    const jid=toJid(m.key.remoteJid),alt=toJid(m.key.remoteJidAlt||'');if(jid.endsWith('@lid')&&alt.endsWith('@s.whatsapp.net'))this.saveMapping({lid:jid,pn:alt});else if(alt.endsWith('@lid')&&jid.endsWith('@s.whatsapp.net'))this.saveMapping({lid:alt,pn:jid});m={...m,key:{...m.key,remoteJid:jid}};
    // A self-chat history item may carry a device-sent envelope or use the
    // authenticated account's LID instead of its phone-number JID.
    const visible=this.store.projectSelfMessage(m);
    const d=describe(visible);if(this.archiveMessages&&live&&!d.ephemeral&&!d.viewOnce&&d.type!=='system')this.store.primeArchive(m);
    this.store.rememberOldest(m);if(this.archiveMessages)this.store.advanceArchive(m);
    if(this.archiveMessages){if(!d.ephemeral&&!d.viewOnce)this.store.message({...m,message:d.content});}
    else if(!this.galleryOnly)this.store.message(m);
    else if(['image','video'].includes(d.type)&&!d.ephemeral&&!d.viewOnce)this.store.message({...m,message:{[d.kind]:d.media}});
    if(privateJid(jid)||this.archiveMessages&&jid.endsWith('@g.us')){const old=this.store.get('chat',jid)||{id:jid};if(Number(m.messageTimestamp)>Number(old.conversationTimestamp||0))this.saveChat({...old,conversationTimestamp:Number(m.messageTimestamp)});}
    // An independent disk worker archives eligible attachments without blocking
    // history ingestion, and never saves disappearing or view-once content.
    if(this.archiveMessages&&d.media&&!d.viewOnce&&!d.ephemeral)this.emit('media_saved',visible);
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
  async downloadMediaFile(raw,destination,maxBytes){
    const d=describe(raw);
    if(!d.media||d.ephemeral||d.viewOnce)throw Error('Archivo no disponible.');
    if(Number(d.media.fileLength||0)>maxBytes)throw Error('Archivo demasiado grande.');
    const input=await this.mediaDownloader(raw,'stream',{},{
      logger,reuploadRequest:this.socket?.updateMediaMessage
    });
    let bytes=0;
    const count=new Transform({transform(chunk,encoding,next){
      bytes+=chunk.length;
      if(bytes>maxBytes)return next(Error('Archivo demasiado grande.'));
      next(null,chunk);
    }});
    try{
      await pipeline(input,count,createWriteStream(destination,{flags:'wx',mode:0o600}));
    }finally{input.destroy?.();}
    if(!bytes)throw Error('WhatsApp no entregó datos del archivo.');
    return {bytes,mime:d.media.mimetype||'application/octet-stream',name:d.media.fileName||d.type};
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
  async getProfilePicUrl(peer,{type='image'}={}){return this.socket.profilePictureUrl(toJid(peer),type);}
  async getBlockedContacts(){return this.socket.fetchBlocklist();}
  stopHistory(){this.historyOnline=false;clearTimeout(this.historyTimer);this.historyTimer=null;this.historyDue=0;}
  setPanelFocus(peer=null,active=false,now=Date.now()){
    const previous=this.panelFocusPeer,wasActive=this.panelFocusUntil>now;
    this.panelFocusPeer=active&&peer?toJid(peer):null;
    this.panelFocusUntil=active?now+60000:0;
    // An actively viewed account can start sooner, but never bypasses the
    // per-conversation history cooldown/backoff stored in SQLite.
    if(active&&(!wasActive||previous!==this.panelFocusPeer)&&this.historyOnline&&this.galleryOnly)
      this.scheduleHistory(5000);
  }
  scheduleHistory(delay=90000){
    if(this.closed||!this.historyOnline||!this.galleryOnly)return;
    const due=Date.now()+delay;
    if(this.historyTimer){
      if(this.historyDue<=due)return;
      clearTimeout(this.historyTimer);
    }
    this.historyDue=due;
    this.historyTimer=setTimeout(()=>{
      this.historyTimer=null;this.historyDue=0;
      this.pumpHistory().catch(()=>{this.scheduleHistory(90000);});
    },delay);
    this.historyTimer.unref();
  }
  async pumpHistory(now=Date.now()){
    if(this.closed||!this.historyOnline||!this.galleryOnly||this.historyPumpActive)return;
    this.historyPumpActive=true;
    const epoch=this.generation,focused=this.panelFocusUntil>now;
    try{
      // One request at a time per account; the focused chat is checked first,
      // while all other chats retain their existing cooldown and get turns.
      const peers=focused&&this.panelFocusPeer?new Set(this.store.peers(this.panelFocusPeer)):null;
      const pending=this.store.list('cursor',2147483647)
        .filter(c=>privateJid(c.key?.remoteJid)||this.archiveMessages&&c.key?.remoteJid?.endsWith('@g.us')||peers?.has(c.key?.remoteJid))
        .map(cursor=>({cursor,state:this.store.get('history-sync',cursor.key.remoteJid)||{}}))
        .sort((a,b)=>(a.state.next||0)-(b.state.next||0));
      const due=pending.filter(({state})=>!state.next||state.next<=now);
      const item=(peers?due.find(({cursor})=>peers.has(cursor.key.remoteJid)):null)||due[0];
      if(item)try{await this.syncHistory(item.cursor.key.remoteJid,now);}catch{ /* Do not disconnect a healthy account for missing history. */ }
    }finally{
      this.historyPumpActive=false;
      if(this.generation===epoch&&!this.closed&&this.historyOnline)
        this.scheduleHistory(focused?45000:this.archiveMessages&&this.persistentRecovery?55000:90000);
    }
  }
  async syncHistory(peer,now=Date.now()){
    let jid=toJid(peer),backfill=this.archiveMessages?this.store.get('archive-backfill',jid):null;
    let oldest=backfill?.active?backfill.cursor:this.store.get('cursor',jid)||this.store.oldestMessage(jid);
    // The displayed self-chat may have no phone-number cursor while its
    // LID form already has a real history anchor. Request with that anchor,
    // never a fabricated message identifier or timestamp.
    if(!oldest&&this.store.isSelfChat(jid)){
      for(const alternate of this.store.peers(jid)){
        if(alternate===jid)continue;
        const pending=this.archiveMessages?this.store.get('archive-backfill',alternate):null;
        const anchor=pending?.active?pending.cursor:this.store.get('cursor',alternate)||this.store.oldestMessage(alternate);
        if(anchor){jid=alternate;oldest=anchor;break;}
      }
    }
    if(!oldest)return false;
    const previous=this.store.get('history-sync',jid)||{};
    if(previous.next>now)return true;
    const cursor=JSON.stringify(oldest.key),stalls=previous.cursor===cursor?Math.min(10,(previous.stalls||0)+1):0;
    // Allow a minute for asynchronous batches; back off when the phone sends no older cursor.
    const delay=stalls?Math.min(6*3600000,60000*2**stalls):60000;
    this.store.put('history-sync',jid,{cursor,stalls,next:now+delay});
    let timer;
    try{await Promise.race([this.socket.fetchMessageHistory(50,oldest.key,Number(oldest.messageTimestamp)*1000),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('History request timeout')),30000);timer.unref();})]);}
    finally{clearTimeout(timer);}
    return true;
  }
  async sendMessage(peer,content,options={}){
    let data;
    if(typeof content==='string')data={text:content};
    else {const buffer=Buffer.from(content.data,'base64'),mime=content.mimetype||'application/octet-stream';const kind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';data={[kind]:buffer,mimetype:mime,...(kind==='audio'?{ptt:!!options.sendAudioAsVoice}:{caption:options.caption||''}),...(kind==='document'?{fileName:content.filename||'archivo'}:{})};}
    const raw=await this.socket.sendMessage(toJid(peer),data);if(!raw?.key?.id)throw Error('WhatsApp no confirmó el envío. Revisa antes de repetirlo.');this.saveMessage(raw,{live:true});return this.wrap(raw);
  }
  async logout(){this.stopHistory();this.closed=true;clearTimeout(this.retryTimer);clearTimeout(this.codeTimer);await this.socket?.logout();this.store.clearCredentials();}
  async destroy(){this.stopHistory();this.closed=true;this.generation++;clearTimeout(this.retryTimer);clearTimeout(this.codeTimer);this.socket?.end(undefined);await this.events;}
}
