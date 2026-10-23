import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/cubamax-headline.js',import.meta.url),'utf8');
function setup(loaded=true){
 class El{constructor(){this.events={};this.children=[];this.attrs={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}set className(v){this.classes=new Set(v.split(' '));}get className(){return [...this.classes].join(' ');}addEventListener(k,f){this.events[k]=f;}setAttribute(k,v){this.attrs[k]=v;}append(e){this.children.push(e);}appendChild(e){this.append(e);}querySelector(){return this===stage?intro:primaryImage;}}
 const primaryImage=new El(),intro=new El(),carousel=new El(),stage=new El();primaryImage.complete=loaded;primaryImage.naturalWidth=loaded?1200:0;primaryImage.src='/cubamax-services/shein.webp';intro.children.push(primaryImage);intro.className='headline-slide headline-intro is-active';stage.children.push(intro);
 const document={hidden:false,events:{},getElementById:id=>id==='headline-carousel'?carousel:stage,createElement:()=>new El(),addEventListener(k,f){this.events[k]=f;}};
 let timer;const motion={matches:false,addEventListener(){}};
 vm.runInNewContext(source,{document,matchMedia:()=>motion,setTimeout:(fn,delay)=>(timer={fn,delay}),clearTimeout:()=>{timer=null;}});
 return {carousel,stage,document,motion,get timer(){return timer;},intro,primaryImage};
}
test('models photo is first for three seconds, followed by contact and group for three',()=>{
 const s=setup();assert.equal(s.stage.children.length,8);assert.equal(s.stage.children[0],s.intro);assert.equal(s.timer.delay,3000);assert.match(s.primaryImage.src,/shein/);assert.match(s.stage.children[1].children[0].src,/contacto/);
 const images=s.stage.children.slice(1).map(a=>a.children[0]);assert.deepEqual(images.map(i=>i.src),['/cubamax-promos/contacto.webp','/cubamax-promos/grupo.webp','/cubamax-services/remesas.webp','/cubamax-services/recargas.webp','/cubamax-services/supercombo.webp','/cubamax-promos/ecoflow.webp','/cubamax-promos/equipo.webp']);for(const img of images){assert.match(img.src,/^\/cubamax-(promos|services)\/[a-z]+\.webp$/);img.events.load();}
 s.timer.fn();assert.equal(s.timer.delay,3000);assert.equal(s.intro.attrs['aria-hidden'],'true');assert.ok(s.stage.children[1].classes.has('is-active'));
 for(let i=0;i<7;i++)s.timer.fn();assert.ok(s.intro.classes.has('is-active'));assert.equal(s.timer.delay,3000);
});
test('unloaded photos never replace intro, reduced motion stops autoplay and swipe keeps vertical scroll',()=>{
 const s=setup();s.timer.fn();assert.ok(s.intro.classes.has('is-active'));assert.equal(s.timer.delay,3000);
 s.stage.children[1].children[0].events.load();s.carousel.events.pointerdown({pointerId:1,clientX:100,clientY:100});assert.equal(s.timer,null);
 s.carousel.events.pointerup({pointerId:1,clientX:20,clientY:105});assert.ok(s.stage.children[1].classes.has('is-active'));
 s.document.hidden=true;s.document.events.visibilitychange();assert.equal(s.timer,null);
 s.document.hidden=false;s.motion.matches=true;s.document.events.visibilitychange();assert.equal(s.timer,null);
 s.carousel.events.keydown({key:'ArrowLeft',preventDefault(){}});assert.ok(s.intro.classes.has('is-active'));assert.equal(s.timer,null);
});

test('primary photo receives its full three seconds only after it loads',()=>{
 const s=setup(false);assert.equal(s.timer,null);s.stage.children[1].children[0].events.load();assert.ok(s.intro.classes.has('is-active'));assert.equal(s.timer,null);s.primaryImage.events.load();assert.equal(s.timer.delay,3000);
});
