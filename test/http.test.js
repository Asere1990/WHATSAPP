import test from 'node:test';
import {get} from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { BaileysStore } from '../src/baileys-store.js';
test('HTTP access requires a valid invitation, enforces origin and never exposes config secrets',async t=>{
  const dir=mkdtempSync(`${tmpdir()}/wa-http-`),s=new Store(dir),invite=s.invite('12025550123','Titular');s.setConfig('telegram_offset','private');s.db.close();
  const port=20000+(process.pid%20000),url=`http://localhost:${port}`;
  const child=spawn(process.execPath,['src/main.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,PUBLIC_URL:url,TOKEN:'',ADMIN_IDS:'',ADMIN_CHAT_ID:''},stdio:'pipe'});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let n=0;n<100;n++){try{const r=await fetch(`${url}/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(ready,logs);
  const landing=await(await fetch(url)).text();assert.match(landing,/id="begin"[^>]*>CONECTAR CUENTA/);assert.doesNotMatch(landing,/Abre el enlace privado/);
  assert.match(landing,/id="another-account"/);assert.match(landing,/id="connected-account"/);assert.match(landing,/id="pairing-account"/);
  assert.match(landing,/id="country"/);assert.match(landing,/<form id="connect" autocomplete="off"/);
  assert.match(landing,/id="device-android"/);assert.match(landing,/id="device-iphone"/);
  for(const host of ['cubamaxcom.online','www.cubamaxcom.online']){
    const domainLanding=await new Promise((resolve,reject)=>get(url,{headers:{Host:host}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve(text));}).on('error',reject));
    assert.match(domainLanding,/<body class="corporate-portal">/);
    assert.equal(domainLanding,await(await fetch(`${url}/cubamax`)).text());
    assert.equal((await fetch(`${url}/api/register`,{method:'POST',headers:{Host:host,Origin:`https://${host}`},body:JSON.stringify({consent:false})})).status,400);
  }
  assert.equal((await fetch(`${url}/api/register`,{method:'POST',headers:{Origin:'https://cubamaxcom.online.evil.example'},body:'{}'})).status,403);
  const portal=await(await fetch(`${url}/api/cubamax`)).json();assert.equal(portal.slides.length,4);assert.equal(portal.fields.headline,'CUBAMAX presente.');assert.equal(portal.telegram_offset,undefined);
  for(const slide of portal.slides){const asset=await fetch(url+slide.asset);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/image\/webp/);}
  assert.equal((await fetch(`${url}/portal-media/not-an-image.svg`)).status,404);
  const guide=await(await fetch(`${url}/api/guides`)).json();assert.equal(guide.android.length,5);assert.equal(guide.iphone.length,5);
  const gif=await fetch(url+guide.iphone[0].asset);assert.equal(gif.status,200);assert.match(gif.headers.get('content-type'),/image\/gif/);assert.match(Buffer.from(await gif.arrayBuffer()).subarray(0,6).toString(),/^GIF8/);
  const image=await fetch(url+guide.android[0].asset);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/gif/);
  for(const step of guide.android){const asset=await fetch(url+step.asset);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/image\/gif/);assert.match(Buffer.from(await asset.arrayBuffer()).subarray(0,6).toString(),/^GIF8/);}
  assert.equal((await fetch(`${url}/guides/android-2026/step-6.gif`)).status,404);
  assert.equal((await fetch(`${url}/guide-media/unknown.html`)).status,404);
  assert.equal((await fetch(`${url}/api/register`,{method:'POST',headers:{Origin:url},body:JSON.stringify({phone:'+12025550128',consent:false})})).status,400);
  assert.equal((await fetch(`${url}/api/register`,{method:'POST',headers:{Origin:url},body:JSON.stringify({phone:'+12025550128',consent:true})})).status,503);
  assert.equal((await fetch(`${url}/api/register`,{method:'POST',headers:{Origin:'https://other.example'},body:JSON.stringify({phone:'+12025550128',consent:true})})).status,403);
  assert.equal((await fetch(`${url}/api/status`)).status,401);
  const branding=await(await fetch(`${url}/api/branding`)).json();assert.equal(branding.telegram_offset,undefined);
  const access=await fetch(`${url}/api/access`,{method:'POST',headers:{Origin:url},body:JSON.stringify({token:invite.secret})});assert.equal(access.status,200);
  const cookie=access.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  assert.equal((await fetch(`${url}/api/status`,{headers:{Cookie:cookie,'X-Portal':'cubamax-corporate'}})).status,401);
  const corporate=await(await fetch(`${url}/cubamax`)).text();assert.match(corporate,/TU AGENCIA DE CONFIANZA/);assert.equal((corporate.match(/data-service=/g)||[]).length,4);assert.match(corporate,/teléfono corporativo/);assert.match(corporate,/id="service-dialog"/);assert.match(corporate,/id="corporate-success"/);assert.match(corporate,/id="guide-image"/);
  assert.equal((await fetch(`${url}/cubamax.js`)).status,200);assert.equal((await fetch(`${url}/cubamax-logo.svg`)).status,200);
  const status=await(await fetch(`${url}/api/status`,{headers:{Cookie:cookie}})).json();assert.equal(status.country,'US');assert.equal(status.nationalNumber,'2025550123');assert.equal(status.name,null);assert.equal(status.consent,false);
  assert.equal((await fetch(`${url}/api/pause`,{method:'POST',headers:{Origin:'https://other.example',Cookie:cookie},body:'{}'})).status,403);
  assert.equal((await fetch(`${url}/api/connect`,{method:'POST',headers:{Origin:url,Cookie:cookie},body:JSON.stringify({phone:'+12025550123',consent:true})})).status,503);
  const resetDenied=await fetch(`${url}/api/browser-reset`,{method:'POST',headers:{Origin:'https://other.example',Cookie:cookie},body:'{}'});assert.equal(resetDenied.status,403);
  const reset=await fetch(`${url}/api/browser-reset`,{method:'POST',headers:{Origin:url,Cookie:cookie},body:'{}'});assert.equal(reset.status,200);assert.match(reset.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await fetch(`${url}/api/status`,{headers:{Cookie:cookie}})).status,401);
  const inspect=new Store(dir);assert.ok(inspect.account(invite.account.id));assert.equal(inspect.account(invite.account.id).status,'pending');inspect.db.close();
  const connectedStore=new Store(dir),saved=new BaileysStore(connectedStore,invite.account.id).auth();saved.state.creds.registered=true;saved.saveCreds();connectedStore.update(invite.account.id,'consent',1);connectedStore.update(invite.account.id,'status','connected');
  const freshBrowser=connectedStore.exchange(connectedStore.invite('12025550123','Titular').secret);connectedStore.db.close();
  const completedStatus=await fetch(`${url}/api/status`,{headers:{Cookie:`wa_session=${freshBrowser}`}});assert.equal((await completedStatus.json()).status,'connected');assert.match(completedStatus.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await fetch(`${url}/api/status`,{headers:{Cookie:`wa_session=${freshBrowser}`}})).status,401);
  const enrolled=await fetch(`${url}/api/register`,{method:'POST',headers:{Origin:url},body:JSON.stringify({phone:'+12025550123',country:'US',nationalNumber:'2025550123',consent:true})});assert.equal(enrolled.status,200);assert.equal((await enrolled.json()).completed,true);assert.equal(enrolled.headers.get('set-cookie'),null);
  assert.equal((await fetch(`${url}/api/status`)).status,401);
  const preserved=new Store(dir);assert.equal(preserved.account(invite.account.id).status,'connected');assert.equal(preserved.db.prepare('SELECT count(*) n FROM accounts').get().n,1);preserved.db.close();
  const reused=await fetch(`${url}/api/access`,{method:'POST',headers:{Origin:url},body:JSON.stringify({token:invite.secret})});assert.equal(reused.status,401);
});
