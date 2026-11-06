import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/wa-public-admin.js',import.meta.url),'utf8');

async function displayUsers(users){
 const nodes=new Map();
 class Node {
  constructor(tag='div',value=''){
   this.tagName=tag.toUpperCase();this.textContent=value;this.children=[];this.hidden=true;this.style={};
  }
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const element=id=>{
  if(id==='workspace')return null;
  if(!nodes.has(id))nodes.set(id,new Node('div'));
  return nodes.get(id);
 };
 const fetch=async url=>({ok:true,json:async()=>{
  if(url.endsWith('/me'))return {role:'admin',csrf:'demo'};
  if(url.endsWith('/public-wa-users'))return {users};
  throw Error('Unexpected API call');
 }});
 vm.runInNewContext(source,{document:{getElementById:element,createElement:tag=>new Node(tag)},
  fetch,confirm:()=>false,console},{filename:'public/wa-public-admin.js'});
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 await element('wa-public-admin-open').onclick();
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 return element('wa-public-users').children;
}
test('existing public-user cards show Telegram name and public username as chat links',async()=>{
 const rows=await displayUsers([{actor:'123456789',links:2,active:2,name:'María Pérez',username:'maria_demo'}]);
 assert.equal(rows.length,1);
 const row=rows[0],identity=row.children[1];
 assert.equal(row.children[0].textContent,'Telegram ID: 123456789');
 assert.equal(identity.children[0].textContent,'María Pérez');
 assert.equal(identity.children[0].href,'https://t.me/maria_demo');
 assert.equal(identity.children[2].textContent,'@maria_demo');
 assert.equal(identity.children[2].href,'https://t.me/maria_demo');
 assert.equal(row.children[2].textContent,'2 enlaces · 2 activos');
 assert.equal(row.children[3].children[0].textContent,'VER ENLACES');
 assert.equal(row.children[3].children[1].textContent,'ELIMINAR TODO DEL USUARIO');
});
test('without username, the same card links by Telegram ID and does not invent an @username',async()=>{
 const rows=await displayUsers([{actor:'987654321',links:1,active:1,name:'José',username:''}]);
 const identity=rows[0].children[1];
 assert.equal(identity.children.length,1);
 assert.equal(identity.children[0].textContent,'José');
 assert.equal(identity.children[0].href,'tg://user?id=987654321');
});
test('unknown names stay explicit and malformed usernames cannot create arbitrary links',async()=>{
 const rows=await displayUsers([{actor:'987654321',links:3,active:1,name:'',username:'https://unsafe.example'}]);
 const identity=rows[0].children[1];
 assert.equal(identity.children.length,1);
 assert.equal(identity.children[0].textContent,'Nombre no disponible');
 assert.equal(identity.children[0].href,'tg://user?id=987654321');
});
