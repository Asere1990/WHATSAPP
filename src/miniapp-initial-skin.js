// Aspecto de la mini app en el primer pintado: se entrega ANTES del HTML.
// Solo textos e imágenes públicas, nunca información privada de usuarios.
import {createHash} from 'node:crypto';
import {userMiniappLabels} from './miniapp-user-editor.js';
import {userMiniappMedia,userMiniappPreviews} from './miniapp-user-media.js';

export function miniappSkin(telegram){
  const store=telegram.store;
  return {
    labels:userMiniappLabels(store,telegram.publicWa.links.texts()),
    media:userMiniappMedia(store),
    previews:userMiniappPreviews(store)
  };
}
export function miniappSkinScript(skin){
  const json=JSON.stringify(skin)
    .replace(/</g,'\\u003c')
    .replace(/>/g,'\\u003e')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
  return 'window.__WA_MINIAPP_SKIN__='+json+';'+
    'for(const path of Object.values(window.__WA_MINIAPP_SKIN__.media||{})){'+
    'if(!/^\\/portal-media\\/[a-f0-9]{64}\\.(?:png|jpg|gif|webp)$/.test(path))continue;'+
    'const link=document.createElement("link");link.rel="preload";link.as="image";'+
    'link.href="https://securitywhat.app"+path;link.fetchPriority="high";'+
    'document.head.appendChild(link);}\n';
}
export function miniappSkinResponse(telegram,headers={}){
  const script=miniappSkinScript(miniappSkin(telegram));
  const etag='"'+createHash('sha256').update(script).digest('hex').slice(0,24)+'"';
  if(headers['if-none-match']===etag)return {status:304,body:'',etag};
  return {status:200,body:script,etag};
}
