#!/usr/bin/env python3
"""
Badminton receipt bot — reads court booking photos sent to a Telegram group,
OCRs them with Claude, and saves the booking + image to Firebase.

Requirements:
    pip install pyTelegramBotAPI anthropic requests

Environment variables (set in .env or your server):
    TELEGRAM_BOT_TOKEN   — from @BotFather
    ANTHROPIC_API_KEY    — from console.anthropic.com
    FIREBASE_URL         — e.g. https://your-db.firebasedatabase.app
    ALLOWED_CHAT_ID      — Telegram group chat ID (optional, restricts to one group)
"""

import base64
import io
import json
import logging
import os
import re
from datetime import datetime, timedelta, date

import anthropic
import requests
import telebot
from telebot import types

try:
    from PIL import Image
except ImportError:  # Pillow missing — bot still works, images just stay full size
    Image = None

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
ALLOWED_CHAT_ID = os.environ.get("ALLOWED_CHAT_ID")  # optional
ALLOWED_TOPICS = set(
    int(x.strip()) for x in os.environ.get("ALLOWED_TOPICS", "").split(",") if x.strip()
) if os.environ.get("ALLOWED_TOPICS") else None
# Optional: Firebase database secret so the bot keeps write access once the
# database rules are locked down to authenticated users only
FIREBASE_SECRET = os.environ.get("FIREBASE_SECRET")


def fb_url(path: str) -> str:
    url = f"{FIREBASE_URL}/{path}"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
    return url

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

OCR_PROMPT = """Extract badminton court booking details from this receipt image. Return ONLY a valid JSON object, no markdown, no explanation.

{
  "is_receipt": "true ONLY if this image is an actual booking confirmation, payment receipt or programme registration receipt — false for anything else",
  "date": "MM-DD (single booking) OR null if recurring weekly",
  "start_date": "MM-DD OR null if single booking",
  "end_date": "MM-DD OR null if single booking",
  "start_time": "HH:MM (24-hour)",
  "end_time": "HH:MM (24-hour)",
  "venue_text": "sports hall name only",
  "court_no": "court number(s), joined with ' & ' when the booking covers several courts",
  "class_type": "ActiveSG",
  "coach_ids": [],
  "students": ["EVERY participant name if the receipt lists participants, else null"],
  "notes": "any extra details"
}

Rules — follow these exactly:

0. IS THIS A RECEIPT? Set "is_receipt" to true only for genuine booking
   confirmations, payment receipts or programme registration receipts (e.g.
   ActiveSG booking screens). Training posters, class announcements, schedules,
   flyers, chat screenshots, group photos or anything else → "is_receipt": false
   and leave every other field null.

1. DATES: Output only MM-DD (month and day, no year). The year will be calculated separately.
   - Single booking → set "date" as MM-DD, leave start_date and end_date null
   - Recurring weekly programme with a date range → set start_date and end_date as MM-DD, leave date null

2. TIME SLOTS: ActiveSG receipts list individual 1-hour slots (e.g. "3:00 pm", "4:00 pm"), each with its own court. The slots may be printed in any order. Merge them into one block:
   - start_time = the EARLIEST slot time
   - end_time = the LATEST slot time + 1 hour
   - Example: slots at 3pm and 4pm → start_time="15:00", end_time="17:00"
   - Example: slots at 4pm and 5pm → start_time="16:00", end_time="18:00"
   - Example: slots at 10am, 11am, 12pm → start_time="10:00", end_time="13:00"
   - Example: single slot at 7pm → start_time="19:00", end_time="20:00"
   - The slots may be on DIFFERENT courts (e.g. "4:00 pm Court 05" and "5:00 pm Court 06").
     Still merge into one block: court_no lists every distinct court joined with " & "
     (e.g. "05 & 06"), and notes must spell out which court covers which hour
     (e.g. "Court 05: 4-5pm, Court 06: 5-6pm").

3. VENUE: Use the message caption first if provided, then fall back to the receipt. Extract the specific location/branch name
   (e.g. "Bukit Canberra Sport Hall", "Bishan Clubhouse", "Clementi Sport Hall") — not the full address, and NOT a generic
   facility/room type. ActiveSG receipts often show both a facility type ("Indoor Sports Hall", "Badminton Court") and the
   actual branch/location name — always prefer the branch/location name, never the generic facility type.

4. STUDENTS: Programme receipts often include a participant list (S/N + names).
   Extract EVERY participant name, in order, into the "students" array. If the
   receipt registers a single participant, return an array with that one name.
   For court booking receipts leave it null.

5. Return ONLY the JSON object."""


