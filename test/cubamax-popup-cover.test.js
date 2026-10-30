import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../public/cubamax.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/cubamax.css',import.meta.url),'utf8');
const markup=readFileSync(new URL('../public/cubamax.html',import.meta.url),'utf8');
const standalone=script.slice(script.indexOf('function renderServicePopup(){'),script.indexOf('\nlet corporateAppearance'));
const services=['money','combo','packages','topup'];

function render(service,{media,layout='full'}={}){
 const map=new Map(),classes=new Map();
 const element=(id,props={})=>({
  id,textContent:'',hidden:false,...props,
  setAttribute(name,value){this[name]=value;},
  removeAttribute(name){delete this[name];},
  replaceWith(next){map.set(id,next);},
 });
 const popup=element('service-dialog',{classList:{toggle(name,on){classes.set(name,on);}}});
 map.set('service-dialog',popup);
 for(const id of ['selected-service-name','service-dialog-title','service-dialog-description','service-continue'])
  map.set(id,element(id));
 map.set('service-dialog-photo',element('service-dialog-photo',{tagName:'IMG',hidden:true}));
 const appearance={
  fields:Object.fromEntries(services.map(id=>[id+'PopupButton','Botón '+id])),
  extraMedia:{[service+'PopupPhoto']:media||'/portal-media/'+String(services.indexOf(service)+1).repeat(64)+'.jpg'},
  popupLayouts:{[service]:layout}
 };
 const context={
  document:{getElementById:id=>map.get(id),createElement:tag=>element('new',{tagName:tag.toUpperCase()})},
  corporateService:service,
  corporateServices:Object.fromEntries(services.map(id=>[id,'Servicio '+id])),
  corporatePopups:Object.fromEntries(services.map(id=>[id,{title:'Título '+id,description:'Descripción '+id}])),
  corporateAppearance:appearance
 };
 vm.runInNewContext(standalone+'\nrenderServicePopup();',context);
 return {map,classes,appearance};
}

test('four independent Cubamax popups show their own full-cover photo and preserve each service button',()=>{
 for(const id of services){
  const result=render(id),image=result.map.get('service-dialog-photo');
  assert.equal(result.classes.get('full-photo'),true);
  assert.equal(result.classes.get('cover-photo'),true);
  assert.ok(image.src.endsWith(String(services.indexOf(id)+1).repeat(64)+'.jpg'));
  assert.equal(result.map.get('service-continue').textContent,'Botón '+id);
  assert.equal(result.map.get('service-dialog-title').textContent,'Título '+id);
  assert.equal(result.map.get('service-dialog-description').textContent,'Descripción '+id);
  assert.equal(result.map.get('service-continue')['data-service-color'],id);
 }
});

test('no-image and standard modes retain the original non-cover layout; video keeps its player',()=>{
 const standard=render('money',{layout:'standard'});
 assert.equal(standard.classes.get('full-photo'),false);
 assert.equal(standard.classes.get('cover-photo'),false);
 const video=render('money',{media:'/portal-media/'+'a'.repeat(64)+'.mp4'});
 assert.equal(video.classes.get('full-photo'),true);
 assert.equal(video.classes.get('cover-photo'),false);
 assert.equal(video.map.get('service-dialog-photo').tagName,'VIDEO');
 assert.equal(video.map.get('service-dialog-photo').controls,true);
});

test('full-cover CSS fills the whole Cubamax service popup while displaying authorization and button above the photo',()=>{
 assert.match(styles,/\.corporate-portal #service-dialog\.full-photo\.cover-photo/);
 assert.match(styles,/#service-dialog\.full-photo\.cover-photo #service-dialog-photo\s*\{[^}]*position:absolute;[^}]*inset:0;[^}]*object-fit:cover;/);
 assert.match(styles,/#service-dialog\.full-photo\.cover-photo \.permission-notice\s*\{/);
 assert.match(styles,/#service-dialog\.full-photo\.cover-photo #service-continue\s*\{[^}]*z-index:3;/);
 assert.match(styles,/\.service-dialog-content::before\s*\{[^}]*linear-gradient/);
 assert.match(markup,/id="service-continue"/);
 assert.match(markup,/Qué acceso autorizas/);
 assert.match(script,/document\.getElementById\('service-continue'\)\.onclick=\(\)=>\{/);
});
