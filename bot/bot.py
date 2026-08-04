#!/usr/bin/env python3
"""
Badminton receipt bot — reads court booking photos sent to a Telegram group,
OCRs them with Claude, and saves the booking + image to Firebase.

Also posts "weekly meeting fun facts" to the group once a week (and on demand
via /funfacts) — see fun_facts.py.

Requirements:
    pip install pyTelegramBotAPI anthropic requests

Environment variables (set in .env or your server):
    TELEGRAM_BOT_TOKEN   — from @BotFather
    ANTHROPIC_API_KEY    — from console.anthropic.com
    FIREBASE_URL         — e.g. https://your-db.firebasedatabase.app
    ALLOWED_CHAT_ID      — Telegram group chat ID (optional, restricts to one group)
    FUN_FACTS_CHAT_ID    — chat for the weekly fun-facts post (default: ALLOWED_CHAT_ID)
    FUN_FACTS_TOPIC_ID   — optional topic (thread) ID for the weekly post
    FUN_FACTS_DAY        — weekday of the weekly post, mon/tue/… (default mon)
    FUN_FACTS_TIME       — time of the weekly post, 24h SGT (default 09:00)
"""

import base64
import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta, date

import anthropic
import requests
import telebot
from telebot import types

import fun_facts

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
# Weekly meeting fun facts: where the scheduled post goes. Defaults to the
# allowed group chat; without a chat id the schedule is off (/funfacts still works).
FUN_FACTS_CHAT_ID = os.environ.get("FUN_FACTS_CHAT_ID") or ALLOWED_CHAT_ID
FUN_FACTS_TOPIC_ID = os.environ.get("FUN_FACTS_TOPIC_ID")


def fb_url(path: str) -> str:
    url = f"{FIREBASE_URL}/{path}"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
    return url

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

OCR_PROMPT = """Extract badminton court booking details from this receipt image. Return ONLY a valid JSON object, no markdown, no explanation.

{
  "date": "MM-DD (single booking) OR null if recurring weekly",
  "start_date": "MM-DD OR null if single booking",
  "end_date": "MM-DD OR null if single booking",
  "start_time": "HH:MM (24-hour)",
  "end_time": "HH:MM (24-hour)",
  "venue_text": "sports hall name only",
  "court_no": "court number(s)",
  "class_type": "ActiveSG",
  "coach_ids": [],
  "students": ["EVERY participant name if the receipt lists participants, else null"],
  "notes": "any extra details"
}

Rules — follow these exactly:

1. DATES: Output only MM-DD (month and day, no year). The year will be calculated separately.
   - Single booking → set "date" as MM-DD, leave start_date and end_date null
   - Recurring weekly programme with a date range → set start_date and end_date as MM-DD, leave date null

2. TIME SLOTS: ActiveSG receipts list individual 1-hour slots (e.g. "3:00 pm", "4:00 pm"). These are consecutive — merge them into one block:
   - start_time = the EARLIEST slot time
   - end_time = the LATEST slot time + 1 hour
   - Example: slots at 3pm and 4pm → start_time="15:00", end_time="17:00"
   - Example: slots at 4pm and 5pm → start_time="16:00", end_time="18:00"
   - Example: slots at 10am, 11am, 12pm → start_time="10:00", end_time="13:00"
   - Example: single slot at 7pm → start_time="19:00", end_time="20:00"

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


@bot.message_handler(commands=["funfacts", "funfact"])
def handle_funfacts(message: types.Message) -> None:
    """On-demand fun facts, e.g. pulled up live during the weekly meeting."""
    if ALLOWED_CHAT_ID and str(message.chat.id) != ALLOWED_CHAT_ID:
        log.info("Ignoring /funfacts from chat %s", message.chat.id)
        return
    log.info("/funfacts requested by %s", message.from_user.full_name if message.from_user else "unknown")
    try:
        reply(message, fun_facts.build_fun_facts())
    except Exception as e:
        log.error("/funfacts failed: %s", e)
        reply(message, "⚠️ Couldn't put the fun facts together — please try again in a minute.")


def send_fun_facts(text: str) -> None:
    """Deliver the scheduled weekly post to the configured group chat/topic."""
    kwargs = {"message_thread_id": int(FUN_FACTS_TOPIC_ID)} if FUN_FACTS_TOPIC_ID else {}
    bot.send_message(int(FUN_FACTS_CHAT_ID), text, **kwargs)


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

    booking = extract_booking_from_image(image_bytes, caption=caption)
    if not booking:
        log.warning("Could not extract booking from photo sent by %s", sender)
        reply(message, "⚠️ Couldn't read this receipt — please add the booking manually.")
        return

    # Programme receipts (date range / participant list) need a caption for
    # context — without one, ignore the image entirely
    is_programme = bool((booking.get("start_date") and booking.get("end_date")) or booking.get("students"))
    if is_programme and not caption.strip():
        log.info("Ignoring programme receipt from %s — no caption", sender)
        reply(message, "Programme image not recorded")
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
            if save_image_to_firebase(key, image_bytes):
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

    if FUN_FACTS_CHAT_ID:
        threading.Thread(target=fun_facts.scheduler_loop, args=(send_fun_facts,), daemon=True).start()
        log.info("Fun facts scheduler started (chat %s)", FUN_FACTS_CHAT_ID)
    else:
        log.info("Fun facts scheduler off — no FUN_FACTS_CHAT_ID or ALLOWED_CHAT_ID set")

    log.info("Bot started — listening for photos")
    bot.infinity_polling()


if __name__ == "__main__":
    main()
