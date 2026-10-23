import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readAccountPhoto} from '../src/profile.js';
function runtime({bridge,thumb,fetcher}){
 const raw={native:true},calls=[];
 const context={AbortSignal,fetch:fetcher,FileReader:class{readAsDataURL(blob){this.result='data:image/jpeg;base64,YWJj';this.onloadend();}},window:{WWebJS:{getChat:async(peer,opts)=>{calls.push(opts);return opts.getAsModel===false?raw:{serialized:true};},getProfilePicThumbToBase64:thumb||(async()=>null)},require:name=>name==='WAWebWidFactory'?{createWid:peer=>({peer})}:{requestProfilePicFromServer:chat=>bridge(chat,raw)}}};
 return {run:()=>vm.runInNewContext(`(${readAccountPhoto.toString()})('13215121897@c.us')`,context),calls};
}
test('profile bridge receives native chat and downloads photo inside authorized browser session',async()=>{
 const {run,calls}=runtime({bridge:async(chat,raw)=>{assert.equal(chat,raw);return {eurl:'https://pps.whatsapp.net/profile'};},fetcher:async()=>({ok:true,blob:async()=>({type:'image/jpeg',size:3})})});
 const result=await run();assert.equal(result.source,'profile');assert.equal(result.data,'YWJj');assert.equal(calls[0].getAsModel,false);
});
test('session thumbnail recovers profile when full photo request fails',async()=>{
 const {run}=runtime({bridge:async()=>{throw Error('private details must not be returned');},thumb:async()=> 'YWJj'});
 const result=await run();assert.equal(result.source,'thumbnail');assert.equal(result.data,'YWJj');assert.deepEqual(Array.from(result.attempts),['PROFILE_Error']);
});
test('unavailable photo reports both read stages without inventing an image',async()=>{
 const {run}=runtime({bridge:async()=>null});const result=await run();assert.equal(result.data,null);assert.deepEqual(Array.from(result.attempts),['PROFILE_EMPTY','THUMB_EMPTY']);
});
