import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validatePopupLayers,parseTesseractTsv,recognizePopupText} from '../src/popup-ocr.js';
const line=(id,word,x,y,w,h,conf=95)=>[5,1,1,1,id,1,x,y,w,h,conf,word].join('\t');
test('OCR joins words into line bounds with normalized positions',()=>{
 const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+line(1,'ENVIA',100,150,90,30)+'\n'+line(1,'DINERO',200,150,100,30)+'\n'+line(2,'CUBA',100,250,80,28);
 const found=parseTesseractTsv(tsv,1000,1000);
 assert.equal(found.length,2);
 assert.equal(found[0].text,'ENVIA DINERO');
 assert.ok(found[0].x<0.1&&found[0].w>0.2);
 assert.equal(found[1].text,'CUBA');
});
test('the OCR endpoint only reads an uploaded image and never reads other files',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ocr-popup-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const asset='/portal-media/'+'a'.repeat(64)+'.png';
 mkdirSync(path.join(dir,'portal-media'));writeFileSync(path.join(dir,asset.slice(1)),Buffer.from('image-placeholder'));
 await assert.rejects(recognizePopupText('../../secrets.txt',dir),/Solo se pueden/);
 let calls=0;
 const sample='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+line(1,'HELLO',50,80,140,25);
 const found=await recognizePopupText(asset,dir,{metadata:{width:500,height:300},execute:async(cmd,args,opts)=>{calls++;assert.equal(cmd,'tesseract');assert.ok(args[0].endsWith('/portal-media/'+asset.slice(14)));assert.equal(opts.timeout,25000);return{stdout:sample};}});
 assert.equal(calls,1);assert.equal(found.layers.length,1);
 assert.equal(found.layers[0].original,'HELLO');
});
test('edited text layers are bounded, validated, and cannot inject HTML into the page',()=>{
 const valid={id:'ocr-0',x:0.1,y:0.1,w:0.6,h:0.04,original:'OLD',text:'NEW',color:'#fa4455',fontSize:32,weight:'700',family:'Arial'};
 assert.deepEqual(validatePopupLayers([valid]),[valid]);
 assert.deepEqual(validatePopupLayers(JSON.stringify([valid])),[valid]);
 assert.throws(()=>validatePopupLayers([{...valid,x:1.1}]),/Posición/);
 assert.throws(()=>validatePopupLayers([{...valid,text:'x'.repeat(300)}]),/demasiado largo/);
 assert.throws(()=>validatePopupLayers([{...valid,fontSize:600}]),/Tamaño/);
 assert.equal(validatePopupLayers([{...valid,family:'<script>alert(1)</script>',color:'url(https://bad)'}])[0].family,'Arial');
 assert.equal(validatePopupLayers([{...valid,family:'<script>alert(1)</script>',color:'url(https://bad)'}])[0].color,'#ffffff');
});
