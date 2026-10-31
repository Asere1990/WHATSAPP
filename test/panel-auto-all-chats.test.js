import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const start=panel.indexOf(' let autoChatsTimer=null');
const end=panel.indexOf(' const node=(',start);
assert.ok(start>0&&end>start,'The existing panel auto-loader is present');
const code=panel.slice(start,end);

// Execute the actual browser scheduler in isolation with fake clock,
// selected-account state and requests. No WhatsApp connection is needed.
function setup(pageOffsets=[100,150,null]){
 const state={me:{role:'admin'},account:{id:'test-account'},chatsNext:50};
 const document={hidden:false,body:{dataset:{view:'chats'}}};
 const search={value:''},more={textContent:'Cargar más conversaciones'};
 const $=id=>id==='search'?search:more,chatRequests=new Set(),timers=new Map();
 let nextTimer=0,scheduler;const calls=[];
 const later=(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;};
 const cancel=id=>timers.delete(id);
 const chats=append=>{
  calls.push({append,id:state.account.id,q:search.value});
  state.chatsNext=pageOffsets.shift()??null;
  scheduler.resumeAutoChats();
  return Promise.resolve();
 };
 scheduler=new Function('state','document','$','chatRequests','chats','setTimeout','clearTimeout',
  code+'\nreturn {resumeAutoChats,pauseAutoChats};')(state,document,$,chatRequests,chats,later,cancel);
 const fire=()=>{const first=timers.entries().next().value;if(!first)throw Error('No scheduled page');timers.delete(first[0]);first[1].fn();return first[1].delay;};
 return {state,document,search,more,chatRequests,timers,calls,scheduler,fire};
}

test('loads every remaining page automatically, sequentially, and stops at the last page',()=>{
 const f=setup([100,150,null]);
 f.scheduler.resumeAutoChats();
 assert.equal(f.timers.size,1);
 assert.match(f.more.textContent,/Cargando las demás conversaciones/);
 assert.equal(f.fire(),1800);
 assert.deepEqual(f.calls.map(x=>x.append),[true]);
 assert.equal(f.state.chatsNext,100);
 assert.equal(f.timers.size,1);
 assert.equal(f.fire(),1800);
 assert.equal(f.state.chatsNext,150);
 assert.equal(f.fire(),1800);
 assert.equal(f.state.chatsNext,null);
 assert.equal(f.calls.length,3);
 assert.equal(f.timers.size,0,'finished lists never keep requesting pages');
});

test('does not overlap active chat requests, avoiding duplicate requests',()=>{
 const f=setup([null]);
 f.chatRequests.add('currently-loading');
 f.scheduler.resumeAutoChats();
 f.fire();
 assert.equal(f.calls.length,0);
 assert.equal(f.timers.size,1,'busy loader retries later instead of queuing');
 f.chatRequests.clear();
 f.fire();
 assert.equal(f.calls.length,1);
 assert.equal(f.timers.size,0);
});

test('pauses in a conversation or while hidden; resumes on returning to the list',()=>{
 const f=setup([null]);
 f.scheduler.resumeAutoChats();
 f.document.body.dataset.view='thread';
 f.fire();
 assert.equal(f.calls.length,0);
 f.document.body.dataset.view='chats';
 f.scheduler.resumeAutoChats(450);
 assert.equal(f.fire(),450);
 assert.equal(f.calls.length,1);
 const other=setup([null]);
 other.scheduler.resumeAutoChats();
 other.document.hidden=true;
 other.scheduler.pauseAutoChats();
 assert.equal(other.timers.size,0);
 assert.equal(other.more.textContent,'Cargar más conversaciones');
 other.document.hidden=false;
 other.scheduler.resumeAutoChats();
 other.fire();
 assert.equal(other.calls.length,1);
});

test('stale account and search timers cannot request another account or old query',()=>{
 const old=setup([null]);
 old.scheduler.resumeAutoChats();
 old.state.account={id:'another-account'};
 old.fire();
 assert.equal(old.calls.length,0);
 const changed=setup([null]);
 changed.scheduler.resumeAutoChats();
 changed.search.value='un nombre distinto';
 changed.fire();
 assert.equal(changed.calls.length,0);
 const paused=setup([null]);
 paused.scheduler.resumeAutoChats();
 paused.scheduler.pauseAutoChats();
 assert.equal(paused.timers.size,0);
});

test('all chats accumulate without duplicates and preserve existing manual fallback',()=>{
 assert.match(panel,/if\(loadedChatPeers\.has\(chat\.peer\)\)continue/);
 assert.match(panel,/loadedChatPeers\.add\(chat\.peer\)/);
 assert.match(panel,/if\(!append\)\{\$\('chats'\)\.replaceChildren\(\);loadedChatPeers\.clear\(\);\}/);
 assert.match(panel,/if\(state\.chatsNext!=null\)resumeAutoChats\(\)/);
 assert.match(panel,/\$\('more-chats'\)\.onclick=\(\)=>\{pauseAutoChats\(\);chats\(true\)/);
 assert.match(panel,/state\.chatsNext==null&&\$\('chats'\)\.querySelectorAll/);
 assert.match(panel,/if\(document\.hidden\)pauseAutoChats\(\)/);
 assert.match(panel,/resumeAutoChats\(450\)/);
 assert.match(panel,/const AUTO_CHAT_DELAY_MS=1800/);
});
