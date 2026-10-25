import {BaileysStore} from './baileys-store.js';
import {toJid,toPeer} from './baileys.js';
const usable=value=>typeof value==='string'&&value.trim()&&!/^(nombre no disponible|sin nombre|cuenta(?: de whatsapp)?|whatsapp|cuenta\s*[·•].*|\+?\d+)$/i.test(value.trim());
const safeUrl=value=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!/(^|\.)(whatsapp\.net|fbcdn\.net)$/i.test(url.hostname))throw Error('PROFILE_URL');return url;};
export class PanelProfiles{
 constructor(store,accounts,{fetchImage=fetch}={}){this.store=store;this.accounts=accounts;this.fetchImage=fetchImage;this.pending=new Map();this.stores=new Map();this.active=0;this.waiting=[];}
 database(id){if(!this.stores.has(id)){if(this.stores.size>=100)this.stores.delete(this.stores.keys().next().value);this.stores.set(id,new BaileysStore(this.store,id));}return this.stores.get(id);}
 name(id,peer){
  const a=this.store.account(id),db=this.database(id),jid=toJid(peer||a.phone+'@c.us'),self=db.peers(jid).includes(toJid(a.phone+'@c.us')),client=this.accounts.live.get(id)?.client,creds=self?db.authValue('creds','self'):null;
  const peers=new Set([...db.peers(jid),...(self?[toJid(creds?.me?.id||''),toJid(creds?.me?.lid||'')]:[])]),contacts=[...peers].map(p=>db.get('contact',p)).filter(Boolean),chats=[...peers].map(p=>db.get('chat',p)).filter(Boolean),profiles=[...peers].map(p=>this.store.profile(id,toPeer(p))).filter(Boolean);
  const names=self?[client?.info?.pushname,client?.socket?.user?.name,client?.socket?.user?.notify,client?.socket?.user?.verifiedName,creds?.me?.name,creds?.me?.notify,creds?.me?.verifiedName,...contacts.flatMap(c=>[c.notify,c.name,c.verifiedName])]:[...chats.map(c=>c.subject||c.name),...contacts.flatMap(c=>[c.name,c.notify,c.verifiedName])];
  let found=names.find(usable);
  if(!found&&self){const row=this.store.db.prepare("SELECT json_extract(value,'$.pushName') AS name FROM baileys_data WHERE account=? AND kind='message' AND json_extract(value,'$.key.fromMe')=1 AND length(json_extract(value,'$.pushName'))>0 ORDER BY timestamp DESC LIMIT 1").get(id);if(usable(row?.name))found=row.name;}
  if(!found)found=[...profiles.map(p=>p.name),...(self?[a.name]:[])].find(usable);
  return found?String(found).trim().slice(0,120):self?'WhatsApp · +'+a.phone:jid.split('@')[0];
 }
 url(id,peer){return '/api/panel/avatar?account='+encodeURIComponent(id)+(peer?'&peer='+encodeURIComponent(peer):'')+'&v='+Math.floor(Date.now()/900000);}
 known(id,peer){const a=this.store.account(id),db=this.database(id),jid=toJid(peer||a.phone+'@c.us'),peers=db.peers(jid);if(peers.includes(toJid(a.phone+'@c.us')))return true;return peers.some(p=>!!db.get('chat',p)||!!db.get('contact',p));}
 async avatar(id,peer){
  const a=this.store.account(id),db=this.database(id),jid=db.canonical(toJid(peer||a.phone+'@c.us')),cached=db.get('panel-avatar',jid),live=this.accounts.live.get(id);
  if(cached&&(cached.next>Date.now()||!live?.ready))return cached.data?Buffer.from(cached.data,'base64'):null;
  if(!live?.ready||!live.client?.getProfilePicUrl)return null;
  const key=id+':'+jid;if(this.pending.has(key))return this.pending.get(key);
  if(this.waiting.length>=20)return cached?.data?Buffer.from(cached.data,'base64'):null;
  const task=(async()=>{
   if(this.active>=2)await new Promise(resolve=>this.waiting.push(resolve));else this.active++;
   try{
    let timer,picture;try{picture=await Promise.race([live.client.getProfilePicUrl(toPeer(jid),{type:'preview'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PROFILE_TIMEOUT')),10000);timer.unref();})]);}finally{clearTimeout(timer);}let data=null;
    if(picture){let url=safeUrl(picture),response;for(let n=0;n<3;n++){response=await this.fetchImage(url,{signal:AbortSignal.timeout(10000),redirect:'manual'});if(response.status>=300&&response.status<400){url=safeUrl(new URL(response.headers.get('location'),url));continue;}break;}if(!response?.ok||!response.headers.get('content-type')?.startsWith('image/'))throw Error('PROFILE_IMAGE');const chunks=[];let length=0;for await(const c of response.body){length+=c.length;if(length>2*1024*1024)throw Error('PROFILE_SIZE');chunks.push(c);}const {default:sharp}=await import('sharp');data=await sharp(Buffer.concat(chunks),{limitInputPixels:16000000}).rotate().resize(96,96,{fit:'cover'}).jpeg({quality:80}).toBuffer();}
    db.put('panel-avatar',jid,{data:data?.toString('base64')||null,next:Date.now()+(data?900000:300000)});return data;
   }catch{db.put('panel-avatar',jid,{data:cached?.data||null,next:Date.now()+300000});return cached?.data?Buffer.from(cached.data,'base64'):null;}
   finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  })();this.pending.set(key,task);try{return await task;}finally{this.pending.delete(key);}
 }
}
