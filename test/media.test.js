import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import WA from 'whatsapp-web.js';
import {readGallery} from '../src/media.js';
function environment(batches){
  const calls=[],window={WWebJS:{getChat:async()=>({id:'chat-native-id'}),keyString:id=>id.$1,getMessageModel:m=>m.serialize()},require:name=>{
    if(name==='WAWebDBMessageFindLocal')return {msgFindMedia:async args=>{calls.push(args);return batches.shift()??[];}};
    if(name==='WAWebCollections')return {Msg:{get:()=>null,modelClass:class{constructor(raw){assert.equal(raw.recvFresh,false);this.raw=raw;}serialize(){return this.raw;}}}};
    throw Error(name);
  }};
  const run=vm.runInNewContext(`(${readGallery.toString()})`,{window,Date,Set,Error});return {run,calls};
}
test('gallery queries media index in pages with native cursor, never ordinary message history',async()=>{
  const older={id:{$1:'older'},t:1,type:'video'},newer={id:{$1:'newer'},t:2,type:'image'};
  const {run,calls}=environment([[newer],{messages:[older]},[]]);const result=await run('peer');
  assert.equal(result.complete,true);assert.equal(result.messages.length,2);assert.equal(calls[0].mediaType,'allMedia');assert.equal(calls[0].chat,'chat-native-id');assert.equal(calls[1].anchor,newer.id);assert.equal(calls[2].anchor,older.id);
});
test('repeated index page is deduplicated and explicitly partial',async()=>{
  const row={id:{$1:'same'},t:1};const {run}=environment([[row],[row]]);const result=await run('peer');assert.equal(result.complete,false);assert.equal(result.messages.length,1);
});
test('invalid gallery result fails rather than displaying zero files',async()=>{
  const {run}=environment([{}]);await assert.rejects(run('peer'),/INVALID_RESULT/);
});
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
