import defaults from './system-config.json' with {type:'json'};
export function systemPhone(store){return store.config().system_phone||defaults.phone;}
export function isSystemAccount(store,account){return !!account&&account.phone===systemPhone(store);}

export function initializeSystemNumber(store){
  // Apply the owner's explicit selection once; later menu changes still persist.
  const revision='system_number_20261024_17868876115';
  if(store.config()[revision]!=='1'){
    store.setConfig('system_phone','17868876115');
    store.setConfig(revision,'1');
  }
  const account=store.all().find(a=>a.phone===systemPhone(store));
  store.setConfig('system_account',account?.consent?account.id:'');
  console.log('WHATSAPP: system_number_selected',JSON.stringify({account:account?.id||null,authorized:!!account?.consent}));
}
