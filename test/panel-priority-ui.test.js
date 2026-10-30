import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const controller=readFileSync(new URL('../src/panel.js',import.meta.url),'utf8');

test('only a visible selected account/chat sends a temporary priority hint',()=>{
 assert.match(panel,/document\.body\.dataset\.view==='thread'\?state\.chat\?\.peer/);
 assert.match(panel,/if\(!state\.me\)return Promise\.resolve\(\)/);
 assert.match(panel,/account=visible\?state\.account\?\.id/);
 assert.match(panel,/api\('focus',payload,5000\)/);
 assert.match(panel,/visibilitychange/);
 assert.match(panel,/reportFocus\(true\)/);
 assert.match(controller,/this\.account\(session\.actor,account\)/);
 assert.match(controller,/this\.focus\.update\(value,session\.actor,account,selected\)/);
});

test('the displayed chat/gallery refresh happens before expensive account and chat lists',()=>{
 const selected=panel.indexOf("if(state.chat&&document.body.dataset.view==='thread')await messages()");
 const chats=panel.indexOf("if(state.account&&document.body.dataset.view!=='accounts')await chats()");
 const accounts=panel.indexOf("await accounts();",selected);
 assert.ok(selected>0&&chats>selected&&accounts>chats);
 assert.match(panel,/if\(!state\.me\|\|document\.hidden\|\|refreshBusy\)return/);
 assert.match(panel,/refreshBusy=false/);
});
