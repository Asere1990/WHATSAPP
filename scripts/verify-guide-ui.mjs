import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import puppeteer from 'puppeteer';
const dir=mkdtempSync(`${tmpdir()}/wa-guide-ui-`),port=23000+process.pid%10000,url=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['src/main.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,PUBLIC_URL:url,TOKEN:'',ADMIN_CHAT_ID:'',CHATS:''},stdio:'pipe'});
let browser,phase=null;
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:390,height:844,deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',req=>{
    const path=new URL(req.url()).pathname;
    if(['/api/register','/api/connect'].includes(path)){phase='connecting';return req.respond({status:path==='/api/register'?201:202,contentType:'application/json',body:'{"ok":true}'});}
    if(path==='/api/status')return req.respond({status:phase?200:401,contentType:'application/json',body:JSON.stringify(phase?{status:phase,phone:'+12025550123',name:'Prueba',consent:true,code:phase==='connecting'?'A1B2C3D4':null,paused:false}:{error:'Conecta tu cuenta'})});
    return req.continue();
  });
  await page.goto(url,{waitUntil:'networkidle0'});await page.click('#begin');
  assert.equal(await page.$eval('#connect',e=>e.hidden),true);assert.equal(await page.$eval('#guide',e=>e.hidden),false);
  await page.click('#device-android');await page.type('#phone','+12025550123');await page.click('#consent');await page.click('#connect-button');
  await page.waitForFunction(()=>!document.getElementById('pairing').hidden&&document.getElementById('code').textContent.includes('A1B2'));
  assert.equal(await page.$eval('#guide-next',e=>e.disabled),false);
  await page.click('#guide-next');assert.match(await page.$eval('#guide-text',e=>e.textContent),/tres puntos/);
  await page.waitForFunction(()=>document.getElementById('guide-image').complete&&document.getElementById('guide-image').naturalWidth>0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:'/tmp/whatsapp-guide-android.png',fullPage:true});
  await page.click('#device-iphone');await page.click('#guide-next');assert.match(await page.$eval('#guide-text',e=>e.textContent),/Configuración/);
  await page.screenshot({path:'/tmp/whatsapp-guide-iphone.png',fullPage:true});
  await page.click('#guide-back');assert.equal(await page.$eval('#guide-back',e=>e.disabled),true);
  for(let i=0;i<4;i++)await page.click('#guide-next');
  assert.equal(await page.$eval('#guide-next',e=>e.textContent),'COMPROBAR CONEXIÓN');phase='connected';await page.click('#guide-next');
  await page.waitForFunction(()=>!document.getElementById('connected').hidden);assert.equal(await page.$eval('#guide',e=>e.hidden),true);assert.deepEqual(errors,[]);
  console.log('Mobile guide UI passed: device choice, generation flow, steps, back, illustration load, no overflow, connection completion.');
}finally{
  await browser?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}rmSync(dir,{recursive:true,force:true});
}
