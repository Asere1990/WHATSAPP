import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('WhatsApp header alignment remains stable after an editor save and keeps four independent slots',()=>{
 const css=read('public/name-layout.css');
 const editorCss=read('public/editor.css');
 const editor=read('public/editor.js');
 const header=read('public/index.html');
 for(const id of ['wa-brand-logo','wa-brand-name','wa-brand-description','wa-verified-badge'])
  assert.match(header,new RegExp('id="'+id+'"'));
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand\{[\s\S]*?display:grid/);
 assert.match(css,/\.brand \.brand-title\{display:contents\}/);
 for(const id of ['wa-brand-logo','wa-brand-name','wa-brand-description','wa-verified-badge'])
  assert.ok(css.includes('.brand #'+id+'{'),'Missing stable slot '+id);
 assert.match(editorCss,/body\[data-site="wa"\]\.mobile\.editing #canvas\{padding-right:0\}/);
 assert.match(editor,/document\.body\.dataset\.site=next\.site/);
 assert.match(editor,/Alinear cabecera/);
 const declarations=editor.match(/'placement:id:'\+id/g)||[];
 assert.ok(declarations.length>0);
});

test('old WhatsApp header positioning is ignored without clearing stored settings or changing other elements',()=>{
 const brand={id:'brand',children:[],style:{},closest:selector=>selector==='header .brand'?brand:null};
 const legacy={id:'logo',style:{},parentElement:brand,closest:selector=>selector==='header .brand'?brand:null};
 const name={id:'wa-brand-name',style:{},parentElement:brand,closest:selector=>selector==='header .brand'?brand:null};
 const outside={id:'other',style:{},closest:()=>null};
 const body={children:[brand,outside]};brand.parentElement=body;brand.children=[legacy,name];
 const elements={brand,logo:legacy,'wa-brand-name':name,other:outside};
 const document={body,documentElement:{},getElementById:id=>elements[id]||null,querySelectorAll:()=>[]};
 const layout={'id:logo':{x:50,y:20,scale:1.8},'id:wa-brand-name':{x:2,y:1,scale:1.2},'id:other':{x:3,y:0,scale:.8}};
 const window={currentPublicContent:{site:'wa',layout},addEventListener(){}};
 class MutationObserver{observe(){}}
 vm.runInNewContext(read('public/element-layout.js'),{document,window,MutationObserver});
 assert.equal(legacy.style.translate,undefined);
 assert.equal(name.style.translate,'2vw 1vw');
 assert.equal(outside.style.translate,'3vw 0vw');
 assert.equal(layout['id:logo'].x,50);
});


test('WhatsApp logo scales to the full title-and-description block; badge aligns with the final p',()=>{
 const css=read('public/name-layout.css');
 const html=read('public/index.html');
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand\{\s*display:grid;\s*grid-template-columns:52px minmax\(0,1fr\)/);
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand #wa-brand-logo\{[\s\S]*?width:52px;\s*height:52px/);
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand #wa-brand-logo img\{[\s\S]*?width:52px;\s*height:52px/);
 assert.match(css,/@media\(max-width:800px\)\{\s*body:not\(\.corporate-portal\)>header \.brand\{\s*grid-template-columns:43px/);
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand #wa-verified-badge\{[\s\S]*?align-self:end;\s*justify-self:start;\s*position:relative;\s*top:-\.05em/);
 assert.match(css,/body:not\(\.corporate-portal\)>header \.brand #wa-brand-logo \.mark\{[\s\S]*?width:52px;\s*height:52px/);
 assert.match(html,/<span id="wa-brand-name">WhatsApp<\/span>/);
 assert.match(html,/<svg id="wa-verified-badge"/);
 assert.match(css,/\.corporate-portal header \.corporate-brand>/);
});
