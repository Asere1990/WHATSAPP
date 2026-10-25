import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {pageCatalog} from '../src/page-editor.js';
import {publicSnapshot,renderPublicContent} from '../src/public-content.js';
test('initial HTML contains current images and literal text without waiting for browser APIs',t=>{
 const dir=mkdtempSync(tmpdir()+'/public-html-'),store=new Store(dir);t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const id=Object.keys(pageCatalog.cm).find(k=>pageCatalog.cm[k].text==='/cubamax-promos/ecoflow.webp'),asset='/portal-media/'+'a'.repeat(64)+'.jpg';
 store.setConfig('page_cm',JSON.stringify({[id]:asset}));store.setConfig('cubamax_content',JSON.stringify({description:'Actual <texto> & seguro',previewTitle:'Mi página'}));
 const snapshot=publicSnapshot(store,'cm'),html=renderPublicContent(readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8'),snapshot,'test-build');
 assert.match(html,new RegExp('src="'+asset+'"'));assert.doesNotMatch(html,/<img[^>]*src="\/cubamax-promos\/ecoflow.webp"/);
 assert.ok(html.includes('Actual &lt;texto&gt; &amp; seguro'));assert.ok(html.indexOf('src="/public-content.js')<html.indexOf('src="/app.js'));
 assert.match(html,/cubamax.css\?v=test-build/);assert.ok(html.includes('id="service-continue"'));assert.ok(html.includes('Qué acceso autorizas'));
 const old=snapshot.revision;store.setConfig('cubamax_content',JSON.stringify({description:'Nuevo'}));assert.notEqual(publicSnapshot(store,'cm').revision,old);
 store.setConfig('cubamax_content',JSON.stringify({description:'</script><script>alert(1)</script>'}));const injected=renderPublicContent('<head></head><body></body>',publicSnapshot(store,'cm'),'build');assert.ok(!injected.includes('</script><script>alert(1)'));
});
test('public refresh retries failures, updates revisions once and keeps current content while offline',async()=>{
 const vm=await import('node:vm'),initial={site:'cm',revision:'old',page:[]},next={site:'cm',revision:'new',page:[]},events={},notifications=[];let interval,offline=false;
 const window={addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:event=>notifications.push(event)},document={hidden:false,getElementById:()=>({textContent:JSON.stringify(initial)}),addEventListener:(name,fn)=>events[name]=fn};
 const context=vm.createContext({window,document,AbortController,setTimeout,clearTimeout,setInterval:fn=>interval=fn,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},fetch:async()=>{if(offline)throw Error('offline');return {ok:true,json:async()=>next};}});
 vm.runInContext(readFileSync(new URL('../public/public-content.js',import.meta.url),'utf8'),context);
 offline=true;await interval();assert.equal(window.currentPublicContent.revision,'old');assert.equal(notifications.length,0);
 offline=false;await interval();assert.equal(window.currentPublicContent.revision,'new');assert.equal(notifications.length,1);await events.pageshow();assert.equal(notifications.length,1);
});
