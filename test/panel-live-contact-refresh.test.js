import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const start=panel.indexOf(' const liveChatRows=new Map();');
const end=panel.indexOf(' // The rest of the directory',start);
assert.ok(start>=0&&end>start);
const source=panel.slice(start,end);

class Element{
 constructor(tag='div',className='',text=''){
  this.tag=tag;this.className=className;this.textContent=text;this.children=[];this.parent=null;this.dataset={};this.scrollTop=0;
 }
 append(...items){for(const child of items){child.parent=this;this.children.push(child);}}
 insertBefore(child,before){child.parent=this;const i=this.children.indexOf(before);if(i<0)this.children.push(child);else this.children.splice(i,0,child);}
 remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);this.parent=null;}}
 matches(selector){return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):this.tag===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 getBoundingClientRect(){return this.rect||{top:0,bottom:600};}
 replaceChildren(){throw Error('The live refresher must not replace the expanded directory');}
}
const make=(tag,cls,text)=>new Element(tag,cls,text);
function setup(){
 const list=new Element('div','chat-list');list.scrollTop=900;
 const search={value:''},heading={},detail={};
 const $=id=>({'chats':list,'search':search,'chat-name':heading,'chat-detail':detail})[id];
 const document={hidden:false,body:{dataset:{view:'chats'}}};
 const state={me:{role:'admin'},account:{id:'account-a',name:'Cuenta A'},chat:null};
 const loaded=new Set(),requests=new Set(),calls=[];
 let now=60000,handler=async()=>({items:[],next:null});
 class Clock extends Date{static now(){return now;}}
 const api=async path=>{calls.push(path);return handler(path);};
 const get=new Function('state','document','$','chatRequests','loadedChatPeers','node','avatarPhoto','api','Date',source+
  '\nreturn {updateChatRow,refreshLoadedChatDetails,resetChatDetails,liveChatRows,chatPreview};');
 const core=get(state,document,$,requests,loaded,make,()=>{},api,Clock);
 function add(chat,index=0){
  const row=make('button','chat-item'),copy=make('span','chat-copy'),avatar=make('span','avatar','X'),meta=make('span','chat-meta');
  row._chat=chat;row.dataset.peer=chat.peer;row.rect={top:index*80-5600,bottom:index*80-5520};
  copy.append(make('strong','',chat.name));
  if(chat.phone)copy.append(make('small','chat-phone',chat.phone));
  copy.append(make('small','chat-preview','old preview'));
  meta.append(make('time','','00:00'));
  row.append(avatar,copy,meta);list.append(row);
  core.liveChatRows.set(chat.peer,row);loaded.add(chat.peer);return row;
 }
 return {core,state,document,list,search,loaded,requests,calls,add,setHandler:fn=>{handler=fn;},advance:ms=>{now+=ms;}};
}
const basic=(peer,name='Nombre pendiente')=>({peer,name,phone:null,avatar:null,preview:'',lastFromMe:false,group:false,timestamp:100,unread:0});

test('refreshes names and phone numbers beyond 50 loaded rows without collapsing the list',async()=>{
 const f=setup();let target;
 for(let i=0;i<100;i++){const row=f.add(basic((500000+i)+'@lid'),i);if(i===70)target=row;}
 f.setHandler(async()=>({items:[{...basic('12025550129@s.whatsapp.net','Clara'),aliases:['500070@lid','12025550129@s.whatsapp.net'],phone:'+12025550129',preview:'Hola'}],next:100}));
 await f.core.refreshLoadedChatDetails();
 assert.equal(f.calls.length,1);
 assert.match(f.calls[0],/offset=50$/,'the visible page is prioritized');
 assert.equal(f.list.children.length,100);
 assert.equal(f.list.scrollTop,900);
 assert.equal(target.querySelector('strong').textContent,'Clara');
 assert.equal(target.querySelector('.chat-phone').textContent,'+12025550129');
 assert.equal(target.querySelector('.chat-preview').textContent,'Hola');
 assert.equal(target._chat.peer,'12025550129@s.whatsapp.net','clicks use the refreshed identity');
 assert.equal(f.loaded.has('500070@lid'),false);
 assert.equal(f.loaded.has('12025550129@s.whatsapp.net'),true);
});

test('merges duplicate number/LID rows only when the server supplies the alias relationship',()=>{
 const f=setup(),phone='12025550129@s.whatsapp.net',lid='777777@lid';
 f.add(basic(lid),0);f.add(basic(phone),1);f.add(basic('999999@lid'),2);
 f.core.updateChatRow({...basic(phone,'Clara'),aliases:[phone,lid],phone:'+12025550129'});
 assert.equal(f.list.children.length,2);
 assert.equal(f.loaded.size,2);
 assert.equal(f.core.liveChatRows.has(lid),false);
 assert.equal(f.core.liveChatRows.get(phone)._chat.name,'Clara');
 assert.equal(f.core.liveChatRows.get('999999@lid')._chat.name,'Nombre pendiente');
});

test('a numeric identifier is never presented as a sent message when no message text exists',()=>{
 const f=setup();
 assert.equal(f.core.chatPreview({...basic('777777@lid'),lastFromMe:true}),'Sin mensajes sincronizados');
 assert.equal(f.core.chatPreview({...basic('777777@lid'),lastFromMe:true,preview:'Hola'}),'Tú: Hola');
 assert.equal(f.core.chatPreview({...basic('777@g.us'),group:true}),'Grupo');
});

test('does not request metadata in a hidden page, another screen, or alongside an in-flight directory request',async()=>{
 const f=setup();f.add(basic('777777@lid'));
 f.document.hidden=true;await f.core.refreshLoadedChatDetails();
 f.document.hidden=false;f.document.body.dataset.view='thread';await f.core.refreshLoadedChatDetails();
 f.document.body.dataset.view='chats';f.requests.add('pending');await f.core.refreshLoadedChatDetails();
 assert.equal(f.calls.length,0);
 f.requests.clear();await f.core.refreshLoadedChatDetails();await f.core.refreshLoadedChatDetails();
 assert.equal(f.calls.length,1,'refresh cadence must be respected');
});

test('ignores replies from an earlier account or search after the UI context changes',async()=>{
 const f=setup(),row=f.add(basic('777777@lid'));
 let release;f.setHandler(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.core.refreshLoadedChatDetails();
 f.state.account={id:'account-b',name:'Cuenta B'};f.core.resetChatDetails();
 release({items:[{...basic('777777@lid','Do not show')}],next:null});await pending;
 assert.equal(row.querySelector('strong').textContent,'Nombre pendiente');
 assert.equal(f.requests.size,0);
});

test('429 responses back off while preserving the previous rows',async()=>{
 const f=setup();f.add(basic('777777@lid'));
 f.setHandler(async()=>{throw Object.assign(Error('Rate limit'),{status:429});});
 await f.core.refreshLoadedChatDetails();
 f.advance(30000);await f.core.refreshLoadedChatDetails();assert.equal(f.calls.length,1);
 f.advance(31000);await f.core.refreshLoadedChatDetails();assert.equal(f.calls.length,2);
 assert.equal(f.list.children.length,1);
 assert.equal(f.list.scrollTop,900);
});
