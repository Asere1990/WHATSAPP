// A short-lived hint from the authorized panel. No messages, media or visitor
// activity are stored here; a closed/hidden panel loses priority automatically.
export class PanelFocus {
 constructor(accounts,{now=()=>Date.now(),ttl=60000}={}){this.accounts=accounts;this.now=now;this.ttl=ttl;this.sessions=new Map();}
 update(session,actor,account,peer=null){
  const key=String(session),prior=this.sessions.get(key),touched=new Set(prior?.account?[prior.account]:[]),time=this.now();
  for(const [other,entry]of this.sessions)if(entry.expires<=time){this.sessions.delete(other);touched.add(entry.account);}
  if(account){this.sessions.set(key,{actor:String(actor),account,peer:peer||null,expires:time+this.ttl,at:time});touched.add(account);}
  else this.sessions.delete(key);
  if(this.sessions.size>1000){const oldest=this.sessions.keys().next().value,t=this.sessions.get(oldest);this.sessions.delete(oldest);if(t)touched.add(t.account);}
  for(const id of touched)if(id)this.refresh(id,time);
 }
 refresh(account,time=this.now()){
  let selected=null;
  for(const entry of this.sessions.values())if(entry.account===account&&entry.expires>time&&(!selected||entry.at>=selected.at))selected=entry;
  const client=this.accounts.live?.get(account)?.client;
  client?.setPanelFocus?.(selected?.peer||null,!!selected,time);
 }
}
