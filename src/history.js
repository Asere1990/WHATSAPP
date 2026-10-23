import { escapeHTML, personLink } from './identity.js';
export function historyPages(messages,owner,contact){
  const pages=[];let page={text:'',media:[]};
  const flush=()=>{if(page.text)pages.push(page);page={text:'',media:[]};};
  messages.forEach((m,index)=>{
    const who=m.fromMe?owner:contact,when=new Date(m.timestamp*1000).toLocaleString('es',{timeZone:'America/New_York'});
    const label={ptt:'🎤 Nota de voz',audio:'🎵 Audio',image:'🖼 Foto',video:'🎬 Video',document:'📎 Documento',sticker:'Sticker'}[m.type];
    const head=`${m.fromMe?'↗️':'↙️'} ${personLink(who)}\n${escapeHTML(when)} (Nueva York)\n`;
    let chunks=[''],length=0;
    for(const c of (m.body||label||'Mensaje sin texto')){
      const escaped=escapeHTML(c);if(length+escaped.length>2600){chunks.push('');length=0;}chunks[chunks.length-1]+=escaped;length+=escaped.length;
    }
    for(const chunk of chunks){const block=head+chunk+'\n\n';if(page.text.length+block.length>3600)flush();page.text+=block;}
    if(m.hasMedia&&!m.isEphemeral&&!m.rawData?.isViewOnce)page.media.push(index);
  });flush();return pages;
}
