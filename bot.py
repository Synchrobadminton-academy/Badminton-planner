#!/usr/bin/env python3
"""
Badminton receipt bot — reads court booking photos sent to a Telegram group,
OCRs them with Claude, and saves the booking + image to Firebase.

Requirements:
    pip install python-telegram-bot anthropic requests

Environment variables (set in .env or your server):
    TELEGRAM_BOT_TOKEN   — from @BotFather
    ANTHROPIC_API_KEY    — from console.anthropic.com
    FIREBASE_URL         — e.g. https://your-db.firebasedatabase.app
    ALLOWED_CHAT_ID      — Telegram group chat ID (optional, restricts to one group)
"""

import asyncio
import base64
import json
import logging
import os
import re

import anthropic
import requests
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, filters

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
# Topic IDs to accept images from (comma-separated)
# e.g. ALLOWED_TOPICS="123,456"
ALLOWED_TOPICS = set(
    int(x.strip()) for x in os.environ.get("ALLOWED_TOPICS", "").split(",") if x.strip()
) if os.environ.get("ALLOWED_TOPICS") else None

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

OCR_PROMPT = """You are extracting badminton court booking details from a receipt image.

Return ONLY a JSON object with these exact keys (use null for anything not found):
{
  "court_date": "YYYY-MM-DD",
  "time": "e.g. 4pm, 4pm-6pm, 16:00",
  "slots": 1,
  "venue": "venue/location name",
  "court": "court number or name",
  "booker": "name of person who booked",
  "source": "receipt"
}

Rules:
- court_date must be in YYYY-MM-DD format
- slots = number of 1-hour time slots booked (e.g. 4pm-6pm = 2 slots)
- If the year is missing from the receipt, use the current year
- Return ONLY the JSON, no other text
"""


def extract_booking_from_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict | None:
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
                        {"type": "text", "text": OCR_PROMPT},
                    ],
                }
            ],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        return json.loads(raw)
    except Exception as e:
        log.error("OCR failed: %s", e)
        return None


def save_booking_to_firebase(booking: dict) -> str | None:
    """POST booking; returns the Firebase-generated key."""
    try:
        r = requests.post(
            f"{FIREBASE_URL}/bookings.json",
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


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = str(update.effective_chat.id)

    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        log.info("Ignoring message from chat %s", chat_id)
        return

    msg = update.message
    if not msg or not msg.photo:
        return

    topic_id = msg.message_thread_id or 0
    sender = msg.from_user.full_name if msg.from_user else "unknown"
    log.info("📸 Photo from %s | Topic ID: %s | Chat: %s", sender, topic_id, chat_id)

    # Filter by topic if configured
    if ALLOWED_TOPICS:
        if topic_id not in ALLOWED_TOPICS:
            log.info("❌ Ignoring — topic %s not in ALLOWED_TOPICS", topic_id)
            return

    # Download the highest-resolution version of the photo
    photo = msg.photo[-1]
    tg_file = await context.bot.get_file(photo.file_id)
    image_bytes = bytes(await tg_file.download_as_bytearray())

    # OCR
    booking = extract_booking_from_image(image_bytes)
    if not booking:
        log.warning("Could not extract booking from photo sent by %s", sender)
        return

    # Fill in the booker name from Telegram if not on the receipt
    if not booking.get("booker"):
        booking["booker"] = sender

    # Ensure source field is set correctly (non-activesg so planner imports it)
    booking["source"] = "receipt"

    log.info("Extracted booking: %s", json.dumps(booking))

    # Save booking
    key = save_booking_to_firebase(booking)
    if not key:
        log.error("Failed to save booking for %s", sender)
        return

    log.info("Booking saved with key: %s", key)

    # Save image alongside booking
    saved = save_image_to_firebase(key, image_bytes)
    if saved:
        log.info("Image saved to booking_images/%s", key)
    else:
        log.warning("Booking saved but image upload failed for key %s", key)


def main() -> None:
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    log.info("Bot started — listening for photos")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
