#!/usr/bin/env python3
"""
Runs the Telegram bots in one Railway worker:
- the receipt bot (bot.py)              — always
- the parent lesson-info bot            — when PARENT_BOT_TOKEN is set
- the ballot request bot (ballot_bot.py)— when BALLOT_BOT_TOKEN is set

Each bot needs its OWN token from @BotFather; sharing one token makes Telegram
reject both with 409 Conflict, so duplicates are dropped with a clear error.
"""

import logging
import os
import threading

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

import bot as receipt_bot

receipt_token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
runners = [("receipt bot", receipt_bot.main)]
seen = {receipt_token}


def add_bot(env_var: str, label: str, import_module):
    token = (os.environ.get(env_var) or "").strip()
    if not token:
        log.info("%s not set — %s not running", env_var, label)
        return
    if token in seen:
        log.error(
            "%s is the SAME token as another bot — %s needs its own bot from "
            "@BotFather (/newbot). Skipping it.", env_var, label
        )
        return
    try:
        module = import_module()
    except Exception as e:
        log.error("Could not start %s: %s", label, e)
        return
    seen.add(token)
    runners.append((label, module.main))


def _parent():
    import parent_bot
    return parent_bot


def _ballot():
    import ballot_bot
    return ballot_bot


add_bot("PARENT_BOT_TOKEN", "parent bot", _parent)
add_bot("BALLOT_BOT_TOKEN", "ballot bot", _ballot)

# Run every bot but the last in its own thread; the last one holds the process open
for label, run in runners[:-1]:
    threading.Thread(target=run, daemon=True, name=label).start()
    log.info("%s running in background thread", label)

log.info("Starting %s in the main thread", runners[-1][0])
runners[-1][1]()
