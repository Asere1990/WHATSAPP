import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/studio-render.js',import.meta.url),'utf8');
function setup(editing=true,kind='text'){
 const make=()=>({style:{},dataset:{},children:[],events:{},classList:{add(){},remove(){}},append(n){this.children.push(n);},prepend(n){this.children.unshift(n);},replaceChildren(){this.children=[];},setAttribute(){},setPointerCapture(){},addEventListener(k,f){this.events[k]=f;},querySelectorAll(){return [];},getBoundingClientRect(){return {width:400,height:800};}});
 const window={},canvas=make(),selected=[],moves=[];
 vm.runInNewContext(script,{window,document:{createElement:make}});
 const element={id:'text1',kind,label:'Texto editable',x:10,y:10,w:50,h:10,size:16};
 window.StudioCanvas.render(canvas,{width:400,height:800,elements:[element]},{editing,select:id=>selected.push(id),move:e=>moves.push({...e})});
 const box=canvas.children[0],fire=(type,x=20,y=20)=>box.events[type]?.({clientX:x,clientY:y,pointerId:1,preventDefault(){}});
 return {box,selected,moves,element,fire,tap(){fire('pointerdown');fire('pointerup');}};
}
for(const kind of ['text','link','submit','field','username','password'])test(kind+' opens text properties only on double tap',()=>{const p=setup(true,kind);p.tap();assert.equal(p.selected.length,0);p.tap();assert.deepEqual(p.selected,['text1']);});
test('dragging still moves text but does not open its properties or count as a tap',()=>{const p=setup();p.tap();p.fire('pointerdown');p.fire('pointermove',60,60);p.fire('pointerup',60,60);assert.ok(p.element.x>10);assert.ok(p.moves.length);assert.equal(p.selected.length,0);p.tap();assert.equal(p.selected.length,0);});
test('cancelled gestures cannot trigger text editing',()=>{const p=setup();p.tap();p.fire('pointerdown');p.fire('pointercancel');p.tap();assert.equal(p.selected.length,0);});
test('image selection retains its existing behavior',()=>{const p=setup(true,'image');p.fire('pointerdown');assert.deepEqual(p.selected,['text1']);});
test('public and preview canvases never install editing gestures',()=>{const p=setup(false);p.tap();p.tap();assert.equal(p.selected.length,0);assert.deepEqual(p.box.events,{});});
