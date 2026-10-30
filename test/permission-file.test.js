import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PermissionFile} from '../src/permission-file.js';

test('permisos.txt keeps repository defaults and stores new IDs on a durable disk path',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'whatsapp-permission-file-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.txt'),dataDir=path.join(dir,'persistent');
  writeFileSync(source,'12345 # Usuario existente\n23456\n');
  const file=new PermissionFile({source,dataDir});
  assert.deepEqual([...file.read()],['12345','23456']);
  const saved=file.add('34567, 45678 34567\n56789');
  assert.deepEqual(saved.added,['34567','45678','56789']);
  assert.deepEqual(saved.existing,[]);
  assert.equal(saved.count,5);
  assert.deepEqual([...file.read()],['12345','23456','34567','45678','56789']);
  assert.equal(readFileSync(source,'utf8'),'12345 # Usuario existente\n23456\n','source file remains untouched');
  const persisted=path.join(dataDir,'permisos.txt');
  assert.ok(statSync(persisted).isFile());
  assert.ok(!/\.tmp-/.test(readFileSync(persisted,'utf8')));
  assert.equal(statSync(persisted).mode&0o077,0,'operator IDs are not world-readable');
  const restarted=new PermissionFile({source,dataDir});
  assert.deepEqual([...restarted.read()],['12345','23456','34567','45678','56789']);
  assert.deepEqual(restarted.add('34567, 12345').added,[]);
  assert.deepEqual(restarted.add('67890').added,['67890']);
  assert.deepEqual([...file.read()],['12345','23456','34567','45678','56789','67890']);
});

test('permisos.txt rejects malformed Telegram IDs without changing the file',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'whatsapp-permission-invalid-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'base.txt'),dataDir=path.join(dir,'persistent');
  writeFileSync(source,'12345\n');
  mkdirSync(dataDir);
  const file=new PermissionFile({source,dataDir});
  const cases=['', 'abc', '12345, invalid','12345 # injected', '../12345', '0','000012345','1'.repeat(21),
    Array.from({length:41},(_,i)=>String(10000+i)).join(',')];
  for(const value of cases)assert.throws(()=>file.add(value),/telegram_id/,value);
  assert.deepEqual([...file.read()],['12345']);
  assert.throws(()=>readFileSync(path.join(dataDir,'permisos.txt')),{code:'ENOENT'});
});
