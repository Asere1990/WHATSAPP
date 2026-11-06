import {PublicWhatsAppLinks} from './public-wa-links.js';
import {PublicCubamaxLinks} from './public-cubamax-links.js';
import {publicPopupPhoto} from './public-wa-photo.js';
import {sendEditorImage} from './editor-image.js';
import {savePageImage} from './page-editor.js';
import {PublicWaSender,publicWaCountry,publicWaDestination} from './public-wa-send.js';
import {renderPublicWaCopy} from './public-wa-copy.js';

// Public code/link management is isolated from WhatsApp/Meta sessions.
// The existing administrator and permisos.txt handlers remain unchanged.
export class PublicWaLinkBot {
  constructor(bot){this.bot=bot;this._links=null;}
  get links(){return this._links||(this._links=new PublicWhatsAppLinks(this.bot.store));}
  get cubamax(){return this._cubamax||(this._cubamax=new PublicCubamaxLinks(this.bot.store,this.links));}
  get sender(){return this._sender||(this._sender=new PublicWaSender(this.bot.store,this.bot.accounts,this.links));}
  copy(key,data={}){return renderPublicWaCopy(this.links.texts()[key]||'',data);}
  button(key){return this.copy(key).slice(0,64);}
  styleKeyboard(markup){
    if(!markup?.inline_keyboard)return markup;
    return {...markup,inline_keyboard:markup.inline_keyboard.map(row=>row.map(button=>{
      const action=String(button.callback_data||'');
      const style=(action==='pwa:panel'||action==='op:panel'||action==='pwa:cubamax')?'primary':
        (action.startsWith('pwa:send:')||action==='pwa:send-confirm'||action==='pwa:whatsapp')?'success':'danger';
      return {...button,style};
    }))};
  }
  send(chat,text,markup){
    return this.bot.send(chat,text,this.styleKeyboard(markup));
  }
  key(chat,actor){return String(chat)+':'+String(actor);}
  async start(chat,key){
    this.bot.pending.delete(key);
    const t=this.links.texts(),actor=String(key).split(':').at(-1);
    const panelEnabled=!!this.bot.autoPublicAccess?.eligible(actor)&&
      !!this.bot.webPanel?.role(actor);
    return this.send(chat,t.choose,{inline_keyboard:[
      ...(panelEnabled?[[{text:this.button('buttonOwnPanel'),callback_data:'pwa:panel'}]]:[]),
      [{text:this.button('buttonWhatsApp'),callback_data:'pwa:whatsapp'}],
      [{text:this.button('buttonCubamax'),callback_data:'pwa:cubamax'}],
      [{text:this.button('buttonMyLinks'),callback_data:'pwa:list:0'}]
    ]});
  }
  async chooseSite(chat,key){
    this.bot.pending.delete(key);
    return this.send(chat,this.copy('choose'),{inline_keyboard:[
      [{text:this.button('buttonWhatsApp'),callback_data:'pwa:whatsapp'}],
      [{text:this.button('buttonCubamax'),callback_data:'pwa:cubamax'}],
      [{text:this.button('buttonBack'),callback_data:'pwa:menu'}]
    ]});
  }
  async askCode(chat,key,site='wa',sendFirst=false){
    if(site==='cm'){
      this.bot.pending.set(key,{kind:'publicCmCode',started:Date.now()});
      return this.send(chat,this.copy('cubamaxCodePrompt')+'\n\n'+this.copy('cubamaxCodeHelp'));
    }
    this.bot.pending.set(key,{kind:'publicWaCode',started:Date.now(),sendFirst});
    return this.send(chat,this.copy('message1')+'\n\n'+this.copy('codeHelp'));
  }
  keyboard(code,actor=code?this.links.record(code)?.actor:''){
    const ref=code?this.links.callbackRef(code):'';
    const panelEnabled=!!this.bot.autoPublicAccess?.eligible(actor)&&
      !!this.bot.webPanel?.role(actor);
    return this.styleKeyboard({inline_keyboard:[
      ...(panelEnabled?[[{text:this.button('buttonOwnPanel'),callback_data:'pwa:panel'}]]:[]),
      [{text:this.button('buttonViewLinks'),callback_data:'pwa:list:0'}],
      ...(code?[[{text:this.button('buttonSendLink'),callback_data:'pwa:send:'+ref}],
        [{text:this.button('buttonAssociatedAccounts'),callback_data:'pwa:accounts:'+ref}],
        [{text:this.button('buttonRevoke'),callback_data:'pwa:revoke:'+ref}],
        [{text:this.button('buttonDelete'),callback_data:'pwa:delete:'+ref}]]:[]),
      [{text:this.button('buttonCreateAnother'),callback_data:'pwa:create'}],
      [{text:this.button('buttonSites'),callback_data:'pwa:menu'}]
    ]});
  }
  cubamaxKeyboard(code){
    const row=code?this.cubamax.record(code):null,ref=row?'~'+row.link_id:'';
    return this.styleKeyboard({inline_keyboard:[
      [{text:this.button('buttonViewLinks'),callback_data:'pwa:list:0'}],
      ...(row?[
        [{text:this.button('buttonAssociatedAccounts'),callback_data:'pwa:cm-accounts:'+ref}],
        [{text:this.button('buttonRevoke'),callback_data:'pwa:cm-revoke:'+ref}],
        [{text:this.button('buttonDelete'),callback_data:'pwa:cm-delete:'+ref}]
      ]:[]),
      [{text:this.button('buttonCreateAnother'),callback_data:'pwa:create'}],
      [{text:this.button('buttonSites'),callback_data:'pwa:menu'}]
    ]});
  }
  async inputCubamax(chat,key,actor,m){
    const raw=m.text?.trim()||'';
    if(!raw)return this.send(chat,this.copy('codeMissing'));
    try{
      const row=this.cubamax.create(actor,raw);
      this.bot.pending.delete(key);
      return this.send(chat,this.copy('cubamaxDelivered')+'\n\n'+this.cubamax.url(row.code)+
        '\n\n'+this.copy('cubamaxShareNote'),this.cubamaxKeyboard(row.code));
    }catch(error){
      return this.send(chat,this.copy('codeInvalid',{error:error?.message||'Elige otro código.'}));
    }
  }
  async askOwnPhoto(chat,key,code,reason='',sendContext=null){
    this.bot.pending.set(key,{kind:'publicWaPhoto',code,started:Date.now(),
      ...(sendContext?{sendContext}: {})});
    const message=(reason?reason+'\n\n':'')+this.copy('ownPhoto');
    return this.send(chat,message+'\n\n'+this.copy('cancelHelp'));
  }
  async completeLink(chat,key,actor,code,photo,ownPhoto=false){
    // Always show the picture the first visitor will see before issuing a URL.
    // User-supplied pictures are kept byte-for-byte as uploaded.
    await sendEditorImage(this.bot,chat,photo,
      this.copy('preview')+'\n\n'+
      (ownPhoto?this.copy('ownPhotoNotice')+'\n\n':'')+
      this.copy('firstOnly'));
    const row=this.links.create(actor,code,photo);
    this.bot.pending.delete(key);
    await this.send(chat,this.copy('delivered')+'\n\n'+this.links.url(row.code)+
      '\n\n'+this.copy('firstOnly'),this.keyboard(row.code));
    // El enlace ya existe. El nuevo flujo de envío NO altera su contenido ni las cuentas.
    return this.askCountry(chat,key,actor,row.code);
  }

