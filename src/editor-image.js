import {readFileSync} from 'node:fs';
import path from 'node:path';

// Read the current local asset, including saved replacements, without writing site content.
export async function sendEditorImage(bot,chat,asset,caption,markup){
  let filename;
  if(/^\/portal-media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset))filename=path.join(bot.accounts.dir,asset.slice(1));
  else if(/^\/(cubamax-promos|cubamax-services|cubamax-slides|guides)\/[a-zA-Z0-9_/-]+\.(webp|png|jpg|gif|svg)$/.test(asset)&&!asset.includes('..'))filename=new URL('../public'+asset,import.meta.url);
  else throw Error('Imagen actual no disponible.');
  const {default:sharp}=await import('sharp');
  const data=await sharp(readFileSync(filename),{limitInputPixels:40000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
  return bot.sendFile(chat,{data,mime:'image/jpeg',name:'foto-actual.jpg',display:true,caption},markup);
}
