import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {createMiniAppBridge} from '../src/miniapp-bridge.js';
import {publicWaCopyDefaults} from '../src/public-wa-copy.js';

const origin='https://whatsapp-cubamax-miniapp.onrender.com';
const token='123456789:MINIAPP_TEST_TOKEN';
function sign(actor,secret=token){
  const data=new URLSearchParams({
    auth_date:String(Math.floor(Date.now()/1000)),
    user:JSON.stringify({id:actor,first_name:'Prueba'})
  });
  const check=[...data.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([name,value])=>name+'='+value).join('\n');
  const key=createHmac('sha256','WebAppData').update(secret).digest();
  data.set('hash',createHmac('sha256',key).update(check).digest('hex'));
  return data.toString();
}
async function request(handler,payload,source=origin,method='POST'){
  const req=Readable.from([Buffer.from(JSON.stringify(payload))]);
  req.method=method;
  req.headers={origin:source};
  const res={
    status:0,headers:{},body:'',
    writeHead(status,headers){this.status=status;this.headers=headers;},
    end(body){this.body=body||'';}
  };
  await handler(req,res);
  return {status:res.status,headers:res.headers,body:res.body?JSON.parse(res.body):null};
}
function fixture(){
  const records=[];
  const methods=[];
  const labels={...publicWaCopyDefaults,buttonCubamax:'🇨🇺 Cubamax desde editor',myLinksTitle:'Enlaces desde editor'};
  const wa={
    texts:()=>labels,
    url:code=>'https://securitywhat.app/'+encodeURIComponent(code),
    record:()=>null
  };
  const cm={
    url:code=>'https://cubamaxcom.online/'+encodeURIComponent(code),
    record:code=>records.find(x=>x.code===code)||null,
    create(actor,code){
      methods.push(['create',actor,code]);
      if(records.some(x=>x.code===code))throw Error('Ya existe.');
      const row={code,actor,link_id:records.length+1,id:records.length+1,enabled:1,created:Date.now()};
      records.push(row);return row;
    },
    ownedRef(actor,ref){
      const row=ref.startsWith('~')?records.find(x=>x.id===Number(ref.slice(1))):records.find(x=>x.code===ref);
      return row?.actor===actor?row:null;
    },
    accounts:()=>[],
    revoke(actor,code){
      methods.push(['revoke',actor,code]);
      const row=records.find(x=>x.actor===actor&&x.code===code);
      if(!row)throw Error('Enlace no disponible.');
      row.enabled=0;return true;
    }
  };
  const store={db:{prepare(sql){return {all(actor){
    if(sql.includes('FROM cm_public_links'))return records.filter(x=>x.actor===actor);
    return [];
  }};}}};
  const tg={
    config:{token},
    store,
    accounts:{dir:'/unused'},
    publicWa:{links:wa,cubamax:cm},
    autoPublicAccess:null,
    webPanel:{role:()=>null},
    admins:()=>new Set(),
    associatedUsers:{isBanned:()=>false}
  };
  return {handler:createMiniAppBridge(tg),records,methods};
}

test('Mini App requires a signed Telegram identity, blocks unknown origins',async()=>{
  const {handler}=fixture();
  assert.equal((await request(handler,{initData:sign('12345')},'https://malicious.invalid')).status,403);
  assert.equal((await request(handler,{initData:'fake',action:'start'})).status,400);
  assert.equal((await request(handler,{initData:sign('12345','wrong-token'),action:'start'})).status,400);
  const valid=await request(handler,{initData:sign('12345'),action:'start'});
  assert.equal(valid.status,200);
  assert.equal(valid.body.ok,true);
  assert.equal(valid.body.labels.cubamax,'🇨🇺 Cubamax desde editor');
  assert.equal(valid.body.labels.myLinksHeading,'Enlaces desde editor');
  assert.ok(valid.body.messages[0].buttons.some(b=>b.action==='pwa:cubamax'));
});

test('Mini App delegates create and revoke to the original Cubamax methods',async()=>{
  const {handler,records,methods}=fixture(),initData=sign('54321');
  const start=await request(handler,{initData,action:'callback',value:'pwa:cubamax'});
  assert.equal(start.status,200);
  assert.equal(start.body.pending,'publicCmCode');
  const created=await request(handler,{initData,action:'input',value:'ejemplo2026'});
  assert.equal(created.status,200);
  assert.equal(created.body.pending,null);
  assert.deepEqual(methods[0],['create','54321','ejemplo2026']);
  assert.equal(created.body.links.length,1);
  assert.equal(created.body.links[0].url,'https://cubamaxcom.online/ejemplo2026');
  assert.match(created.body.messages[0].text,/cubamaxcom\.online\/ejemplo2026/);
  const prompt=await request(handler,{initData,action:'callback',value:'pwa:cm-revoke:~1'});
  assert.equal(prompt.status,200);
  assert.ok(prompt.body.messages[0].buttons.some(b=>b.action==='pwa:cm-revoke-yes:~1'));
  const revoked=await request(handler,{initData,action:'callback',value:'pwa:cm-revoke-yes:~1'});
  assert.equal(revoked.status,200);
  assert.deepEqual(methods[1],['revoke','54321','ejemplo2026']);
  assert.equal(records[0].enabled,0);
  assert.equal(revoked.body.links[0].enabled,false);
  const other=await request(handler,{initData:sign('98765'),action:'callback',value:'pwa:cm-show:~1'});
  assert.equal(other.status,200);
  assert.equal(other.body.links.length,0);
  assert.match(other.body.messages[0].text,/no te pertenece|no est[aá] disponible|no disponible/i);
});

test('Mini App cannot submit a photo or arbitrary message without prior bot flow',async()=>{
  const {handler}=fixture(),initData=sign('55555');
  assert.equal((await request(handler,{initData,action:'input',value:'no'})).status,400);
  assert.equal((await request(handler,{initData,action:'photo',value:'data:image/png;base64,AA=='})).status,400);
  assert.equal((await request(handler,{initData,action:'callback',value:'op:panel'})).status,400);
});