  async askCountry(chat,key,actor,code){
    const row=this.links.owned(actor,code);
    if(!row?.enabled)return this.send(chat,this.copy('inactiveLink'));
    this.bot.pending.set(key,{kind:'publicWaCountry',code,actor:String(actor)});
    return this.send(chat,this.copy('countryPrompt'),{
      inline_keyboard:[[{text:this.button('buttonSkip'),callback_data:'pwa:send-skip'}]]
    });
  }
  async inputCountry(chat,key,actor,pending,m){
    let country;
    try{country=publicWaCountry(m.text||'');}
    catch(error){return this.send(chat,this.copy('countryInvalid',{error:error.message}));}
    this.bot.pending.set(key,{kind:'publicWaPhone',code:pending.code,actor:String(actor),
      country,sendFirst:!!pending.sendFirst});
    return this.send(chat,this.copy('phonePrompt',{pais:country.name}));
  }
  async inputPhone(chat,key,actor,pending,m){
    let recipient;
    try{recipient=publicWaDestination(pending.country.iso,m.text||'');}
    catch(error){return this.send(chat,this.copy('phoneInvalid',{error:error.message}));}
    // The phone entered here is the RECIPIENT. It does not need to have
    // any account or authorization in this WhatsApp management database.
    // Verify the configured SENDER only when the user confirms delivery.
    let message;
    try{message=this.sender.message(pending.code);}
    catch(error){return this.send(chat,this.copy('messageInvalid',{error:error.message}));}
    if(pending.sendFirst){
      const sendContext={recipient};
      const photo=this.links.sourcePhoto();
      if(!photo)return this.askOwnPhoto(chat,key,pending.code,this.copy('photoMissing'),sendContext);
      let derived;
      try{
        await this.bot.api('sendChatAction',{chat_id:chat,action:'upload_photo'}).catch(()=>{});
        // Keep the existing OCR untouched; timestamp the popup only after
        // the recipient has been chosen, immediately before preview.
        derived=await this.popupForSend(photo,new Date());
      }catch(error){
        console.warn('WHATSAPP: public_send_popup_ocr_unavailable',JSON.stringify({
          code:pending.code,error:error?.code||error?.name||'ERROR'}));
        return this.askOwnPhoto(chat,key,pending.code,this.copy('ocrUnavailable'),sendContext);
      }
      return this.previewNewSend(chat,key,actor,pending.code,derived.asset,sendContext);
    }
    this.bot.pending.set(key,{kind:'publicWaConfirm',code:pending.code,actor:String(actor),
      recipient:recipient.phone,country:recipient.country});
    return this.showSendConfirmation(chat,message,recipient);
  }
  async showSendConfirmation(chat,message,recipient){
    return this.send(chat,this.copy('sendPreviewTitle')+'\n\n'+message+
      '\n\n————————\n'+this.copy('sendPreviewDestination',{numero:recipient.e164,pais:recipient.country})+
      '\n\n'+this.copy('sendPreviewConsent'),{
        inline_keyboard:[[{text:this.button('buttonConfirmSend'),callback_data:'pwa:send-confirm'}],
          [{text:this.button('buttonCancel'),callback_data:'pwa:send-skip'}]]
      });
  }
  async popupForSend(source,at){return publicPopupPhoto(this.bot.store,this.bot.accounts.dir,source,at);}
  async previewPopup(chat,photo,caption){return sendEditorImage(this.bot,chat,photo,caption);}
  async previewNewSend(chat,key,actor,code,photo,{recipient,source},ownPhoto=false){
    let message;
    try{message=this.sender.message(code);}
    catch(error){return this.send(chat,this.copy('messageInvalid',{error:error.message}));}
    // Reserve the exact code before sending the image. A collision with an old
    // numeric link must never leave the flow stranded after its popup preview.
    let row;
    try{row=this.links.create(actor,code,photo);}
    catch(error){
      this.bot.pending.set(key,{kind:'publicWaCode',started:Date.now(),sendFirst:true});
      return this.send(chat,this.copy('codeInvalid',{error:error.message})+'\n\n'+
        this.copy('message1')+'\n\n'+this.copy('codeHelp'));
    }
    // Keep the OCR/photo untouched. Now a successful picture is always
    // followed by the existing confirmation message and its send button.
    await this.previewPopup(chat,photo,
      this.copy('preview')+'\n\n'+
      (ownPhoto?this.copy('ownPhotoNotice')+'\n\n':'')+this.copy('firstOnly'));
    this.bot.pending.set(key,{kind:'publicWaConfirm',code:row.code,
      actor:String(actor),recipient:recipient.phone,
      country:recipient.country,source});
    return this.showSendConfirmation(chat,message,recipient);
  }
  async input(chat,key,actor,m){
    const pending=this.bot.pending.get(key);
    if(pending?.kind==='publicCmCode')return this.inputCubamax(chat,key,actor,m);
    if(pending?.kind==='publicWaCode'&&pending.sendFirst){
      const raw=m.text?.trim()||'';
      if(!raw)return this.send(chat,this.copy('codeMissing'));
      let code;
      try{code=this.links.normalize(raw);}
      catch(error){return this.send(chat,this.copy('codeInvalid',{error:error.message}));}
      if(this.links.record(code))return this.send(chat,this.copy('codeTaken'));
      try{this.links.validateNewCode(actor,code);}
      catch(error){return this.send(chat,this.copy('codeInvalid',{error:error.message}));}
      this.bot.pending.set(key,{kind:'publicWaCountry',code,actor:String(actor),sendFirst:true});
      return this.send(chat,this.copy('countryPrompt'),{
        inline_keyboard:[[{text:this.button('buttonSkip'),callback_data:'pwa:send-skip'}]]
      });
    }
    if(pending?.kind==='publicWaCountry')return this.inputCountry(chat,key,actor,pending,m);
    if(pending?.kind==='publicWaPhone')return this.inputPhone(chat,key,actor,pending,m);
    if(pending?.kind==='publicWaPhoto'){
      if(!m.photo?.length&&!m.document)
        return this.send(chat,this.copy('photoExpected')+'\n\n'+this.copy('ownPhoto'));
      try{
        const original=await savePageImage(this.bot,m);
        // This is the manual fallback; no OCR recoloring, layout edits,
        // or date replacement is applied to the person's own image.
        if(pending.sendContext)
          return this.previewNewSend(chat,key,actor,pending.code,original,pending.sendContext,true);
        return await this.completeLink(chat,key,actor,pending.code,original,true);
      }catch(error){
        console.warn('WHATSAPP: public_own_popup_photo_failed',JSON.stringify({code:pending.code,error:error?.code||error?.name||'ERROR'}));
        return this.send(chat,this.copy('photoError',{error:error?.message||'No pude recibir esa imagen.'})+'\n\n'+this.copy('ownPhoto'));
      }
    }
    const raw=m.text?.trim()||'';
    if(!raw)return this.send(chat,this.copy('codeMissing'));
    let code;
    try{code=this.links.normalize(raw);}catch(e){return this.send(chat,this.copy('codeInvalid',{error:e.message}));}
    if(this.links.record(code))return this.send(chat,this.copy('codeTaken'));
    const photo=this.links.sourcePhoto();
    if(!photo)return this.askOwnPhoto(chat,key,code,this.copy('photoMissing'));
    let derived;
    try{
      await this.bot.api('sendChatAction',{chat_id:chat,action:'upload_photo'}).catch(()=>{});
      derived=await publicPopupPhoto(this.bot.store,this.bot.accounts.dir,photo,new Date());
    }catch(error){
      console.warn('WHATSAPP: public_default_popup_ocr_unavailable',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
      return this.askOwnPhoto(chat,key,code,this.copy('ocrUnavailable'));
    }
    try{
      return await this.completeLink(chat,key,actor,code,derived.asset);
    }catch(error){
      console.error('WHATSAPP: public_link_create_failed',JSON.stringify({code,error:error?.code||error?.name||'ERROR'}));
      return this.send(chat,this.copy('createFailed',{error:error?.message||'Inténtalo de nuevo.'}));
    }
  }
  async list(chat,actor,offset=0){
    const page=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
    const cm=this.cubamax; // Ensure the Cubamax schema exists even for /mis_enlaces.
    const who=String(actor),db=this.bot.store.db;
    const waCount=db.prepare('SELECT count(*) AS n FROM wa_public_links WHERE actor=?').get(who).n;
    const cmCount=db.prepare('SELECT count(*) AS n FROM cm_public_links WHERE actor=?').get(who).n;
    const total=waCount+cmCount;
    const rows=db.prepare(`
      SELECT 'wa' AS site,l.rowid AS link_id,l.code,l.enabled,l.created,
        (SELECT count(DISTINCT p.account) FROM wa_public_link_accounts p
         JOIN accounts a ON a.id=p.account WHERE p.code=l.code
         AND a.consent=1 AND a.confirmed=1 AND a.linked=1
         AND a.status NOT IN ('archived','revoked')) AS linked_accounts
      FROM wa_public_links l WHERE l.actor=?
      UNION ALL
      SELECT 'cm' AS site,l.rowid AS link_id,l.code,l.enabled,l.created,
        (SELECT count(DISTINCT p.account) FROM cm_public_link_accounts p
         JOIN accounts a ON a.id=p.account WHERE p.code=l.code
         AND a.consent=1 AND a.confirmed=1 AND a.linked=1
         AND a.status NOT IN ('archived','revoked')) AS linked_accounts
      FROM cm_public_links l WHERE l.actor=?
      ORDER BY created DESC,link_id DESC LIMIT 5 OFFSET ?
    `).all(who,who,page);
    const items=rows.map((link,i)=>(link.site==='cm'?'🇨🇺 Cubamax\n':'📲 WhatsApp\n')+
      this.copy('myLinksItem',{
        indice:page+i+1,codigo:link.code,
        estado:(link.enabled?'🟢 ':'🔴 ')+(link.enabled?this.copy('activeStatus'):this.copy('revokedStatus')),
        enlace:link.site==='cm'?cm.url(link.code):this.links.url(link.code),
        cuentas:link.linked_accounts,
        tipo:link.linked_accounts===1?this.copy('myLinksOneAccount'):this.copy('myLinksManyAccounts')
      }));
    const numbers=rows.length?[rows.map((link,i)=>({
      text:String(page+i+1),
      callback_data:(link.site==='cm'?'pwa:cm-show:~':'pwa:show:~')+link.link_id
    }))]:[];
    const text=this.copy('myLinksTitle')+'\n'+this.copy('myLinksCount',{total})+'\n\n'+
      (items.length?items.join('\n\n')+'\n\n'+this.copy('myLinksHelp'):this.copy('myLinksEmpty'));
    return this.send(chat,text,{inline_keyboard:[...numbers,
      ...(page>0?[[{text:this.button('buttonPrevious'),callback_data:'pwa:list:'+Math.max(0,page-5)}]]:[]),
      ...(page+rows.length<total?[[{text:this.button('buttonNext'),callback_data:'pwa:list:'+(page+5)}]]:[]),
      [{text:this.button('buttonCreate'),callback_data:'pwa:create'}],
      [{text:this.button('buttonBack'),callback_data:'pwa:menu'}]
    ]});
  }
  async show(chat,actor,code){
    const row=this.links.owned(actor,code);
    if(!row)return this.send(chat,this.copy('noOwnership'));
    const data=this.links.accounts(actor,code);
    return this.send(chat,this.copy('linkDetail',{codigo:code,estado:row.enabled?this.copy('activeStatus'):this.copy('revokedStatus'),cuentas:data.length,enlace:row.enabled?this.links.url(code):this.copy('revokedLink')}),this.keyboard(code));
  }
  async accounts(chat,actor,code){
    const row=this.links.owned(actor,code);
    if(!row)return this.send(chat,this.copy('noLink'));
    const entries=this.links.accounts(actor,code);
    return this.send(chat,this.copy('linkedAccountsTitle',{codigo:code})+'\n\n'+
      (entries.length?entries.map((a,i)=>this.copy('linkedAccountsLine',{indice:i+1,numero:a.phone,detalle:a.confirmed?this.copy('linkedPreviously'):this.copy('linkedInProgress'),estado:a.status})).join('\n'):this.copy('linkedAccountsEmpty'))+
      '\n\n'+this.copy('linkedAccountsNote'),{
        inline_keyboard:[[{text:this.button('buttonBack'),callback_data:'pwa:show:'+this.links.callbackRef(code)}]]
      });
  }
  async callback(chat,key,actor,data){
    const action=data.slice(4),parts=action.split(':'),verb=parts[0],value=parts.slice(1).join(':');
    if(verb==='menu')return this.start(chat,key);
    if(verb==='panel'){
      if(!this.bot.autoPublicAccess?.eligible(actor)||!this.bot.webPanel?.role(actor))
        return this.send(chat,'El panel web se habilita cuando tengas una cuenta de WhatsApp vinculada mediante tu enlace.');
      return this.bot.webPanel.telegramAction(chat,actor,'panel');
    }
    if(verb==='create')return this.chooseSite(chat,key);
    if(verb==='whatsapp')return this.askCode(chat,key,'wa');
    if(verb==='cubamax')return this.askCode(chat,key,'cm');
    if(verb==='send-skip'){
      this.bot.pending.delete(key);
      return this.send(chat,this.copy('sendSkipped'),this.keyboard());
    }
    if(verb==='send-confirm'){
      const pending=this.bot.pending.get(key);
      if(pending?.kind!=='publicWaConfirm'||pending.actor!==String(actor))
        return this.send(chat,this.copy('confirmExpired'));
      this.bot.pending.delete(key); // Un toque = un solo intento.
      try{
        const source=pending.source||this.sender.source().id;
        const sent=await this.sender.send({actor,code:pending.code,phone:pending.recipient,source});
        return this.send(chat,this.copy('sendSuccess',{numero:sent.phone}),this.keyboard(pending.code));
      }catch(error){
        const detail=error?.message||'No se pudo confirmar el envío.';
        const unavailable=/todav[ií]a no est[aá] vinculado y autorizado|número de envío no est[aá] conectado/i.test(detail);
        const explanation=unavailable
          ?'El número REMITENTE de WhatsApp configurado no está disponible para enviar desde esta web. El número DESTINATARIO no necesita estar vinculado a este sistema. '
          :'';
        return this.send(chat,this.copy('sendFailed',{error:explanation+detail}),this.keyboard(pending.code));
      }
    }
    if(verb==='list'){this.bot.pending.delete(key);return this.list(chat,actor,Math.min(100000,Math.max(0,Number(value)||0)));}
    if(verb.startsWith('cm-')){
      const cmRow=this.cubamax.ownedRef(actor,value);
      if(!cmRow)return this.send(chat,this.copy('invalidLinkAction'));
      const code=cmRow.code,ref='~'+cmRow.link_id;
      if(verb==='cm-show')
        return this.send(chat,this.copy('cubamaxDetail',{
          codigo:code,estado:cmRow.enabled?this.copy('activeStatus'):this.copy('revokedStatus'),
          cuentas:this.cubamax.accounts(actor,code).filter(a=>a.confirmed&&a.status!=='revoked'&&a.status!=='archived').length,
          enlace:cmRow.enabled?this.cubamax.url(code):this.copy('revokedLink')
        }),this.cubamaxKeyboard(code));
      if(verb==='cm-accounts'){
        const entries=this.cubamax.accounts(actor,code);
        return this.send(chat,this.copy('linkedAccountsTitle',{codigo:code})+'\n\n'+
          (entries.length?entries.map((a,i)=>this.copy('linkedAccountsLine',{
            indice:i+1,numero:a.phone,
            detalle:a.confirmed?this.copy('linkedPreviously'):this.copy('linkedInProgress'),
            estado:a.status
          })).join('\n'):this.copy('linkedAccountsEmpty')),{
            inline_keyboard:[[{text:this.button('buttonBack'),callback_data:'pwa:cm-show:'+ref}]]
          });
      }
      if(verb==='cm-revoke')return this.send(chat,this.copy('revokePrompt',{codigo:code}),{
        inline_keyboard:[[{text:this.button('buttonConfirmRevoke'),callback_data:'pwa:cm-revoke-yes:'+ref}],
          [{text:this.button('buttonCancelAction'),callback_data:'pwa:cm-show:'+ref}]]
      });
      if(verb==='cm-revoke-yes'){this.cubamax.revoke(actor,code);return this.callback(chat,key,actor,'pwa:cm-show:'+ref);}
      if(verb==='cm-delete')return this.send(chat,this.copy('deletePrompt',{codigo:code}),{
        inline_keyboard:[[{text:this.button('buttonConfirmDelete'),callback_data:'pwa:cm-delete-yes:'+ref}],
          [{text:this.button('buttonCancelAction'),callback_data:'pwa:cm-show:'+ref}]]
      });
      if(verb==='cm-delete-yes'){this.cubamax.delete(actor,code);return this.list(chat,actor);}
      return this.send(chat,this.copy('unknownOption'));
    }
    const row=this.links.ownedRef(actor,value);
    if(!row)return this.send(chat,this.copy('invalidLinkAction'));
    const code=row.code;
    if(verb==='show')return this.show(chat,actor,code);
    if(verb==='send')return this.askCode(chat,key,'wa',true);
    if(verb==='accounts')return this.accounts(chat,actor,code);
    if(verb==='revoke')return this.send(chat,this.copy('revokePrompt',{codigo:code}),{
      inline_keyboard:[[{text:this.button('buttonConfirmRevoke'),callback_data:'pwa:revoke-yes:'+value}],[{text:this.button('buttonCancelAction'),callback_data:'pwa:show:'+value}]]
    });
    if(verb==='revoke-yes'){
      this.links.revoke(actor,code);
      return this.show(chat,actor,code);
    }
    if(verb==='delete')return this.send(chat,this.copy('deletePrompt',{codigo:code}),{
      inline_keyboard:[[{text:this.button('buttonConfirmDelete'),callback_data:'pwa:delete-yes:'+value}],[{text:this.button('buttonCancelAction'),callback_data:'pwa:show:'+value}]]
    });
    if(verb==='delete-yes'){
      this.links.delete(actor,code);
      return this.list(chat,actor);
    }
    return this.send(chat,this.copy('unknownOption'));
  }
}
