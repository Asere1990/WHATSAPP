import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{LoadUtils}=require('whatsapp-web.js/src/util/Injected/Utils.js'),{patch}=require('../scripts/patch-whatsapp.cjs');
function environment(chats=[],messages=new Map()){
  const seen=[],window={require:name=>{
    if(name==='WAWebCollections')return {Chat:{getModelsArray:()=>chats},Msg:{get:key=>{assert.equal(typeof key,'string');seen.push(key);return messages.get(key);},getMessagesById:async keys=>({messages:keys.map(k=>messages.get(k)).filter(Boolean)})}};
    if(name==='WALinkify')return {findLinks:()=>[]};throw Error('Unexpected module: '+name);
  }};
  vm.runInNewContext(`(${LoadUtils.toString()})()`,{window,console,Blob,File,URL,atob,btoa});return {api:window.WWebJS,seen};
}
const chat=(id,last)=>({id,formattedTitle:'Prueba',mute:{expiration:0},lastReceivedKey:last,serialize:()=>({id,msgs:last?[1]:[],archive:false,unreadCount:1,t:123})});
test('real injected getChats supports new $1 chat and message keys without undefined lookups',async()=>{
  const contact={$1:'12025550124@lid'},key={$1:'false_12025550124@lid_ABC'},rawMessage={serialize:()=>({id:{...key,remote:contact},from:contact,to:{$1:'12025550123@c.us'},body:'hola',type:'chat'})};
  const {api,seen}=environment([chat(contact,key)],new Map([[key.$1,rawMessage]]));
  const rows=await api.getChats();assert.equal(rows.length,1);assert.equal(rows[0].id._serialized,contact.$1);assert.equal(rows[0].lastMessage.id._serialized,key.$1);
  assert.equal(rows[0].lastMessage.id.remote,contact.$1);assert.equal(rows[0].lastMessage.from,contact.$1);assert.equal(rows[0].lastMessage.to,'12025550123@c.us');assert.deepEqual(seen,[key.$1]);
});
test('old _serialized IDs still work and take precedence over $1',async()=>{
  const id={_serialized:'12025550124@c.us',$1:'unused'},key={_serialized:'old-message-key',$1:'unused'},raw={serialize:()=>({id:{...key,remote:id},body:'hola'})};
  const {api}=environment([chat(id,key)],new Map([[key._serialized,raw]]));const result=await api.getChats();assert.equal(result[0].id._serialized,id._serialized);assert.equal(result[0].lastMessage.id._serialized,key._serialized);
});
test('missing last message key does not issue an IndexedDB lookup with undefined',async()=>{
  const c=chat({$1:'12025550124@c.us'},{}),{api,seen}=environment([c]);const rows=await api.getChats();assert.equal(rows.length,1);assert.equal(rows[0].lastMessage,null);assert.equal(seen.length,0);
});
test('one unreadable chat is isolated and explicitly counted, not hidden as a complete result',async()=>{
  const bad={serialize:()=>{throw Error('r');}},good=chat({$1:'12025550124@c.us'}),{api}=environment([bad,good]);
  const rows=await api.getChats();assert.equal(rows.length,1);assert.equal(api.chatReadFailures,1);
});
test('compatibility installer is idempotent and rejects unexpected dependency source',()=>{
  const fs=require('node:fs'),source=fs.readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils.js'),'utf8');
  assert.equal(patch(source),source);assert.throws(()=>patch('unreviewed source'),/unexpected/);
});
