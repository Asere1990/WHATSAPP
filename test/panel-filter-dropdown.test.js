import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
const panel=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/panel.css',import.meta.url),'utf8');

test('a visible search-row arrow controls a collapsed country and media filter panel',()=>{
 assert.match(html,/<button id="chat-filter-toggle"[^>]*aria-controls="private-chat-filters"[^>]*aria-expanded="false"/);
 assert.match(html,/<div id="private-chat-filters" class="chat-filter-grid" hidden>/);
 assert.ok(html.indexOf('id="chat-filter-toggle"')<html.indexOf('id="private-chat-filters"'));
 assert.match(html,/id="country-search"/);
 assert.match(html,/id="media-sort"/);
 assert.match(styles,/\.search-box \.chat-filter-toggle/);
});
test('button changes filter visibility, accessibility state and can close again without changing the selected filters',()=>{
 const start=panel.indexOf(' function setChatFiltersExpanded(expanded){');
 const end=panel.indexOf(' function accountHeader(){',start);
 assert.ok(start>=0&&end>start);
 const source=panel.slice(start,end);
 const filters={hidden:true},attributes={},classes=new Set();
 const toggle={title:'',setAttribute:(key,value)=>{attributes[key]=value;},classList:{toggle:(key,on)=>{if(on)classes.add(key);else classes.delete(key);}}};
 const country={value:'Cuba'},sort={value:'photos'};
 const $=id=>({'private-chat-filters':filters,'chat-filter-toggle':toggle,'country-search':country,'media-sort':sort})[id];
 const controls=new Function('$',source+'\nreturn {setChatFiltersExpanded,markActiveChatFilters}')( $ );
 controls.setChatFiltersExpanded(true);
 assert.equal(filters.hidden,false);
 assert.equal(attributes['aria-expanded'],'true');
 assert.equal(attributes['aria-label'],'Ocultar filtros de chats');
 controls.markActiveChatFilters();
 assert.equal(classes.has('has-active-filters'),true);
 controls.setChatFiltersExpanded(false);
 assert.equal(filters.hidden,true);
 assert.equal(attributes['aria-expanded'],'false');
 assert.equal(country.value,'Cuba');
 assert.equal(sort.value,'photos');
});
test('the search arrow is not hidden by the account corporate flag and existing archive handling remains scoped',()=>{
 assert.match(panel,/state\.account=account;setChatFiltersExpanded\(false\);\$\('private-chat-folders'\)\.hidden=account\.privateOnly===false/);
 assert.match(panel,/\$\('chat-filter-toggle'\)\.onclick=\(\)=>setChatFiltersExpanded\(\$\('private-chat-filters'\)\.hidden\)/);
 assert.match(html,/id="private-chat-folders"/);
 assert.ok(!html.includes('data-folder="restricted"'));
});
