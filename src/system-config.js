import defaults from './system-config.json' with {type:'json'};
export function systemPhone(store){return store.config().system_phone||defaults.phone;}
export function isSystemAccount(store,account){return !!account&&account.phone===systemPhone(store);}
