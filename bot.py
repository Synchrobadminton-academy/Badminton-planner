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
    ALLOWED_TOPICS       — comma-separated topic IDs to accept images from (optional)
"""

import base64
import json
import logging
import os
import re

import anthropic
import requests
import telebot
from telebot import types

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
ALLOWED_CHAT_ID = os.environ.get("ALLOWED_CHAT_ID")
ALLOWED_TOPICS = set(
    int(x.strip()) for x in os.environ.get("ALLOWED_TOPICS", "").split(",") if x.strip()
) if os.environ.get("ALLOWED_TOPICS") else None

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

# ──────────────────────────────────────────────────────────────────────────────
# OCR prompt — detects receipt type and extracts appropriate fields
# ──────────────────────────────────────────────────────────────────────────────
OCR_PROMPT = """Identify which receipt type this is, then extract the fields below.
Return ONLY valid JSON — no markdown, no extra text.

────────────────────────────────────────────────────────
RECEIPT TYPE 1: court_booking
  Identified by: an ActiveSG court PAYMENT RECEIPT (activesg.gov.sg) with
  a "BOOKING DETAILS" section showing What / Where / When / Who, plus a
  "PAYMENT RECEIPT" section with dollar amounts.

  Return:
  {
    "receipt_type": "court_booking",
    "date": "YYYY-MM-DD",
    "venue_text": "sports hall name only, e.g. 'Bukit Canberra Sport Hall'",
    "slots": [
      {"start_time": "HH:MM", "end_time": "HH:MM", "court_no": "e.g. 01"}
    ],
    "total_amount": "total paid as a string, e.g. '7.00'",
    "receipt_ref": "reference number at the bottom, e.g. 'SSC20260627RC01890316'",
    "notes": ""
  }

  Rules for court_booking:
  - slots: list EVERY time slot in the "When" section (there may be 2 or more).
    Each slot is 1 hour unless the receipt shows otherwise; infer end_time = start_time + 1 hour.
  - venue_text: use the hall/centre name from "Where", NOT the full address.
  - total_amount: the final "Total:" value excluding currency symbol.

────────────────────────────────────────────────────────
RECEIPT TYPE 2: programme_roster
  Identified by: a spreadsheet/table showing Programme Name, Programme ID,
  Programme Date (a range), Programme Time, Service Provider, and a list of
  Participants. Usually sent with a Telegram caption that gives the specific
  session dates, venue, courts, and class type.

  Return:
  {
    "receipt_type": "programme_roster",
    "programme_name": "full programme name from the spreadsheet",
    "start_date": "YYYY-MM-DD  (from Programme Date range)",
    "end_date":   "YYYY-MM-DD  (from Programme Date range)",
    "start_time": "HH:MM  (from Programme Time or caption)",
    "end_time":   "HH:MM  (from Programme Time or caption)",
    "venue_text": "venue from caption (e.g. 'Bishan Clubhouse'), or from spreadsheet if no caption",
    "court_no": "court(s) from caption, e.g. '1 & 2'",
    "class_type": "class type from caption, e.g. 'ActiveSG (Advance)'",
    "notes": ""
  }

  Rules for programme_roster:
  - Caption ALWAYS takes priority over spreadsheet for venue, court, class type, times.
  - start_date / end_date come from the Programme Date range in the spreadsheet.
  - If year is missing anywhere, use 2026.
  - Times: convert to 24-hour HH:MM (e.g. 4:00 pm → 16:00).

