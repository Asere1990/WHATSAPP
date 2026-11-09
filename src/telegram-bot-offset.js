// Telegram update IDs are specific to each bot, not to the WhatsApp database.
// Only the two Telegram-specific config keys below change during a bot swap.
export function ensureTelegramBotOffset(store,botId){
  const id=String(botId??'');
  if(!/^[1-9]\d{0,19}$/.test(id))throw Error('Identidad del bot de Telegram no válida.');
  const config=store.config();
  const previous=String(config.telegram_bot_id||'');
  if(previous!==id){
    // Reset FIRST. If the process stops between these writes, a restart
    // will reset again instead of accidentally using the previous bot's offset.
    store.setConfig('telegram_offset','0');
    store.setConfig('telegram_bot_id',id);
    return {offset:0,changed:previous!==''};
  }
  const current=Number(config.telegram_offset||0);
  return {offset:Number.isSafeInteger(current)&&current>=0?current:0,changed:false};
}
