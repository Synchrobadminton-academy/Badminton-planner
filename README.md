# 🏸 Badminton Planner

Coach manpower planner for Synchro Badminton Academy, with automated court-booking
capture from Telegram.

## How it all fits together

```
Telegram group  ──photo──▶  Bot (Railway)  ──save──▶  Firebase RTDB  ──poll──▶  Website (GitHub Pages)
                                │                                                    │
                                └── replies ✅/⚠️ in chat                            └── Schedule / Courts / Dashboard
```

1. Someone posts a court receipt photo in the Telegram group.
2. The bot (`bot/bot.py`, running 24/7 on Railway) reads it with Claude:
   date, merged time slots, venue, court. It saves the booking to
   `/bot_sessions` and the image to `/booking_images` in Firebase, then
   replies in the chat with ✅ (details) or ⚠️ (couldn't read it).
3. The website polls `/bot_sessions` every 15 seconds while open, creates the
   session on the Schedule, a Courts record with the receipt image, and marks
   the entry imported. Verified writes + self-healing: an entry is only marked
   imported after its writes are confirmed, and future-dated entries whose
   session went missing are re-imported.

## Branches — what lives where

| Branch | Contents | Deploys to |
|---|---|---|
| `claude/coach-manpower-planner-ljm5yx` (default) | Telegram bot (`bot/bot.py`), `Procfile`, `requirements.txt` | **Railway** (auto-deploy on push) |
| `gh-pages` | The website: `planner.html` (app), `index.html` (redirect) | **GitHub Pages** → https://engtwu999-boop.github.io/Badminton-planner/planner.html |

Push to the default branch → Railway redeploys the bot.
Push to `gh-pages` → GitHub Pages redeploys the website.

## Bot configuration (Railway environment variables)

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `FIREBASE_URL` | Realtime Database URL (has a default) |
| `ALLOWED_CHAT_ID` | Optional: restrict to one group chat |
| `ALLOWED_TOPICS` | Optional: comma-separated topic IDs to accept photos from |

## Firebase data layout

| Path | Written by | Read by |
|---|---|---|
| `/bot_sessions` | Bot | Website importer (flags `imported: true` after processing) |
| `/booking_images` | Bot | Website (Courts receipt viewer) |
| `/sessions`, `/instances` | Website | Website (schedule data) |
| `/bookings` | Website | Website (Courts / Booking Records / Receipts) |
| `/coaches`, `/venues`, `/attendance`, … | Website | Website |

## Maintenance workflows (Actions tab → run manually)

- **fb-diagnostic** — dumps a summary of Firebase state (pending bot entries,
  session/instance counts) into the workflow log for debugging.
- **fb-cleanup** — one-off janitor: prunes orphan sessions and flags unusable
  bot entries so they don't sit in the import queue.
