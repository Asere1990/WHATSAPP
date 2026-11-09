import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {PublicWhatsAppLinks} from '../src/public-wa-links.js';
import {PublicCubamaxLinks} from '../src/public-cubamax-links.js';
import {PublicAssociatedUsers} from '../src/public-associated-users.js';
import {PublicWaSender} from '../src/public-wa-send.js';
import {VisualEditor} from '../src/visual-editor.js';

const systemAdminActor=readFileSync('admins.txt','utf8').split(/\r?\n/)
 .map(line=>line.split('#')[0].split(',')[0].trim())
 .find(id=>/^\d+$/.test(id));

function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'wa-public-users-')),store=new Store(dir);
 store.db.exec('CREATE TABLE IF NOT EXISTS panel_owners(account TEXT PRIMARY KEY,actor TEXT NOT NULL,created INTEGER NOT NULL)');
 const wa=new PublicWhatsAppLinks(store),cm=new PublicCubamaxLinks(store,wa);
 const sent=[],bot={store,admins:()=>new Set(['99999']),send:async(...args)=>{sent.push(args);return true;},control:{home:async()=>true}};
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,wa,cm,bot,sent};
}
test('admins see real user profile and both portals; revoke, reactivate and ban do not disconnect accounts',async t=>{
 const {store,wa,cm,bot,sent}=setup(t),actor='12345';
 const users=new PublicAssociatedUsers(bot);
 users.remember({id:actor,first_name:'María',last_name:'Pérez',username:'maria_demo'},
  {user_id:12345,phone_number:'+12025550199'});
 const photo='/portal-media/'+'a'.repeat(64)+'.png';
 const waLink=wa.create(actor,'maria-wa',photo),cmLink=cm.create(actor,'maria-cm');
 const account=store.invite('12025550123','Cuenta vinculada').account;
 store.update(account.id,'consent',1);store.update(account.id,'status','connected');
 assert.equal(wa.attach(waLink.code,account.id),true);
 assert.equal(cm.attach(cmLink.code,account.id),true);
 const data=users.summary(actor);
 assert.equal(data.name,'María Pérez');
 assert.equal(data.username,'maria_demo');
 assert.equal(data.telegram_phone,'12025550199');
 assert.equal(data.links,2);
 assert.equal(data.active,2);
 assert.equal(data.linked_accounts,1,'one account linked to two URLs must count only once');
 assert.equal(users.page().total,1);
 await users.list('99999');
 assert.match(sent.at(-1)[1],/María Pérez|@maria_demo/);
 await users.show('99999',actor);
 assert.match(sent.at(-1)[1],/12025550123/);
 assert.equal(users.changeAll(actor,false),2);
 assert.equal(store.account(account.id).status,'connected');
 assert.equal(users.changeAll(actor,true),2);
 assert.equal(users.ban(actor),2);
 assert.equal(users.isBanned(actor),true);
 assert.equal(wa.active(waLink.code),null);
 assert.equal(cm.activeId(cmLink.link_id),null);
 assert.throws(()=>users.changeAll(actor,true),/desbanear/);
 assert.throws(()=>users.ban('99999'),/administrador/);
 users.unban(actor);
 assert.equal(users.isBanned(actor),false);
 assert.equal(wa.active(waLink.code),null,'unbanning never silently reactivates URLs');
 assert.equal(users.changeAll(actor,true),2);
 assert.equal(store.account(account.id).status,'connected');
});
test('public system WhatsApp message attaches an editor-uploaded MP4 as header with link caption',async t=>{
 const {store,wa,dir}=setup(t),actor=systemAdminActor,photo='/portal-media/'+'b'.repeat(64)+'.png';
 wa.create(actor,'invitacion-demo',photo);
 const system=store.invite('17867707509','Sistema').account;
 store.update(system.id,'consent',1);store.update(system.id,'status','connected');
 const video=Buffer.from('test video attachment data');
 const ext=createHash('sha256').update(video).digest('hex')+'.mp4';
 mkdirSync(path.join(dir,'portal-media'));writeFileSync(path.join(dir,'portal-media',ext),video);
 store.setConfig('wa_public_invitation_media','/portal-media/'+ext);
 const calls=[],accounts={dir,live:new Map([[system.id,{ready:true}]]),send:async(...args)=>{calls.push(args);return {ok:true};}};
 const sender=new PublicWaSender(store,accounts,wa);
 const fields=new VisualEditor(store,dir).fields(store,'wa');
 const field=fields.find(f=>f.id==='public-wa:invitation-media');
 assert.equal(field?.kind,'media');
 assert.equal(field?.value,'/portal-media/'+ext);
 await sender.send({actor,code:'invitacion-demo',phone:'12025550124',source:system.id});
 assert.equal(calls.length,1);
 assert.match(calls[0][2],/https:\/\/securitywhat\.app\/invitacion-demo/);
 assert.equal(calls[0][3].mime,'video/mp4');
 assert.deepEqual(calls[0][3].data,video);
});
test('without a configured video the system retains existing text-only sending',t=>{
 const {store,wa,dir}=setup(t);
 const sender=new PublicWaSender(store,{dir,live:new Map()},wa);
 assert.equal(sender.attachment(),null);
 assert.match(sender.message('normal'),/https:\/\/securitywhat\.app\/normal/);
});