def parse_mm_dd(value: str) -> tuple[int, int]:
    """Accept 'MM-DD' or 'YYYY-MM-DD' and return (month, day)."""
    parts = value.split("-")
    if len(parts) == 3:
        parts = parts[1:]
    month, day = map(int, parts)
    return month, day


def fix_year(mm_dd: str) -> str:
    """Given a MM-DD string, return YYYY-MM-DD using whichever year is the first future date."""
    if not mm_dd:
        return mm_dd
    try:
        today = date.today()
        month, day = parse_mm_dd(mm_dd)
        candidate = date(today.year, month, day)
        if candidate < today:
            candidate = date(today.year + 1, month, day)
        return candidate.strftime("%Y-%m-%d")
    except Exception as e:
        log.error("fix_year failed for %s: %s", mm_dd, e)
        return mm_dd


def fix_year_range(start_mm_dd: str, end_mm_dd: str) -> tuple[str, str]:
    """Resolve a MM-DD date range. The end date gets the first future year;
    the start date is anchored to the end date (a recurring programme may
    have already started, so the start can be in the past)."""
    end_full = fix_year(end_mm_dd)
    try:
        end_d = datetime.strptime(end_full, "%Y-%m-%d").date()
        month, day = parse_mm_dd(start_mm_dd)
        start_d = date(end_d.year, month, day)
        if start_d > end_d:
            start_d = date(end_d.year - 1, month, day)
        return start_d.strftime("%Y-%m-%d"), end_full
    except Exception as e:
        log.error("fix_year_range failed for %s..%s: %s", start_mm_dd, end_mm_dd, e)
        return start_mm_dd, end_full


def build_ocr_prompt(caption: str = "") -> str:
    prompt = OCR_PROMPT
    if caption:
        prompt += f"\n\nMessage caption (use for venue and context):\n{caption}"
    return prompt


def extract_booking_from_image(image_bytes: bytes, mime_type: str = "image/jpeg", caption: str = "") -> dict | None:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    try:
        response = claude.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": build_ocr_prompt(caption)},
                    ],
                }
            ],
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        result = json.loads(raw)

        # The model sometimes returns multiple courts as a list — the planner
        # expects one string joined with " & "
        if isinstance(result.get("court_no"), list):
            result["court_no"] = " & ".join(str(c) for c in result["court_no"])

        # Resolve MM-DD fields to full YYYY-MM-DD
        if result.get("date"):
            result["date"] = fix_year(result["date"])
        if result.get("start_date") and result.get("end_date"):
            result["start_date"], result["end_date"] = fix_year_range(
                result["start_date"], result["end_date"]
            )

        log.info("OCR result: %s", json.dumps(result))
        return result
    except Exception as e:
        log.error("OCR failed: %s", e)
        return None


def save_booking_to_firebase(booking: dict) -> str | None:
    try:
        r = requests.post(
            fb_url("bot_sessions.json"),
            json=booking,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("name")
    except Exception as e:
        log.error("Firebase booking save failed: %s", e)
        return None


def calculate_weekly_dates(start_date_str: str, end_date_str: str) -> list[str]:
    try:
        start = datetime.strptime(start_date_str, "%Y-%m-%d")
        end = datetime.strptime(end_date_str, "%Y-%m-%d")
        dates = []
        current = start
        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(weeks=1)
        return dates
    except Exception as e:
        log.error("Date calculation failed: %s", e)
        return []


def downscale_image(image_bytes: bytes) -> tuple[bytes, str]:
    """Re-encode a receipt photo as a compact JPEG (max 1280px, quality 80).

    Cuts storage and download size several-fold with no visible loss for
    receipts. Returns (bytes, mime_type); on any failure — or if the
    re-encode isn't actually smaller — returns the original bytes.
    """
    if Image is None:
        return image_bytes, "image/jpeg"
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((1280, 1280))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=80, optimize=True)
        small = out.getvalue()
        if len(small) < len(image_bytes):
            log.info("Image downscaled %d -> %d bytes", len(image_bytes), len(small))
            return small, "image/jpeg"
        return image_bytes, "image/jpeg"
    except Exception as e:
        log.warning("Image downscale failed, keeping original: %s", e)
        return image_bytes, "image/jpeg"


