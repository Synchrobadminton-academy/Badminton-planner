#!/usr/bin/env python3
"""
Runs both Telegram bots in one Railway worker:
- the receipt bot (bot.py) — always
- the parent lesson-info bot (parent_bot.py) — only when PARENT_BOT_TOKEN is set
"""

import logging
import os
import threading

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

import bot as receipt_bot

parent_token = (os.environ.get("PARENT_BOT_TOKEN") or "").strip()

if parent_token and parent_token == os.environ.get("TELEGRAM_BOT_TOKEN", "").strip():
    log.error(
        "PARENT_BOT_TOKEN is the SAME token as TELEGRAM_BOT_TOKEN — the parent "
        "bot needs its own bot from @BotFather (/newbot). Running receipt bot only."
    )
    parent_token = ""

if parent_token:
    import parent_bot

    threading.Thread(target=receipt_bot.main, daemon=True).start()
    log.info("Receipt bot running in background thread; starting parent bot")
    parent_bot.main()
else:
    if not os.environ.get("PARENT_BOT_TOKEN"):
        log.info("PARENT_BOT_TOKEN not set — running receipt bot only")
    receipt_bot.main()
