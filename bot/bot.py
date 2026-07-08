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
import json
import logging
import os
import re
from datetime import datetime

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
ALLOWED_CHAT_ID = os.environ.get("ALLOWED_CHAT_ID")  # optional
ALLOWED_TOPICS = set(
    int(x.strip()) for x in os.environ.get("ALLOWED_TOPICS", "").split(",") if x.strip()
) if os.environ.get("ALLOWED_TOPICS") else None

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)


def build_ocr_prompt(caption: str = "") -> str:
    year = datetime.now().year
    prompt = f"""Extract badminton court booking details from this receipt image. Return ONLY a valid JSON object, no markdown, no explanation.

{{
  "date": "YYYY-MM-DD (single booking) OR null if recurring weekly",
  "start_date": "YYYY-MM-DD OR null if single booking",
  "end_date": "YYYY-MM-DD OR null if single booking",
  "start_time": "HH:MM (24-hour)",
  "end_time": "HH:MM (24-hour)",
  "venue_text": "sports hall name only",
  "court_no": "court number(s)",
  "class_type": "ActiveSG",
  "coach_ids": [],
  "notes": "any extra details"
}}

Rules — follow these exactly:

1. YEAR: Receipts never print the year. ALWAYS use {year} for every date. Never use any other year regardless of what you see.

2. TIME SLOTS: ActiveSG receipts list individual 1-hour slots (e.g. "3:00 pm", "4:00 pm"). These are consecutive bookings in one block. Merge them:
   - start_time = the EARLIEST slot time
   - end_time = the LATEST slot time + 1 hour
   - Example: slots at 3pm and 4pm → start_time="15:00", end_time="17:00"
   - Example: slots at 4pm and 5pm → start_time="16:00", end_time="18:00"
   - Example: slots at 10am, 11am, 12pm → start_time="10:00", end_time="13:00"
   - Example: single slot at 7pm → start_time="19:00", end_time="20:00"

3. VENUE: Use the message caption first if provided, then fall back to the receipt. Extract ONLY the sports hall name (e.g. "Bukit Canberra Sport Hall", "Clementi Sport Hall") — not the full address.

4. RECURRING: If the receipt shows a date range for a weekly programme, set start_date and end_date (leave date null). Otherwise set date only.

5. Return ONLY the JSON object."""

    if caption:
        prompt += f"\n\nMessage caption (use for venue and context):\n{caption}"
    return prompt


def extract_booking_from_image(image_bytes: bytes, mime_type: str = "image/jpeg", caption: str = "") -> dict | None:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    try:
        response = claude.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
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
        log.info("OCR result: %s", json.dumps(result))
        return result
    except Exception as e:
        log.error("OCR failed: %s", e)
        return None


def save_booking_to_firebase(booking: dict) -> str | None:
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


def calculate_weekly_dates(start_date_str: str, end_date_str: str) -> list[str]:
    try:
        start = datetime.strptime(start_date_str, "%Y-%m-%d")
        end = datetime.strptime(end_date_str, "%Y-%m-%d")
        dates = []
        current = start
        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current = current.replace(day=current.day + 7) if False else \
                      datetime.fromtimestamp(current.timestamp() + 7 * 86400)
        return [d for d in dates if datetime.strptime(d, "%Y-%m-%d") <= end]
    except Exception as e:
        log.error("Date calculation failed: %s", e)
        return []


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
        return

    booking.setdefault("class_type", "ActiveSG")
    booking.setdefault("coach_ids", [])
    booking.setdefault("color", "#f59e0b")
    booking.setdefault("status", "scheduled")
    booking.setdefault("notes", "")

    bookings_to_save = []

    if booking.get("start_date") and booking.get("end_date"):
        dates = calculate_weekly_dates(booking["start_date"], booking["end_date"])
        if dates:
            log.info("Recurring: %d sessions from %s to %s", len(dates), booking["start_date"], booking["end_date"])
            for date in dates:
                b = booking.copy()
                b["date"] = date
                b.pop("start_date", None)
                b.pop("end_date", None)
                bookings_to_save.append(b)
        else:
            log.warning("Failed to calculate weekly dates")
            return
    else:
        if not booking.get("date"):
            log.warning("No date found in receipt")
            return
        bookings_to_save = [booking]

    for i, b in enumerate(bookings_to_save):
        log.info("Saving booking for %s: %s–%s at %s", b.get("date"), b.get("start_time"), b.get("end_time"), b.get("venue_text"))
        key = save_booking_to_firebase(b)
        if not key:
            log.error("Failed to save booking for date %s", b.get("date"))
            continue
        log.info("Saved with key: %s", key)

        if i == 0:
            if save_image_to_firebase(key, image_bytes):
                log.info("Image saved to booking_images/%s", key)
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