def save_image_to_firebase(key: str, image_bytes: bytes, mime_type: str = "image/jpeg") -> bool:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    try:
        r = requests.put(
            fb_url(f"booking_images/{key}.json"),
            json={"data": b64, "mime_type": mime_type},
            timeout=30,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("Firebase image save failed: %s", e)
        return False


def reply(message: types.Message, text: str) -> None:
    """Reply in the chat; never let a reply failure break processing."""
    try:
        bot.reply_to(message, text)
    except Exception as e:
        log.warning("Reply failed: %s", e)


def fmt_time(hhmm: str) -> str:
    """'16:00' → '4pm', '09:30' → '9:30am'."""
    try:
        h, m = map(int, hhmm.split(":"))
        ap = "pm" if h >= 12 else "am"
        h12 = h % 12 or 12
        return f"{h12}:{m:02d}{ap}" if m else f"{h12}{ap}"
    except Exception:
        return hhmm or "?"


def fmt_date(yyyy_mm_dd: str) -> str:
    """'2026-07-23' → 'Thu 23 Jul 2026'."""
    try:
        d = datetime.strptime(yyyy_mm_dd, "%Y-%m-%d")
        return d.strftime("%a %-d %b %Y")
    except Exception:
        return yyyy_mm_dd or "?"


# ── REFUNDS ───────────────────────────────────────────────────
# ActiveSG can refund a booking, so /refund walks through picking the court
# and records it: the payment row is kept but marked refunded (so it stops
# counting toward what the booker is owed) and the lesson block is cancelled.

# (chat_id, user_id) -> what we're waiting for. In-memory: a restart just
# means the person starts the flow again.
refund_pending: dict = {}


def fb_get(path: str, default=None):
    try:
        r = requests.get(fb_url(f"{path}.json"), timeout=15)
        r.raise_for_status()
        data = r.json()
        return default if data is None else data
    except Exception as e:
        log.error("Firebase read %s failed: %s", path, e)
        return default


def fb_patch(path: str, value: dict) -> bool:
    try:
        r = requests.patch(fb_url(f"{path}.json"), json=value, timeout=15)
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("Firebase patch %s failed: %s", path, e)
        return False


def parse_ddmmyy(text: str):
    """'141126' or '14-11-2026' -> '2026-11-14'. Returns None if unreadable."""
    digits = re.sub(r"\D", "", text or "")
    if len(digits) == 6:
        d, m, y = int(digits[:2]), int(digits[2:4]), 2000 + int(digits[4:])
    elif len(digits) == 8:
        d, m, y = int(digits[:2]), int(digits[2:4]), int(digits[4:])
    else:
        return None
    try:
        return date(y, m, d).strftime("%Y-%m-%d")
    except ValueError:
        return None


def bookings_on(day: str) -> list:
    """Court bookings for a date, newest payment first, refunded ones last."""
    out = []
    for key, b in (fb_get("bookings", {}) or {}).items():
        if not b or not b.get("booker"):
            continue
        if (b.get("court_date") or b.get("date")) == day:
            out.append((key, b))
    out.sort(key=lambda kb: (bool(kb[1].get("refunded")),
                             str(kb[1].get("venue") or ""), str(kb[1].get("court") or "")))
    return out


def pending_on(day: str, known: list) -> list:
    """Receipts for a date the website hasn't imported into /bookings yet.

    The bot writes receipts to /bot_sessions; the planner turns them into
    payment rows only while someone has the site open. A refund shouldn't
    have to wait for that.
    """
    seen = {bk.get("bot_sessions_key") for _, bk in known}
    out = []
    for key, s in (fb_get("bot_sessions", {}) or {}).items():
        if not s or key in seen:
            continue
        if s.get("date") != day or not s.get("booker"):
            continue
        if s.get("students") or s.get("student_name"):
            continue  # programme roster, not a court booking
        if s.get("refunded"):
            continue
        out.append((key, s))
    out.sort(key=lambda ks: (str(ks[1].get("venue_text") or ""), str(ks[1].get("court_no") or "")))
    return out


def session_as_booking(key: str, s: dict) -> dict:
    """The payment row the website would have created for this receipt."""
    return {
        "date": s.get("date"), "court_date": s.get("date"),
        "time": f"{s.get('start_time') or ''}-{s.get('end_time') or ''}",
        "venue": s.get("venue_text") or "", "court": s.get("court_no") or "",
        "class_type": s.get("class_type") or "ActiveSG", "source": "activesg",
        "color": s.get("color") or "#f59e0b", "status": s.get("status") or "scheduled",
        "coach_ids": s.get("coach_ids") or [], "notes": s.get("notes") or "",
        "booker": s.get("booker"), "payment_date": s.get("payment_date") or s.get("date"),
        "venue_type": s.get("venue_type") or "sports_hall", "slots": s.get("slots") or 1,
        "bot_sessions_key": key,
    }


def booking_label(b: dict) -> str:
    start, _, end = str(b.get("time") or "").partition("-")
    when = f"{fmt_time(start)}–{fmt_time(end)}" if start and end else (b.get("time") or "")
    court = f" Ct {b['court']}" if b.get("court") else ""
    mark = "↩️ " if b.get("refunded") else ""
    return f"{mark}{b.get('venue') or 'Unknown venue'}{court} · {when}"


def matching_blocks(b: dict) -> list:
    """(key, instance) for every lesson block in this booking's slot."""
    day = b.get("court_date") or b.get("date")
    start, _, end = str(b.get("time") or "").partition("-")
    venue = str(b.get("venue") or "").strip().lower()
    node = fb_get("instances", {}) or {}
    items = node.items() if isinstance(node, dict) else enumerate(node)
    return [(str(k), inst) for k, inst in list(items)
            if inst and inst.get("date") == day
            and str(inst.get("start_time") or "") == start
            and str(inst.get("end_time") or "") == end
            and str(inst.get("venue_text") or "").strip().lower() == venue]


def cancel_blocks_for(b: dict) -> dict:
    """Cancel this booking's lesson block(s); returns {key: status before}."""
    before = {}
    for k, inst in matching_blocks(b):
        prev = inst.get("status") or "scheduled"   # read before the write
        if prev == "cancelled":
            continue
        if fb_patch(f"instances/{k}", {"status": "cancelled"}):
            before[k] = prev
    return before


def restore_blocks_for(b: dict) -> int:
    """Put back exactly the blocks this refund cancelled."""
    saved = b.get("refund_blocks")
    done = 0
    if isinstance(saved, dict) and saved:
        for k, prev in saved.items():
            if fb_patch(f"instances/{k}", {"status": prev or "scheduled"}):
                done += 1
        return done
    # Refunded before we recorded which blocks were cancelled: fall back to the
    # slot, and only revive blocks that are actually cancelled
    for k, inst in matching_blocks(b):
        if inst.get("status") == "cancelled" and fb_patch(f"instances/{k}", {"status": "scheduled"}):
            done += 1
    return done


def refund_allowed(message: types.Message) -> bool:
    return not ALLOWED_CHAT_ID or str(message.chat.id) == ALLOWED_CHAT_ID


@bot.message_handler(commands=["refund"])
def cmd_refund(message: types.Message) -> None:
    if not refund_allowed(message):
        return
    refund_pending[(message.chat.id, message.from_user.id)] = {"step": "date"}
    reply(message, "Which date was the court booked for?\n"
                   "Send it as DDMMYY — e.g. 141126 for 14 Nov 2026.\n"
                   "Send /cancel to stop.")


@bot.message_handler(commands=["undorefund"])
def cmd_undorefund(message: types.Message) -> None:
    if not refund_allowed(message):
        return
    refund_pending[(message.chat.id, message.from_user.id)] = {"step": "undo_date"}
    reply(message, "Which date was the refunded court booked for?\n"
                   "Send it as DDMMYY — e.g. 141126 for 14 Nov 2026.\n"
                   "Send /cancel to stop.")


@bot.message_handler(commands=["cancel"])
def cmd_cancel(message: types.Message) -> None:
    if refund_pending.pop((message.chat.id, message.from_user.id), None):
        reply(message, "Refund cancelled.")


@bot.message_handler(
    func=lambda m: (m.chat.id, m.from_user.id) in refund_pending,
    content_types=["text"])
def refund_date_reply(message: types.Message) -> None:
    state = refund_pending.get((message.chat.id, message.from_user.id))
    if not state or state.get("step") not in ("date", "undo_date"):
        return
    undo = state["step"] == "undo_date"
    day = parse_ddmmyy(message.text)
    if not day:
        reply(message, "I couldn't read that date. Send six digits, DDMMYY — "
                       "e.g. 141126 for 14 Nov 2026. Or /cancel.")
        return
    rows = bookings_on(day)
    if undo:
        rows = [(k, b) for k, b in rows if b.get("refunded")]
    if not rows and (undo or not pending_on(day, rows)):
        refund_pending.pop((message.chat.id, message.from_user.id), None)
        reply(message, (f"No refunds recorded for {fmt_date(day)}." if undo
                        else f"No court bookings found for {fmt_date(day)}."))
        return
    prefix = "ur" if undo else "rf"
    kb = types.InlineKeyboardMarkup()
    for key, b in rows:
        kb.add(types.InlineKeyboardButton(booking_label(b), callback_data=f"{prefix}:{key}"))
    if not undo:
        for key, sess in pending_on(day, rows):
            kb.add(types.InlineKeyboardButton(
                booking_label(session_as_booking(key, sess)) + " · new",
                callback_data=f"rf:s:{key}"))
    kb.add(types.InlineKeyboardButton("✖️ Cancel", callback_data=f"{prefix}:x"))
    refund_pending.pop((message.chat.id, message.from_user.id), None)
    bot.send_message(message.chat.id,
                     (f"Refunds recorded on {fmt_date(day)} — which should I undo?" if undo
                      else f"Courts booked on {fmt_date(day)} — which was refunded?"),
                     reply_markup=kb,
                     message_thread_id=getattr(message, "message_thread_id", None))


@bot.callback_query_handler(func=lambda c: (c.data or "").startswith("rf:"))
def refund_chosen(call) -> None:
    key = (call.data or "")[3:]
    if key == "x":
        bot.answer_callback_query(call.id, "Cancelled")
        bot.edit_message_text("Refund cancelled.", call.message.chat.id, call.message.message_id)
        return
    # "s:<key>" is a receipt the website hasn't imported yet: create its payment
    # row now (marked refunded) and stop the importer making a lesson for it
    if key.startswith("s:"):
        skey = key[2:]
        sess = fb_get(f"bot_sessions/{skey}")
        if not sess:
            bot.answer_callback_query(call.id, "That receipt is gone")
            bot.edit_message_text("That receipt no longer exists.",
                                  call.message.chat.id, call.message.message_id)
            return
        who = call.from_user.full_name if call.from_user else "unknown"
        row = session_as_booking(skey, sess)
        row.update(refunded=True, refunded_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
                   refunded_by=who, refund_preimport=True)
        try:
            r = requests.post(fb_url("bookings.json"), json=row, timeout=15)
            r.raise_for_status()
        except Exception as e:
            log.error("Refund of pending receipt %s failed: %s", skey, e)
            bot.answer_callback_query(call.id, "Couldn't save")
            bot.edit_message_text("Couldn't record that refund — please try again.",
                                  call.message.chat.id, call.message.message_id)
            return
        fb_patch(f"bot_sessions/{skey}", {"refunded": True, "imported": True})
        log.info("Refund recorded for pending receipt %s by %s", skey, who)
        bot.answer_callback_query(call.id, "Refund recorded")
        bot.edit_message_text(
            f"↩️ Refund recorded\n{booking_label(row)}\n"
            f"Booker: {row.get('booker') or '—'}\n"
            f"It won't be charged to them, and no lesson will be added to the "
            f"schedule.\nUndo with /undorefund.",
            call.message.chat.id, call.message.message_id)
        return

    b = fb_get(f"bookings/{key}")
    if not b:
        bot.answer_callback_query(call.id, "That booking is gone")
        bot.edit_message_text("That booking no longer exists.",
                              call.message.chat.id, call.message.message_id)
        return
    if b.get("refunded"):
        bot.answer_callback_query(call.id, "Already refunded")
        bot.edit_message_text(f"{booking_label(b)} was already recorded as refunded.",
                              call.message.chat.id, call.message.message_id)
        return
    who = call.from_user.full_name if call.from_user else "unknown"
    # Cancel first so the booking can record exactly what was cancelled
    cancelled = cancel_blocks_for(b)
    ok = fb_patch(f"bookings/{key}", {
        "refunded": True,
        "refunded_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "refunded_by": who,
        "refund_blocks": cancelled or None,
    })
    if not ok:
        bot.answer_callback_query(call.id, "Couldn't save")
        bot.edit_message_text("Couldn't record that refund — please try again.",
                              call.message.chat.id, call.message.message_id)
        return
    log.info("Refund recorded for %s by %s (%d block(s) cancelled)", key, who, len(cancelled))
    note = ("\nLesson block cancelled on the schedule." if cancelled
            else "\nNo matching lesson block found on the schedule.")
    bot.answer_callback_query(call.id, "Refund recorded")
    bot.edit_message_text(
        f"↩️ Refund recorded\n{booking_label(b)}\n"
        f"Booker: {b.get('booker') or '—'}\n"
        f"It no longer counts toward what they're owed.{note}\n"
        f"Undo with /undorefund.",
        call.message.chat.id, call.message.message_id)


@bot.callback_query_handler(func=lambda c: (c.data or "").startswith("ur:"))
def undo_refund_chosen(call) -> None:
    key = (call.data or "")[3:]
    if key == "x":
        bot.answer_callback_query(call.id, "Cancelled")
        bot.edit_message_text("No change made.", call.message.chat.id, call.message.message_id)
        return
    b = fb_get(f"bookings/{key}")
    if not b:
        bot.answer_callback_query(call.id, "That booking is gone")
        bot.edit_message_text("That booking no longer exists.",
                              call.message.chat.id, call.message.message_id)
        return
    if not b.get("refunded"):
        bot.answer_callback_query(call.id, "Not refunded")
        bot.edit_message_text(f"{booking_label(b)} isn't marked as refunded.",
                              call.message.chat.id, call.message.message_id)
        return
    restored = restore_blocks_for(b)
    # Refunded before the website ever imported it: let the importer run now so
    # the lesson appears, instead of restoring a block that was never created
    preimport = bool(b.get("refund_preimport"))
    bkey = b.get("bot_sessions_key")
    if bkey:
        fb_patch(f"bot_sessions/{bkey}",
                 {"refunded": None, **({"imported": None} if preimport else {})})
    # null clears the field in Firebase
    ok = fb_patch(f"bookings/{key}", {"refunded": None, "refunded_at": None,
                                      "refunded_by": None, "refund_blocks": None,
                                      "refund_preimport": None})
    if not ok:
        bot.answer_callback_query(call.id, "Couldn't save")
        bot.edit_message_text("Couldn't undo that refund — please try again.",
                              call.message.chat.id, call.message.message_id)
        return
    who = call.from_user.full_name if call.from_user else "unknown"
    log.info("Refund undone for %s by %s (%d block(s) restored)", key, who, restored)
    note = ("\nLesson block put back on the schedule." if restored
            else ("\nThe lesson will appear once the planner website is opened."
                  if preimport else "\nNo lesson block needed restoring."))
    bot.answer_callback_query(call.id, "Refund undone")
    bot.edit_message_text(
        f"↩️ Refund undone\n{booking_label(b).lstrip('↩️ ')}\n"
        f"Booker: {b.get('booker') or '—'}\n"
        f"It counts toward what they're owed again.{note}",
        call.message.chat.id, call.message.message_id)


@bot.message_handler(content_types=['photo'])
def handle_photo(message: types.Message) -> None:
    chat_id = str(message.chat.id)

    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        log.info("Ignoring message from chat %s", chat_id)
        return

    topic_id = getattr(message, 'message_thread_id', None) or 0
    sender = message.from_user.full_name if message.from_user else "unknown"
    log.info("📸 Photo from %s | Topic ID: %s | Chat: %s", sender, topic_id, chat_id)

    if ALLOWED_TOPICS and topic_id not in ALLOWED_TOPICS:
        log.info("❌ Ignoring — topic %s not in ALLOWED_TOPICS", topic_id)
        return

    caption = message.caption or message.text or ""
    log.info("Caption: %s", caption or "(none)")

    if not message.photo:
        return

    photo = message.photo[-1]
    try:
        file_info = bot.get_file(photo.file_id)
        image_bytes = bot.download_file(file_info.file_path)
    except Exception as e:
        log.error("Failed to download photo: %s", e)
        return

    image_bytes, mime_type = downscale_image(image_bytes)

    booking = extract_booking_from_image(image_bytes, mime_type, caption=caption)
    if not booking:
        log.warning("Could not extract booking from photo sent by %s", sender)
        reply(message, "⚠️ Couldn't read this receipt — please add the booking manually.")
        return

    # Not a receipt at all (poster, announcement, random photo) — stay silent
    if str(booking.get("is_receipt")).lower() == "false":
        log.info("Ignoring non-receipt image from %s", sender)
        return
    booking.pop("is_receipt", None)

    # Programme receipts (date range / participant list) need a caption for
    # context — without one, ignore the image silently
    is_programme = bool((booking.get("start_date") and booking.get("end_date")) or booking.get("students"))
    if is_programme and not caption.strip():
        log.info("Ignoring programme receipt from %s — no caption", sender)
        return

    booking.setdefault("class_type", "ActiveSG")
    booking.setdefault("coach_ids", [])
    booking.setdefault("color", "#f59e0b")
    booking.setdefault("status", "scheduled")
    booking.setdefault("notes", "")

    if booking.get("date") and not (booking.get("start_date") and booking.get("end_date")):
        # Court receipt: attach the payment-record fields Booking Records uses
        # to total what each booker is owed (court cost + incentive).
        # The booker is whoever posted the photo in the group.
        booking["booker"] = message.from_user.full_name if message.from_user else None
        booking.pop("students", None)  # roster autofill is for programme receipts only
        booking["payment_date"] = date.today().strftime("%Y-%m-%d")
        venue = booking.get("venue_text") or ""
        booking["venue_type"] = "school" if re.search(r"school|primary|secondary", venue, re.I) else "sports_hall"
        try:
            sh, sm = map(int, (booking.get("start_time") or "0:0").split(":"))
            eh, em = map(int, (booking.get("end_time") or "0:0").split(":"))
            booking["slots"] = max(1, round(((eh * 60 + em) - (sh * 60 + sm)) / 60))
        except Exception:
            booking["slots"] = 1

    bookings_to_save = []

    if booking.get("start_date") and booking.get("end_date"):
        dates = calculate_weekly_dates(booking["start_date"], booking["end_date"])
        if dates:
            log.info("Recurring: %d sessions from %s to %s", len(dates), booking["start_date"], booking["end_date"])
            for date_str in dates:
                b = booking.copy()
                b["date"] = date_str
                b.pop("start_date", None)
                b.pop("end_date", None)
                bookings_to_save.append(b)
        else:
            log.warning("Failed to calculate weekly dates")
            reply(message, "⚠️ Read the receipt but couldn't work out the weekly dates — please add the booking manually.")
            return
    else:
        if not booking.get("date"):
            log.warning("No date found in receipt")
            reply(message, "⚠️ Couldn't find a date on this receipt — please add the booking manually.")
            return
        bookings_to_save = [booking]

    saved = 0
    receipt_key = None  # the receipt image is stored under the first entry's key
    for i, b in enumerate(bookings_to_save):
        if receipt_key:
            b["receipt_key"] = receipt_key
        log.info("Saving booking for %s: %s–%s at %s", b.get("date"), b.get("start_time"), b.get("end_time"), b.get("venue_text"))
        key = save_booking_to_firebase(b)
        if not key:
            log.error("Failed to save booking for date %s", b.get("date"))
            continue
        saved += 1
        log.info("Saved with key: %s", key)

        if i == 0:
            receipt_key = key
            if save_image_to_firebase(key, image_bytes, mime_type):
                log.info("Image saved to booking_images/%s", key)
            else:
                log.warning("Image upload failed for key %s", key)

    times = f"{fmt_time(booking.get('start_time'))}–{fmt_time(booking.get('end_time'))}"
    venue = booking.get("venue_text") or "unknown venue"
    court = f" (Court {booking['court_no']})" if booking.get("court_no") else ""
    if saved == 0:
        reply(message, "⚠️ Read the receipt but couldn't save it — please try again or add the booking manually.")
    elif len(bookings_to_save) > 1:
        first, last = bookings_to_save[0]["date"], bookings_to_save[-1]["date"]
        note = "" if saved == len(bookings_to_save) else f" ({len(bookings_to_save) - saved} failed to save)"
        student = f"\nStudents: {len(booking['students'])}" if booking.get("students") else ""
        reply(message, f"✅ Saved {saved} weekly sessions: {times} — {venue}{court}\n{fmt_date(first)} to {fmt_date(last)}{note}{student}")
    else:
        who = f"\nBooker: {booking['booker']}" if booking.get("booker") else ""
        reply(message, f"✅ Saved: {fmt_date(booking['date'])}, {times} — {venue}{court}{who}")


def main() -> None:
    try:
        bot.delete_webhook()
        log.info("Webhook deleted (if it existed)")
    except Exception as e:
        log.warning("Webhook deletion: %s", e)

    log.info("Bot started — listening for photos")
    bot.infinity_polling()


if __name__ == "__main__":
    main()
