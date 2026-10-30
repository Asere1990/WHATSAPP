import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelFocus} from '../src/panel-focus.js';

test('focused account receives priority, switching accounts releases the previous one',()=>{
 let now=1000;const calls=[],clients=new Map();
 for(const id of ['a','b'])clients.set(id,{setPanelFocus:(peer,active,when)=>calls.push({id,peer,active,when})});
 const focus=new PanelFocus({live:new Map([...clients].map(([id,client])=>[id,{client}]))},{now:()=>now,ttl:60000});
 focus.update('session-one','actor-one','a',null);
 assert.deepEqual(calls.at(-1),{id:'a',peer:null,active:true,when:now});
 now+=1500;focus.update('session-one','actor-one','a','123@s.whatsapp.net');
 assert.deepEqual(calls.at(-1),{id:'a',peer:'123@s.whatsapp.net',active:true,when:now});
 now+=1000;focus.update('session-one','actor-one','b','456@s.whatsapp.net');
 assert.deepEqual(calls.slice(-2).map(x=>[x.id,x.active]),[['a',false],['b',true]]);
 focus.update('session-one','actor-one',null);
 assert.deepEqual(calls.at(-1),{id:'b',peer:null,active:false,when:now});
 assert.equal(focus.sessions.size,0);
});
test('other authorized viewer keeps an account focused when first viewer leaves',()=>{
 let now=100,events=[];const account='abcd';
 const focus=new PanelFocus({live:new Map([[account,{client:{setPanelFocus:(peer,active)=>events.push({peer,active})}}]])},{now:()=>now});
 focus.update('tab-one','actor-one',account,'111@s.whatsapp.net');
 now+=100;focus.update('tab-two','actor-two',account,'222@s.whatsapp.net');
 focus.update('tab-one','actor-one',null);
 assert.deepEqual(events.at(-1),{peer:'222@s.whatsapp.net',active:true});
 focus.update('tab-two','actor-two',null);
 assert.deepEqual(events.at(-1),{peer:null,active:false});
});
test('stale focus expires without tracking a browser after the panel closes',()=>{
 let now=500;const calls=[];
 const account='abcd',focus=new PanelFocus({live:new Map([[account,{client:{setPanelFocus:(peer,active)=>calls.push({peer,active})}}]])},{now:()=>now,ttl:60000});
 focus.update('old','actor',account,'111@s.whatsapp.net');
 now+=60001;focus.update('new','actor',account,null);
 assert.equal(focus.sessions.has('old'),false);
 assert.equal(focus.sessions.size,1);
 assert.deepEqual(calls.at(-1),{peer:null,active:true});
 focus.update('new','actor',null);
 assert.equal(focus.sessions.size,0);
});
