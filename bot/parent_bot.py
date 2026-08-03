#!/usr/bin/env python3
"""
Parent-facing lesson info bot — parents message it and it replies with the
venue and court of today's lessons (or the next upcoming ones), read from the
same Firebase data the planner uses.

Environment variables:
    PARENT_BOT_TOKEN — from @BotFather (a separate bot from the receipt bot)
    FIREBASE_URL     — Realtime Database URL (has a default)
    FIREBASE_SECRET  — optional, for locked-down database rules
"""

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
import telebot

log = logging.getLogger(__name__)

TZ = ZoneInfo("Asia/Singapore")
PARENT_BOT_TOKEN = os.environ["PARENT_BOT_TOKEN"]
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
FIREBASE_SECRET = os.environ.get("FIREBASE_SECRET")

bot = telebot.TeleBot(PARENT_BOT_TOKEN)


def fb_url(path: str) -> str:
    url = f"{FIREBASE_URL}/{path}"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
    return url


def get_lessons() -> list[dict]:
    r = requests.get(fb_url("instances.json"), timeout=15)
    r.raise_for_status()
    data = r.json() or []
    vals = data if isinstance(data, list) else list(data.values())
    return [i for i in vals if i and i.get("status") != "cancelled" and i.get("date")]


def fmt_time(hhmm: str) -> str:
    try:
        h, m = map(int, hhmm.split(":"))
        ap = "pm" if h >= 12 else "am"
        h12 = h % 12 or 12
        return f"{h12}:{m:02d}{ap}" if m else f"{h12}{ap}"
    except Exception:
        return hhmm or "?"


def fmt_date(dstr: str) -> str:
    try:
        return datetime.strptime(dstr, "%Y-%m-%d").strftime("%a %-d %b")
    except Exception:
        return dstr


def lesson_lines(lessons: list[dict]) -> str:
    lines = []
    for i in sorted(lessons, key=lambda x: x.get("start_time") or ""):
        court = f" — Court {i['court_no']}" if i.get("court_no") else ""
        venue = i.get("venue_text") or "venue TBC"
        lines.append(f"• {fmt_time(i.get('start_time'))}–{fmt_time(i.get('end_time'))}: {venue}{court}")
    return "\n".join(lines)


def build_answer() -> str:
    try:
        lessons = get_lessons()
    except Exception as e:
        log.error("parent bot: failed to load lessons: %s", e)
        return "Sorry, I couldn't check the schedule right now — please try again in a minute."

    today = datetime.now(TZ).date().isoformat()
    todays = [i for i in lessons if i["date"] == today]
    if todays:
        return f"📍 Today's lessons ({fmt_date(today)}):\n{lesson_lines(todays)}"

    upcoming = sorted({i["date"] for i in lessons if i["date"] > today})
    if upcoming:
        nxt = upcoming[0]
        nxt_lessons = [i for i in lessons if i["date"] == nxt]
        return (
            f"No lessons today.\n\n📍 Next lessons ({fmt_date(nxt)}):\n{lesson_lines(nxt_lessons)}"
        )
    return "No upcoming lessons are scheduled yet — please check back later."


@bot.message_handler(commands=["start", "help"])
def cmd_start(message):
    bot.reply_to(
        message,
        "Hi! I can tell you where lessons are held.\n\n"
        "Just send me any message (or /today) and I'll reply with today's "
        "lesson venue and court — or the next upcoming lesson if there's none today.",
    )


@bot.message_handler(commands=["today", "next", "where"])
def cmd_today(message):
    bot.reply_to(message, build_answer())


@bot.message_handler(func=lambda m: True, content_types=["text"])
def any_text(message):
    bot.reply_to(message, build_answer())


def main() -> None:
    try:
        bot.delete_webhook()
    except Exception:
        pass
    log.info("Parent bot started — answering lesson location questions")
    bot.infinity_polling()


if __name__ == "__main__":
    logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
    main()
