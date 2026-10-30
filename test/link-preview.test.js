import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {renderCubamaxPreview,renderWhatsAppPreview,whatsAppLinkPreview} from '../src/link-preview.js';

const original='<!doctype html><html><head><title>WHATSAPP · Conectar mi cuenta</title></head><body><h1>Contenido original</h1></body></html>';
const mock=config=>({config:()=>config});

test('The WhatsApp shared-link preview remains unchanged until an admin publishes settings',()=>{
 const rendered=renderWhatsAppPreview(original,mock({}),'https://securitywhat.app','/');
 assert.equal(rendered,original);
 const fields=whatsAppLinkPreview(mock({}));
 assert.equal(fields.name,'WHATSAPP');
 assert.equal(fields.slogan,'Conectar mi cuenta');
 assert.equal(fields.image,'');
});

test('The edited image, name, slogan, and description appear in WhatsApp Open Graph tags',()=>{
 const image='/portal-media/'+'a'.repeat(64)+'.jpg';
 const store=mock({wa_link_preview:JSON.stringify({
  image,name:'Mi empresa',slogan:'Atención y servicios',description:'Asistencia a través de nuestro portal.'
 })});
 const home=renderWhatsAppPreview(original,store,'https://securitywhat.app','/');
 assert.match(home,/<title>Mi empresa · Atención y servicios<\/title>/);
 assert.match(home,/<meta property="og:site_name" content="Mi empresa">/);
 assert.match(home,/<meta property="og:title" content="Mi empresa · Atención y servicios">/);
 assert.match(home,/<meta property="og:description" content="Asistencia a través de nuestro portal\.">/);
 assert.match(home,new RegExp('og:image" content="https://securitywhat\\.app/portal-media/'+'a'.repeat(64)+'\\.jpg"'));
 assert.match(home,/<meta name="twitter:card" content="summary_large_image">/);
 assert.match(home,/<meta property="og:url" content="https:\/\/securitywhat\.app\/">/);
 assert.match(home,/<h1>Contenido original<\/h1>/,'landing-page contents must remain unchanged');
 const sub=renderWhatsAppPreview(original,store,'https://securitywhat.app','/whatsapp');
 assert.match(sub,/<meta property="og:url" content="https:\/\/securitywhat\.app\/whatsapp">/);
});

test('Untrusted sharing metadata is escaped, and external or video image URLs are refused',()=>{
 const store=mock({wa_link_preview:JSON.stringify({
  name:'Empresa "A" & <Prueba>',slogan:'<script>no</script>',
  description:'Promoción <amigo> & "visitas"',image:'https://untrusted.example/preview.jpg'
 })});
 const rendered=renderWhatsAppPreview(original,store,'https://securitywhat.app','/');
 assert.match(rendered,/content="Empresa &quot;A&quot; &amp; &lt;Prueba&gt;">/);
 assert.match(rendered,/&lt;script&gt;no&lt;\/script&gt;/);
 assert.match(rendered,/content="Promoción &lt;amigo&gt; &amp; &quot;visitas&quot;">/);
 assert.doesNotMatch(rendered,/<meta property="og:image"/);
 assert.doesNotMatch(rendered,/<script>no<\/script>/);
 const video=mock({wa_link_preview:JSON.stringify({image:'/portal-media/'+'b'.repeat(64)+'.mp4'})});
 assert.doesNotMatch(renderWhatsAppPreview(original,video,'https://securitywhat.app','/'),/property="og:image"/);
});

test('Cubamax metadata and page are unaffected by WhatsApp-only settings',t=>{
 const dir=mkdtempSync(tmpdir()+'/wa-links-'),store=new Store(dir);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true})});
 const html='<html><head><title>Cubamax · Portal de trabajadores</title></head><body>Web Cubamax</body></html>';
 const previous=renderCubamaxPreview(html,store,'https://cubamaxcom.online','/cubamax');
 store.setConfig('wa_link_preview',JSON.stringify({
  name:'Otra marca',slogan:'Otro slogan',description:'Otro texto',image:'/portal-media/'+'c'.repeat(64)+'.jpg'
 }));
 const after=renderCubamaxPreview(html,store,'https://cubamaxcom.online','/cubamax');
 assert.equal(after,previous);
 assert.doesNotMatch(after,/Otra marca|Otro slogan|Otro texto/);
});
