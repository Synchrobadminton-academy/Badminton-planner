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

if os.environ.get("PARENT_BOT_TOKEN"):
    import parent_bot

    threading.Thread(target=receipt_bot.main, daemon=True).start()
    log.info("Receipt bot running in background thread; starting parent bot")
    parent_bot.main()
else:
    log.info("PARENT_BOT_TOKEN not set — running receipt bot only")
    receipt_bot.main()
