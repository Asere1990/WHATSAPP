import {toJid,describe} from './baileys.js';

const validPeer=peer=>/^\d+@(s\.whatsapp\.net|lid|g\.us)$/.test(peer||'');
const isPhone=peer=>/^\d+@s\.whatsapp\.net$/.test(peer||'');
const isLid=peer=>/^\d+@lid$/.test(peer||'');
const previews={image:'Foto',video:'Video',audio:'Audio',ptt:'Mensaje de voz',document:'Documento',sticker:'Sticker'};

// This index contains chat HEADERS only, never message history or media data.
// It avoids doing an expensive contact/mapping lookup for every chat on every
// panel refresh. Only the visible 50 rows receive full names and previews.
export class PanelChatList{
 constructor(store,profiles,{now=()=>Date.now(),ttl=15000,pageSize=50,visibleFilter=null}={}){
  this.store=store;this.profiles=profiles;this.now=now;this.ttl=ttl;this.pageSize=pageSize;this.cache=new Map();this.visibleFilter=visibleFilter;
 }
 snapshot(account,db){
  const cached=this.cache.get(account),now=this.now();
  if(cached&&cached.expires>now)return cached;
  // Read compact chat headers from SQLite, not all messages or full chat JSON.
  const raw=this.store.db.prepare(`SELECT id,timestamp,
    json_extract(value,'$.conversationTimestamp') AS updated,
    json_extract(value,'$.unreadCount') AS unread
    FROM baileys_data WHERE account=? AND kind='chat'
    ORDER BY timestamp DESC LIMIT 100000`).all(account);
  const mappings=this.store.db.prepare(
   "SELECT id,value FROM baileys_data WHERE account=? AND kind='mapping'"
  ).all(account);
  const lidToPhone=new Map(),phoneToLids=new Map(),own=db.selfJids(),ownSet=new Set(own);
  for(const m of mappings){
   const lid=toJid(m.id);
   if(!isLid(lid))continue;
   let phone;
   try{phone=toJid(JSON.parse(m.value));}catch{continue;}
   if(!isPhone(phone))continue;
   // Unauthenticated LIDs must never be merged into the account's own chat.
   if(own.length>1&&ownSet.has(phone)&&!ownSet.has(lid))continue;
   lidToPhone.set(lid,phone);
   if(!phoneToLids.has(phone))phoneToLids.set(phone,[]);
   phoneToLids.get(phone).push(lid);
  }
  const canonical=peer=>{
   if(!isLid(peer))return peer;
   if(own.length>1&&ownSet.has(peer))return own.find(isPhone)||peer;
   return lidToPhone.get(peer)||peer;
  };
  const merged=new Map();
  for(const c of raw){
   const source=toJid(c.id);
   if(!validPeer(source))continue;
   const peer=canonical(source),timestamp=Number(c.updated)||0,unread=Number(c.unread)||0;
   const old=merged.get(peer);
   if(old){old.timestamp=Math.max(old.timestamp,timestamp);old.unread=Math.max(old.unread,unread);}
   else merged.set(peer,{peer,timestamp,unread,group:peer.endsWith('@g.us'),name:null,preview:null,ownPreview:false});
  }
  const entries=[...merged.values()];
  for(const entry of entries){
   const p=entry.peer,aliases=own.length>1&&ownSet.has(p)
    ?[...new Set([p,...own])]
    :[...new Set([p,...(phoneToLids.get(p)||[])])];
   entry.aliases=aliases;
   if(db.isSelfChat(p)){
    const filter=this.selfFilter(db,p);
    const rawMessage=this.lastMessage(account,db,aliases,filter);
    const d=rawMessage?describe(rawMessage):null;
    entry.preview=d&&d.type!=='system'&&!d.ephemeral&&!d.viewOnce
     ?(d.body||previews[d.type]||''):'';
    entry.lastFromMe=!!rawMessage?.key?.fromMe;
    entry.timestamp=rawMessage&&d?.type!=='system'?Number(rawMessage.messageTimestamp)||0:0;
    entry.ownPreview=true;
   }
  }
  entries.sort((a,b)=>b.timestamp-a.timestamp);
  const result={expires:now+this.ttl,entries};
  // Small bounded in-memory cache; authorization is still checked per request.
  this.cache.delete(account);
  this.cache.set(account,result);
  while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);
  return result;
 }
 // Only the own chat needs the existing special projection/visibility filter.
 selfFilter(db,peer){return this.visibleFilter?.(db,peer)||{sql:' AND 1=0',params:[]};}
 lastMessage(account,db,peers,filter={sql:'',params:[]}){
  const query="SELECT id FROM baileys_data WHERE account=? AND kind='message' AND peer IN ("+
   peers.map(()=>'?').join(',')+")"+(filter.sql||'')+" ORDER BY timestamp DESC,rowid DESC LIMIT 1";
  const row=this.store.db.prepare(query).get(account,...peers,...(filter.params||[]));
  return row?db.projectSelfMessage(db.get('message',row.id)):null;
 }
 name(account,entry){
  if(entry.name===null)entry.name=this.profiles.name(account,entry.peer,entry.aliases);
  return entry.name;
 }
 page(account,db,{offset=0,query=''}={}){
   const snapshot=this.snapshot(account,db);
   const q=String(query||'').toLowerCase();
   const rows=q?snapshot.entries.filter(c=>
    (this.name(account,c)+' '+c.peer).toLowerCase().includes(q)
   ):snapshot.entries;
   const page=rows.slice(offset,offset+this.pageSize);
   const items=page.map(c=>{
    const name=this.name(account,c);
    const result={
     peer:c.peer,aliases:[...c.aliases],name,phone:isPhone(c.peer)?'+'+c.peer.split('@')[0]:null,
     avatar:this.profiles.url(account,c.peer),timestamp:c.timestamp,
     unread:c.unread,group:c.group
    };
    if(c.ownPreview){
     result.preview=c.preview||'';
     result.lastFromMe=!!c.lastFromMe;
    }else{
     const raw=this.lastMessage(account,db,c.aliases),d=raw?describe(raw):null;
     result.preview=d&&!d.ephemeral&&!d.viewOnce?(d.body||previews[d.type]||''):'';
     result.lastFromMe=!!raw?.key?.fromMe;
     if(raw)result.timestamp=Math.max(result.timestamp,Number(raw.messageTimestamp)||0);
    }
    return result;
   });
   return {items,next:rows.length>offset+this.pageSize?offset+this.pageSize:null};
 }
}