────────────────────────────────────────────────────────
General rules:
- Return ONLY JSON, no markdown fences.
- If you cannot determine the receipt type, return {"receipt_type": "unknown"}.
"""


def extract_booking_from_image(
    image_bytes: bytes, mime_type: str = "image/jpeg", caption: str = ""
) -> dict | None:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    try:
        prompt = OCR_PROMPT
        if caption:
            prompt += f"\n\nTelegram caption (authoritative for venue/dates/court/class type):\n{caption}"

        response = claude.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=768,
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
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        return json.loads(raw)
    except Exception as e:
        log.error("OCR failed: %s", e)
        return None


def save_booking_to_firebase(booking: dict) -> str | None:
    """POST a single booking entry to Firebase bot_sessions; returns the generated key."""
    try:
        r = requests.post(
            f"{FIREBASE_URL}/bot_sessions.json",
            json=booking,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("name")
    except Exception as e:
        log.error("Firebase booking save failed: %s", e)
        return None


def save_image_to_firebase(key: str, image_bytes: bytes, mime_type: str = "image/jpeg") -> bool:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    try:
        r = requests.put(
            f"{FIREBASE_URL}/booking_images/{key}.json",
            json={"data": b64, "mime_type": mime_type},
            timeout=30,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("Firebase image save failed: %s", e)
        return False


def calculate_weekly_dates(start_date_str: str, end_date_str: str) -> list[str]:
    """Return all dates at 7-day intervals from start_date to end_date (inclusive)."""
    from datetime import datetime, timedelta
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


def build_bookings(booking: dict) -> list[dict]:
    """
    Convert the raw OCR result into a flat list of Firebase-ready booking dicts.

    Type 1 (court_booking):   one entry per slot on the same date.
    Type 2 (programme_roster): one entry per weekly session date.
    """
    receipt_type = booking.get("receipt_type", "unknown")
    bookings = []

    if receipt_type == "court_booking":
        date = booking.get("date")
        slots = booking.get("slots") or []

        if not date:
            log.warning("court_booking: no date found — skipping")
            return []
        if not slots:
            log.warning("court_booking: no slots found — skipping")
            return []

        for slot in slots:
            start_time = slot.get("start_time")
            end_time = slot.get("end_time")
            if not start_time or not end_time:
                log.warning("court_booking: slot missing time, skipping: %s", slot)
                continue
            bookings.append({
                "receipt_type": "court_booking",
                "date": date,
                "start_time": start_time,
                "end_time": end_time,
                "court_no": slot.get("court_no", ""),
                "venue_text": booking.get("venue_text", ""),
                "total_amount": booking.get("total_amount", ""),
                "receipt_ref": booking.get("receipt_ref", ""),
                "class_type": "Court Booking",
                "coach_ids": [],
                "color": "#ef4444",
                "status": "scheduled",
                "notes": booking.get("notes", ""),
            })

    elif receipt_type == "programme_roster":
        start_date = booking.get("start_date")
        end_date = booking.get("end_date")
        start_time = booking.get("start_time")
        end_time = booking.get("end_time")
        venue_text = booking.get("venue_text", "")

        if not (start_date and end_date and start_time and end_time):
            log.warning("programme_roster: missing required date/time fields — skipping")
            return []

        dates = calculate_weekly_dates(start_date, end_date)
        if not dates:
            log.warning("programme_roster: failed to calculate session dates")
            return []

        log.info(
            "programme_roster: %d sessions from %s to %s",
            len(dates), start_date, end_date,
        )
        for date in dates:
            bookings.append({
                "receipt_type": "programme_roster",
                "date": date,
                "start_time": start_time,
                "end_time": end_time,
                "court_no": booking.get("court_no", ""),
                "venue_text": venue_text,
                "class_type": booking.get("class_type", "ActiveSG"),
                "programme_name": booking.get("programme_name", ""),
                "coach_ids": [],
                "color": "#f59e0b",
                "status": "scheduled",
                "notes": booking.get("notes", ""),
            })

    else:
        log.warning("Unknown receipt_type: %s — skipping", receipt_type)

    return bookings


@bot.message_handler(content_types=["photo"])
def handle_photo(message: types.Message) -> None:
    chat_id = str(message.chat.id)

    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        log.info("Ignoring message from chat %s", chat_id)
        return

    topic_id = getattr(message, "message_thread_id", None) or 0
    sender = message.from_user.full_name if message.from_user else "unknown"
    log.info("📸 Photo from %s | Topic ID: %s | Chat: %s", sender, topic_id, chat_id)

    if ALLOWED_TOPICS and topic_id not in ALLOWED_TOPICS:
        log.info("❌ Ignoring — topic %s not in ALLOWED_TOPICS", topic_id)
        return

    caption = message.caption or message.text or ""
    log.info("Caption: %s", caption)

    if not message.photo:
        return

    photo = message.photo[-1]
    try:
        file_info = bot.get_file(photo.file_id)
        image_bytes = bot.download_file(file_info.file_path)
    except Exception as e:
        log.error("Failed to download photo: %s", e)
        return

    raw = extract_booking_from_image(image_bytes, caption=caption)
    if not raw:
        log.warning("OCR returned nothing for photo from %s", sender)
        return

    log.info("OCR result: %s", json.dumps(raw))

    bookings_to_save = build_bookings(raw)
    if not bookings_to_save:
        log.warning("No bookings to save after processing OCR result")
        return

    first_key: str | None = None
    for i, b in enumerate(bookings_to_save):
        log.info("Saving [%d/%d] %s: %s", i + 1, len(bookings_to_save), b.get("date"), json.dumps(b))
        key = save_booking_to_firebase(b)
        if not key:
            log.error("Firebase save failed for date %s", b.get("date"))
            continue

        log.info("Saved with key: %s", key)

        # Store the image once, linked to the first booking's key
        if first_key is None:
            first_key = key
            saved = save_image_to_firebase(key, image_bytes)
            if saved:
                log.info("Image stored at booking_images/%s", key)
            else:
                log.warning("Image upload failed for key %s", key)


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
