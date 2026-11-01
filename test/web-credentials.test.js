import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {Store} from '../src/store.js';
import {PanelAccess} from '../src/panel-access.js';
import {PermissionFile} from '../src/permission-file.js';
import {parsedCredentialLines,verifyWebPassword} from '../src/web-credentials.js';

const record=(id,secret)=>{
 const salt=randomBytes(16);
 const digest=pbkdf2Sync(secret,salt,310000,32,'sha256');
 return id+',pbkdf2_sha256$310000$'+salt.toString('hex')+'$'+digest.toString('hex');
};
test('permission file accepts protected hashes alongside old numeric IDs',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wa-login-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'permission-source.txt');
 const entry=record('87654012345','example-local-only-strong-passphrase');
 writeFileSync(source,'12345\n'+entry+'\n45678 # existing\n');
 const file=new PermissionFile({source,dataDir:path.join(dir,'state')});
 assert.deepEqual([...file.read()],['12345','87654012345','45678']);
 assert.equal(parsedCredentialLines('12345\n'+entry+'\n').size,1);
 assert.equal(verifyWebPassword('example-local-only-strong-passphrase',entry.split(',')[1]),true);
 assert.equal(verifyWebPassword('wrong-string',entry.split(',')[1]),false);
});
test('direct web login obeys operator role and invalidates rotated credentials',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wa-web-login-test-'));
 const source=path.join(dir,'operators.txt'),actor='87654012346',secret='another-example-local-only-passphrase';
 writeFileSync(source,record(actor,secret)+'\n');
 const store=new Store(dir),roles=new Map([[actor,'operator']]);
 t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});
 const access=new PanelAccess(store,id=>roles.get(id)||null,source);
 assert.equal(access.webLogin(actor,'incorrect'),null);
 const session=access.webLogin(actor,secret);
 assert.ok(session&&access.session(session.secret)?.role==='operator');
 const telegramLink=access.login(access.token(actor,'panel'));
 assert.equal(access.session(telegramLink.secret).actor,actor);
 writeFileSync(source,record(actor,'rotated-example-local-only-passphrase')+'\n');
 assert.equal(access.session(session.secret),null);
 assert.equal(access.webLogin(actor,secret),null);
 assert.ok(access.webLogin(actor,'rotated-example-local-only-passphrase'));
 roles.delete(actor);
 assert.equal(access.session(telegramLink.secret),null);
});
