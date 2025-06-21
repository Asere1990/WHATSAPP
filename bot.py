import os
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton

# Leer variables desde el entorno
TOKEN = os.environ.get("TOKEN")
CHAT_ID = os.environ.get("CHAT_ID")
IMAGE_URL = os.environ.get("IMAGE_URL")

bot = telebot.TeleBot(TOKEN)

# ✅ Botonera para el canal
def botonera_para_canal():
    markup = InlineKeyboardMarkup(row_width=1)
    markup.add(
        InlineKeyboardButton("🔐𝐃𝐄𝐒𝐁𝐋𝐎𝐐𝐔𝐄𝐀𝐑🔐", url="https://t.me/share/url?url=https://t.me/jineteras"),
        InlineKeyboardButton("¿𝐂𝐨́𝐦𝐨 𝐝𝐞𝐬𝐛𝐥𝐨𝐪𝐮𝐞𝐚𝐫?", url="https://t.me/jinetera_bot?start=como_desbloquear")
    )
    return markup

# ✅ Botonera para el chat privado
def botonera_para_privado():
    markup = InlineKeyboardMarkup(row_width=1)
    markup.add(
        InlineKeyboardButton("🔐𝐃𝐄𝐒𝐁𝐋𝐎𝐐𝐔𝐄𝐀𝐑🔐", url="https://t.me/share/url?url=https://t.me/jineteras"),
        InlineKeyboardButton("¿𝐂𝐨́𝐦𝐨 𝐝𝐞𝐬𝐛𝐥𝐨𝐪𝐮𝐞𝐚𝐫?", callback_data="mostrar_popup")
    )
    return markup

# 📤 Publicar imagen en el canal
bot.send_photo(
    chat_id=CHAT_ID,
    photo=IMAGE_URL,
    caption="🇨🇺𝐂𝐀𝐍𝐀𝐋 𝐏𝐑𝐈𝐕𝐀𝐃𝐎 𝐏𝐀𝐑𝐀 𝐀𝐃𝐔𝐋𝐓𝐎𝐒🔞",
    reply_markup=botonera_para_canal()
)

print("✅ Imagen publicada en el canal con botones")

# 📩 Responder cuando alguien entra en privado
@bot.message_handler(commands=['start'])
def start_handler(message):
    if 'como_desbloquear' in message.text:
        bot.send_photo(
            chat_id=message.chat.id,
            photo=IMAGE_URL,
            caption="🇨🇺𝐂𝐀𝐍𝐀𝐋 𝐏𝐑𝐈𝐕𝐀𝐃𝐎 𝐏𝐀𝐑𝐀 𝐀𝐃𝐔𝐋𝐓𝐎𝐒🔞",
            reply_markup=botonera_para_privado()
        )

# 🔔 Mostrar popup en privado
@bot.callback_query_handler(func=lambda call: call.data == "mostrar_popup")
def mostrar_popup(call):
    bot.answer_callback_query(
        callback_query_id=call.id,
        text="Presione DESBLOQUEAR y seleccione 3 GRANDES GRUPOS.",
        show_alert=True
    )

# 🟢 Escuchando mensajes
bot.polling()
