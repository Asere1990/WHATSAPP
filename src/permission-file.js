import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const validId=id=>/^[1-9][0-9]{4,19}$/.test(id);
const readText=file=>{
  try{return readFileSync(file,'utf8');}
  catch(error){if(error.code==='ENOENT')return '';throw error;}
};

// The checked-in permisos.txt stays the baseline. Admin additions live in
// DATA_DIR/permisos.txt on Render's persistent disk, surviving redeploys.
export class PermissionFile{
  constructor({source='permisos.txt',dataDir=process.env.DATA_DIR||'./data'}={}){
    this.source=source;
    this.path=path.join(dataDir,'permisos.txt');
  }
  read(){
    const result=new Set();
    for(const file of new Set([this.source,this.path]))
      for(const line of readText(file).split(/\r?\n/)){
        const id=line.split('#')[0].trim();
        if(/^\d+$/.test(id))result.add(id);
      }
    return result;
  }
  add(input){
    if(typeof input!=='string'||input.length>3000)throw Error('Envía uno o varios telegram_id válidos.');
    const ids=[...new Set(input.split(/[\s,;]+/).filter(Boolean))];
    if(!ids.length||ids.length>40||ids.some(id=>!validId(id)))
      throw Error('Envía entre 1 y 40 telegram_id numéricos (5 a 20 dígitos), separados por comas o espacios.');
    const current=this.read(),added=ids.filter(id=>!current.has(id));
    if(!added.length)return {added,existing:ids,count:current.size};
    mkdirSync(path.dirname(this.path),{recursive:true,mode:0o700});
    const target=[...current,...added].join('\n')+'\n';
    const temporary=this.path+'.tmp-'+process.pid+'-'+randomBytes(6).toString('hex');
    try{
      writeFileSync(temporary,target,{encoding:'utf8',mode:0o600,flag:'wx'});
      renameSync(temporary,this.path);
    }finally{
      try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return {added,existing:ids.filter(id=>current.has(id)),count:current.size+added.length};
  }
}
