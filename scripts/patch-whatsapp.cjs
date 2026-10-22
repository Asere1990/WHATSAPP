'use strict';
// Compatibility bridge for the pinned, MIT-licensed whatsapp-web.js 1.34.7.
// Upstream reports: https://github.com/wwebjs/whatsapp-web.js/pull/201850
// https://github.com/wwebjs/whatsapp-web.js/pull/201910
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const marker='WHATSAPP_COMPAT_IDS_V2';
function patch(source){
  if(source.includes(marker))return source;
  if(createHash('sha256').update(source).digest('hex')!=='0d0f88565f481dbfeb9493b04b24033a2cb60f5fd2fd0e84e543b461d98878fe')throw Error('Review compatibility patch: unexpected whatsapp-web.js Utils source.');
  const replace=(old,next)=>{if(!source.includes(old))throw Error('Compatibility target missing.');source=source.replaceAll(old,()=>next);};
  replace('    window.WWebJS = {};',`    window.WWebJS = {};
    // ${marker}
    window.WWebJS.keyString = value => {
        if (typeof value === 'string') return value || null;
        if (!value) return null;
        for (const key of ['_serialized', '$1']) {
            if (typeof value[key] === 'string' && value[key]) return value[key];
        }
        if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
            const text = value.toString();
            if (typeof text === 'string' && text && text !== '[object Object]') return text;
        }
        return null;
    };
    window.WWebJS.stableId = value => {
        const key = window.WWebJS.keyString(value);
        return key ? { ...(typeof value === 'object' ? value : {}), _serialized: key } : value;
    };`);
  for(const [old,next]of [
    ['newMsgKey._serialized','window.WWebJS.keyString(newMsgKey)'],
    ['msg.id._serialized','window.WWebJS.keyString(msg.id)'],
    ['msg.id.remote._serialized','window.WWebJS.keyString(msg.id.remote)'],
    ['chat.id._serialized','window.WWebJS.keyString(chat.id)'],
    ['chat.lastReceivedKey._serialized','window.WWebJS.keyString(chat.lastReceivedKey)']
  ])replace(old,next);
  replace('        const msg = message.serialize();',`        const msg = message.serialize();
        msg.id = window.WWebJS.stableId(msg.id);
        for (const field of ['from', 'to', 'author']) {
            if (msg[field] && typeof msg[field] === 'object') msg[field] = window.WWebJS.keyString(msg[field]);
        }`);
  replace('        const model = chat.serialize();','        const model = chat.serialize();\n        model.id = window.WWebJS.stableId(model.id || chat.id);');
  replace('        let res = contact.serialize();','        let res = contact.serialize();\n        res.id = window.WWebJS.stableId(res.id || contact.id);');
  replace('        if (model.msgs && model.msgs.length) {','        if (model.msgs && model.msgs.length && window.WWebJS.keyString(chat.lastReceivedKey)) {');
  const begin=source.indexOf('    window.WWebJS.getChats = async () => {');
  const end=source.indexOf('    window.WWebJS.getChannels = async () => {',begin);
  if(begin<0||end<0)throw Error('Chat mapping target missing.');
  source=source.slice(0,begin)+`    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const result = [];
        window.WWebJS.chatReadFailures = 0;
        for (const chat of chats) {
            try {
                const model = await window.WWebJS.getChatModel(chat);
                if (!model || !window.WWebJS.keyString(model.id)) throw new Error('Chat model unavailable');
                result.push(model);
            } catch (_) { window.WWebJS.chatReadFailures++; }
        }
        return result;
    };

`+source.slice(end);
  return source;
}
module.exports={patch};
if(require.main===module){
  const version=require('whatsapp-web.js/package.json').version;if(version!=='1.34.7')throw Error('Review compatibility bridge before changing library version.');
  const file=require.resolve('whatsapp-web.js/src/util/Injected/Utils.js');
  const source=readFileSync(file,'utf8'),next=patch(source);if(next!==source)writeFileSync(file,next);
  console.log('WHATSAPP: identifier compatibility bridge verified');
}
