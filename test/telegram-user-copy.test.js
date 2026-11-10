import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {VisualEditor} from '../src/visual-editor.js';
import {PublicWaLinkBot} from '../src/public-wa-links-bot.js';
import {telegramUserCopyCatalog,telegramPublicCopyKeys,renderTelegramUserCopy} from '../src/telegram-user-copy.js';
function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-tg-copy-')),store=new Store(dir),editor=new VisualEditor(store,dir);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {store,editor};
}
test('Telegram mensajes appears in both editors; admin-only sending text excluded',t=>{
 const {editor}=setup(t);
 const wa=editor.data('admin','wa').fields.filter(f=>f.telegram);
 const cm=editor.data('admin','cm').fields.filter(f=>f.telegram);
 for(const key of ['public-wa:message1','telegram-user:operatorReferralWa','telegram-user:operatorMenu'])
  assert.ok(wa.some(f=>f.id===key),key);
 for(const key of ['cm-telegram:cubamaxCodePrompt','telegram-user:operatorReferralCm','telegram-user:operatorMenu'])
  assert.ok(cm.some(f=>f.id===key),key);
 assert.ok(!wa.some(f=>f.id==='public-wa:countryPrompt'),'admins.txt-only workflow stays separate');
 assert.ok(!wa.some(f=>f.id==='public-wa:buttonWhatsApp'),'button labels remain in their old section');
 assert.ok(!wa.some(f=>f.id==='telegram-user:operatorReferralCm'));
 assert.ok(!cm.some(f=>f.id==='telegram-user:operatorReferralWa'));
 assert.ok(telegramPublicCopyKeys.cm.includes('cubamaxDelivered'));
 assert.ok(telegramUserCopyCatalog.systemSendDenied.sites.includes('wa'));
});
test('Cubamax publishes only its edited Telegram message, retaining previous WhatsApp text',t=>{
 const {store,editor}=setup(t);
 store.setConfig('wa_public_link_texts',JSON.stringify({message1:'WhatsApp intacto',cubamaxCodePrompt:'Cubamax anterior'}));
 const d=editor.data('admin','cm');
 assert.equal(d.fields.find(f=>f.id==='cm-telegram:cubamaxCodePrompt').value,'Cubamax anterior');
 const saved=editor.save('admin',{site:'cm',version:d.version,revision:d.base,changes:[{id:'cm-telegram:cubamaxCodePrompt',value:'Cubamax editado'}]});
 assert.equal(JSON.parse(store.config().wa_public_link_texts).cubamaxCodePrompt,'Cubamax anterior');
 editor.publish('admin',{site:'cm',version:saved.version});
 const texts=JSON.parse(store.config().wa_public_link_texts);
 assert.equal(texts.message1,'WhatsApp intacto');
 assert.equal(texts.cubamaxCodePrompt,'Cubamax editado');
 assert.equal(new PublicWaLinkBot({store}).copy('cubamaxCodePrompt'),'Cubamax editado');
});
test('WhatsApp operator text is saved as draft and only published on confirmation',t=>{
 const {store,editor}=setup(t),d=editor.data('admin','wa');
 const value='WHATSAPP · MI CUENTA\nCuentas: {cuentas}\nConectadas: {conectadas}';
 const next=editor.save('admin',{site:'wa',version:d.version,revision:d.base,changes:[{id:'telegram-user:operatorMenu',value}]});
 assert.match(renderTelegramUserCopy(store,'operatorMenu',{cuentas:2,conectadas:1}),/Cuentas vinculadas: 2/);
 editor.publish('admin',{site:'wa',version:next.version});
 assert.equal(renderTelegramUserCopy(store,'operatorMenu',{cuentas:2,conectadas:1}),'WHATSAPP · MI CUENTA\nCuentas: 2\nConectadas: 1');
 assert.match(renderTelegramUserCopy(store,'operatorReferralCm',{enlace:'https://example.org'}),/CUBAMAX/);
});
test('required placeholders cannot be lost in editable Telegram messages',t=>{
 const {editor}=setup(t),d=editor.data('admin','cm');
 assert.throws(()=>editor.save('admin',{site:'cm',version:d.version,revision:d.base,
  changes:[{id:'telegram-user:operatorReferralCm',value:'Enlace sin marcador'}]}),/Conserva \{enlace\}/);
});
