import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import WA from 'whatsapp-web.js';
import {readGallery} from '../src/media.js';
function environment(batches){
  const calls=[],window={WWebJS:{getChat:async()=>({id:'chat-native-id'}),keyString:id=>typeof id==='string'?id:id?.$1,getMessageModel:m=>m.serialize()},require:name=>{
    if(name==='WAWebDBMessageFindLocal')return {msgFindMedia:async args=>{calls.push(args);return batches.shift()??[];}};
    if(name==='WAWebCollections')return {Msg:{get:()=>null,modelClass:class{constructor(raw){assert.equal(raw.recvFresh,false);this.raw=raw;}serialize(){return this.raw;}}}};
    throw Error(name);
  }};
  const run=vm.runInNewContext(`(${readGallery.toString()})`,{window,Date,Set,Error});return {run,calls};
}
test('actual library downloader forwards declared MIME to WhatsApp download manager',async()=>{
  let received;
  const native={mediaData:{mediaStage:'RESOLVED'},type:'image',mimetype:'image/jpeg',size:3};
  const window={require:name=>{
    if(name==='WAWebCollections')return {Msg:{get:()=>native}};
    if(name==='WAWebDownloadManager')return {downloadManager:{downloadAndMaybeDecrypt:async args=>{received=args;return new Uint8Array([1,2,3]);}}};throw Error(name);
  },WWebJS:{arrayBufferToBase64Async:async()=> 'AQID'}};
  const client={pupPage:{evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(arg)`,{window,arg,AbortController})}};
  const message=new WA.Message(client,{id:{_serialized:'image-1'},type:'image',mediaKey:'key',directPath:'/media',mimetype:'image/jpeg'});
  const media=await message.downloadMedia();assert.equal(received.mimetype,'image/jpeg');assert.equal(media.data,'AQID');
});


test('gallery uses per-chat query, never global allMedia, and returns only the media index segment',async()=>{
  const image={id:{$1:'image',remote:'chat-native-id'},t:1,type:'image'};
  const video={id:{$1:'video',remote:'chat-native-id'},t:2,type:'video'};
  const {run,calls}=environment([{mediaCount:2,messages:[image,video,{type:'chat'}]}]);
  const result=await run('peer');assert.equal(calls.length,1);assert.equal(calls[0].mediaType,undefined);assert.equal(calls[0].chat,'chat-native-id');assert.equal(result.messages.length,2);assert.equal(result.complete,true);
});
test('gallery rejects records from another chat before download',async()=>{
  const {run}=environment([[{id:{$1:'wrong',remote:'other-chat'},type:'image',t:1}]]);await assert.rejects(run('peer'),/WRONG_CHAT/);
});
test('invalid gallery result fails rather than displaying zero',async()=>{
  const {run}=environment([{}]);await assert.rejects(run('peer'),/INVALID_RESULT/);
});
test('duplicate index records are counted once',async()=>{
  const row={id:{$1:'same',remote:'chat-native-id'},type:'image',t:1};const {run}=environment([[row,row]]);const result=await run('peer');assert.equal(result.messages.length,1);
});
test('hitting index safety ceiling is explicitly partial',async()=>{
  const rows=Array.from({length:20000},(_,i)=>({id:{$1:'id'+i,remote:'chat-native-id'},type:'image',t:i}));const {run}=environment([{mediaCount:20000,messages:rows}]);const result=await run('peer');assert.equal(result.complete,false);assert.equal(result.messages.length,20000);
});
