import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/panel.css',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/panel.js',import.meta.url),'utf8');
const manager=readFileSync(new URL('../src/whatsapp.js',import.meta.url),'utf8');

test('the panel shows visible loading and error states for account, chat, history and gallery requests',()=>{
 for(const id of ['accounts-load-state','chats-load-state','thread-load-state'])
  assert.match(html,new RegExp('id="'+id+'"[^>]*role="status"'));
 for(const text of ['Cargando cuentas vinculadas','Cargando conversaciones e historial','Cargando historial de mensajes','Cargando fotos y videos','Cargando vista previa'])
  assert.ok(panel.includes(text),text);
 assert.match(panel,/beginLoading\('accounts-load-state'/);
 assert.match(panel,/beginLoading\('chats-load-state'/);
 assert.match(panel,/beginLoading\('thread-load-state'/);
 assert.match(panel,/22000/);
 assert.match(panel,/25000/);
 assert.match(panel,/La consulta tardó demasiado/);
 assert.match(css,/wa-panel-loading-spin/);
 assert.match(css,/wa-panel-thumb-pulse/);
});

test('authorized disconnected accounts stay on the panel with clear state and saved history',()=>{
 assert.match(api,/status:a\.status/);
 assert.match(panel,/Reconectando…/);
 assert.match(panel,/Requiere vinculación/);
 assert.match(panel,/Puedes revisar el historial guardado/);
 assert.match(panel,/Sin conexión: todavía no hay fotos o videos guardados/);
 assert.match(manager,/persistentRecovery&&a\.confirmed&&!pair/);
});
