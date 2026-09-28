#!/usr/bin/env python3
"""
Ballot request bot — posts the parents' ballot message with a ready-made
ActiveSG portal link, either on demand or automatically every week.

ActiveSG encodes each bookable hour in the link as `timeslot=<unix epoch ms>`
(Singapore time), plus an opaque `venueId` and `activityId` per venue/sport.
So 9am-11am is two timeslots: 09:00 and 10:00.

Weekly schedule (bookings open 14 days ahead, so it posts 14 days before):
    Saturday 3-5pm  and  Sunday 9-11am
Each morning it checks whether today + 14 days lands on one of those days and,
if so, posts that session's message to the configured group.

Commands:
    /ballot Date: Sunday, 11th Oct 2026     one-off message, posted in this chat
            Time: 9am to 11am
            Venue: Canberra Primary School (DUS)
    /ballot 11 Oct 2026, 9-11am, canberra   short form
    /next                    preview the next scheduled message without posting
    /schedule                show the weekly schedule and auto-post status
    /setschedule sat 3-5pm Canberra Primary School (DUS)
    /here                    post the weekly messages in this chat
    /autopost on | off
    /venues                  list known venues
    /addvenue <name> = <any ActiveSG ballot link for that venue>

Environment variables:
    BALLOT_BOT_TOKEN — from @BotFather (its own bot, not the receipt bot's token)
    FIREBASE_URL     — Realtime Database URL (has a default)
    FIREBASE_SECRET  — optional, for locked-down database rules
"""

import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import requests
import telebot

log = logging.getLogger(__name__)

TZ = ZoneInfo("Asia/Singapore")
BALLOT_BOT_TOKEN = os.environ["BALLOT_BOT_TOKEN"]
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
FIREBASE_SECRET = os.environ.get("FIREBASE_SECRET")
PORTAL_BASE = "https://activesg.gov.sg/facility-bookings/ballots/review"

bot = telebot.TeleBot(BALLOT_BOT_TOKEN)

# Seeded from the first ballot link; more are added with /addvenue
DEFAULT_VENUES = {
    "canberra primary school (dus)": {
        "name": "Canberra Primary School (DUS)",
        "venueId": "EhVMAAEMSQPdrpKw4yIaD",
        "activityId": "YLONatwvqJfikKOmB5N9U",
    }
}

# Mon=0 .. Sun=6.  A session with no venue_key is skipped until one is set.
DEFAULT_CONFIG = {
    "chat_id": None,
    "topic_id": None,        # forum topic (message_thread_id), None = normal group
    "autopost": False,
    "lead_days": 14,
    "post_hour": 9,          # local hour to post at
    "sessions": {
        "5": {"label": "Saturday", "start": 15, "end": 17,
              "venue_key": "canberra primary school (dus)"},
        "6": {"label": "Sunday", "start": 9, "end": 11,
              "venue_key": "canberra primary school (dus)"},
    },
}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DOW_ALIASES = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


# ── storage ───────────────────────────────────────────────────
def fb_url(path: str) -> str:
    url = f"{FIREBASE_URL}/{path}"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
    return url


def fb_get(path, default=None):
    try:
        r = requests.get(fb_url(f"{path}.json"), timeout=15)
        r.raise_for_status()
        data = r.json()
        return default if data is None else data
    except Exception as e:
        log.warning("ballot bot: read %s failed: %s", path, e)
        return default


def fb_put(path, value) -> bool:
    try:
        r = requests.put(fb_url(f"{path}.json"), json=value, timeout=15)
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("ballot bot: write %s failed: %s", path, e)
        return False


def load_venues() -> dict:
    venues = dict(DEFAULT_VENUES)
    for key, v in (fb_get("ballot_venues", {}) or {}).items():
        if v and v.get("venueId") and v.get("activityId"):
            venues[key] = v
    return venues


def load_config() -> dict:
    cfg = {**DEFAULT_CONFIG, "sessions": {k: dict(v) for k, v in DEFAULT_CONFIG["sessions"].items()}}
    stored = fb_get("ballot_config", {}) or {}
    for k, v in stored.items():
        if k == "sessions" and isinstance(v, dict):
            for dow, s in v.items():
                cfg["sessions"][str(dow)] = {**cfg["sessions"].get(str(dow), {}), **(s or {})}
        else:
            cfg[k] = v
    return cfg


def save_config(cfg: dict) -> bool:
    return fb_put("ballot_config", cfg)


# ── parsing ───────────────────────────────────────────────────
def parse_date(text: str):
    """Accepts '11 Oct 2026', '11th Oct', 'Oct 11 2026', '2026-10-11', '11/10/2026'."""
    s = re.sub(r"\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b\.?,?", " ", text, flags=re.I)
    s = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", s, flags=re.I).strip(" ,.")
    today = datetime.now(TZ)

    m = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        try:
            return datetime(y, mo, d, tzinfo=TZ)
        except ValueError:
            return None

    m = re.search(r"\b(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?\b", s)
    if m:  # day/month, Singapore order
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3) or 0)
        y = today.year if not y else (2000 + y if y < 100 else y)
        return _with_year_rollover(y, mo, d, bool(m.group(3)), today)

    m = re.search(r"\b(\d{1,2})\s+([a-z]{3,})\.?\s*(\d{4})?\b", s, re.I)   # 11 Oct 2026
    if m:
        mo = MONTHS.get(m.group(2)[:3].lower())
        if mo:
            return _with_year_rollover(int(m.group(3) or today.year), mo,
                                       int(m.group(1)), bool(m.group(3)), today)
    m = re.search(r"\b([a-z]{3,})\.?\s+(\d{1,2})\s*,?\s*(\d{4})?\b", s, re.I)  # Oct 11 2026
    if m:
        mo = MONTHS.get(m.group(1)[:3].lower())
        if mo:
            return _with_year_rollover(int(m.group(3) or today.year), mo,
                                       int(m.group(2)), bool(m.group(3)), today)
    return None


def _with_year_rollover(year, month, day, year_given, today):
    """A ballot is always for an upcoming date, so roll a bare date into next year."""
    try:
        dt = datetime(year, month, day, tzinfo=TZ)
    except ValueError:
        return None
    if not year_given and (dt.date() - today.date()).days < 0:
        try:
            dt = datetime(year + 1, month, day, tzinfo=TZ)
        except ValueError:
            return None
    return dt


def parse_time_range(text: str):
    """'9am to 11am', '9-11am', '0900-1100', '3-5pm' -> (start_hour, end_hour)."""
    s = text.lower().replace("–", "-").replace("—", "-")
    # 24-hour compact form first: 0900-1100, 1500 to 1700
    c = re.search(r"\b(\d{3,4})\s*(?:-|to|till|until)\s*(\d{3,4})\b", s)
    if c:
        sh, sm = divmod(int(c.group(1)), 100)
        eh, em = divmod(int(c.group(2)), 100)
        if sm or em or not (0 <= sh < 24 and 0 < eh <= 24) or eh <= sh:
            return None
        return sh, eh
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|till|until)\s*"
                  r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", s)
    if not m:
        return None
    sh, sm, sap, eh, em, eap = m.groups()
    sh, eh = int(sh), int(eh)
    if (sm and sm != "00") or (em and em != "00"):
        return None  # ActiveSG slots start on the hour
    if sap or eap or sh <= 12:
        eap = eap or sap
        sap = sap or eap
        if sap == "pm" and sh != 12: sh += 12
        if sap == "am" and sh == 12: sh = 0
        if eap == "pm" and eh != 12: eh += 12
        if eap == "am" and eh == 12: eh = 0
    if not (0 <= sh < 24 and 0 < eh <= 24) or eh <= sh:
        return None
    return sh, eh


# ── link + message ────────────────────────────────────────────
def timeslots(day: datetime, start_h: int, end_h: int) -> list:
    """One epoch-ms timeslot per bookable hour, e.g. 9-11am -> [09:00, 10:00]."""
    base = day.replace(hour=0, minute=0, second=0, microsecond=0)
    return [int((base + timedelta(hours=h)).timestamp() * 1000)
            for h in range(start_h, end_h)]


def build_portal_url(slots: list, venue: dict) -> str:
    qs = "&".join(f"timeslot={ms}" for ms in slots)
    return f"{PORTAL_BASE}?{qs}&venueId={venue['venueId']}&activityId={venue['activityId']}"


def ordinal(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def fmt_hour(h: int) -> str:
    return f"{(h % 12) or 12}{'am' if h < 12 else 'pm'}"


def compose(day: datetime, start_h: int, end_h: int, venue: dict) -> str:
    url = build_portal_url(timeslots(day, start_h, end_h), venue)
    return (
        "Hi Parents,Friends and family! 👋\n\n"
        "To keep our kids playing and active, we’re looking to secure badminton "
        "court slots for our upcoming class!\n\n"
        "Could a few of you kindly lend a hand with the ActiveSG ballot/booking "
        "for this slot?\n\n"
        f"Date: {day.strftime('%A')}, {ordinal(day.day)} {day.strftime('%b %Y')}\n"
        f"Time: {fmt_hour(start_h)} to {fmt_hour(end_h)}\n"
        f"Venue: {venue['name']}\n\n"
        f"Portal: {url}\n\n"
        "The more parents who drop in a ballot, the higher our chances of "
        "locking in the court for the kids!\n\n"
        "Thank you so much for your support! 🙏🏻✨"
    )


def ids_from_link(text: str):
    m = re.search(r"https?://\S+", text)
    if not m:
        return None
    q = parse_qs(urlparse(m.group(0)).query)
    vid, aid = (q.get("venueId") or [None])[0], (q.get("activityId") or [None])[0]
    return {"venueId": vid, "activityId": aid} if vid and aid else None


def venue_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower()).strip()


def find_venue(text: str, venues: dict):
    """Match the venue by name, most specific match first."""
    hay = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()
    generic = {"school", "primary", "secondary", "sport", "sports", "hall", "dus", "the", "centre"}
    best = None
    for key, v in venues.items():
        k = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", key.lower())).strip()
        words = [w for w in k.split() if w not in generic]
        probe = " ".join(words) or k
        if probe and probe in hay and (best is None or len(probe) > best[0]):
            best = (len(probe), v)
    return best[1] if best else None


def parse_request(text: str, venues: dict):
    """Returns ((day, start_h, end_h, venue), None) or (None, error_message)."""
    labelled = {}
    for line in text.splitlines():
        m = re.match(r"\s*(date|time|venue)\s*[:\-]\s*(.+)", line, re.I)
        if m:
            labelled[m.group(1).lower()] = m.group(2).strip()

    if labelled:
        date_s, time_s = labelled.get("date", ""), labelled.get("time", "")
        venue_s = labelled.get("venue", "")
    else:
        parts = [p.strip() for p in re.split(r"[,;]| {2,}", text) if p.strip()]
        date_s = next((p for p in parts if parse_date(p)), "")
        time_s = next((p for p in parts if parse_time_range(p)), "")
        venue_s = " ".join(p for p in parts if p not in (date_s, time_s))

    day = parse_date(date_s) or parse_date(text)
    if not day:
        return None, "I couldn't read the date. Try `Date: Sunday, 11th Oct 2026`."
    times = parse_time_range(time_s) or parse_time_range(text)
    if not times:
        return None, ("I couldn't read the time. Try `Time: 9am to 11am` "
                      "— whole hours only, ActiveSG slots start on the hour.")

    inline = ids_from_link(text)
    if inline:
        venue = {"name": venue_s.split("http")[0].strip(" -=") or "the venue", **inline}
    else:
        venue = find_venue(venue_s or text, venues)
        if not venue:
            known = ", ".join(sorted(v["name"] for v in venues.values())) or "none yet"
            return None, (f"I don't know that venue. Known: {known}.\n\n"
                          "Add it with `/addvenue <name> = <ActiveSG ballot link>`.")
    if (day.date() - datetime.now(TZ).date()).days < 0:
        return None, f"{day.strftime('%-d %b %Y')} is in the past — check the date."
    return (day, times[0], times[1], venue), None


# ── weekly auto-post ──────────────────────────────────────────
def next_occurrences(cfg: dict, venues: dict, count: int = 4) -> list:
    """Upcoming (post_date, session_day, session, venue) in chronological order."""
    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    lead = int(cfg.get("lead_days", 14))
    out = []
    for i in range(0, 60):
        target = today + timedelta(days=i + lead)
        s = (cfg.get("sessions") or {}).get(str(target.weekday()))
        if not s:
            continue
        v = venues.get(s.get("venue_key") or "")
        out.append((today + timedelta(days=i), target, s, v))
        if len(out) >= count:
            break
    return out


def send(chat_id, text, topic_id=None):
    """Send into a forum topic when one is configured, else the plain chat."""
    kwargs = {"disable_web_page_preview": True}
    if topic_id:
        kwargs["message_thread_id"] = int(topic_id)
    return bot.send_message(chat_id, text, **kwargs)


def post_session(chat_id, target: datetime, session: dict, venue: dict, topic_id=None) -> bool:
    text = compose(target, int(session["start"]), int(session["end"]), venue)
    try:
        send(chat_id, text, topic_id)
        return True
    except Exception as e:
        log.error("ballot bot: auto-post to chat %s topic %s failed: %s",
                  chat_id, topic_id, e)
        return False


def scheduler_loop():
    """Once a day, post the ballot for the session `lead_days` from now."""
    log.info("ballot bot: scheduler thread started")
    while True:
        try:
            cfg = load_config()
            now = datetime.now(TZ)
            if cfg.get("autopost") and cfg.get("chat_id") and now.hour >= int(cfg.get("post_hour", 9)):
                target = (now + timedelta(days=int(cfg.get("lead_days", 14)))).replace(
                    hour=0, minute=0, second=0, microsecond=0)
                s = (cfg.get("sessions") or {}).get(str(target.weekday()))
                if s and s.get("venue_key"):
                    stamp = target.strftime("%Y-%m-%d")
                    if not fb_get(f"ballot_posted/{stamp}"):
                        venue = load_venues().get(s["venue_key"])
                        if venue and post_session(cfg["chat_id"], target, s, venue,
                                                  cfg.get("topic_id")):
                            fb_put(f"ballot_posted/{stamp}", now.isoformat())
                            log.info("ballot bot: auto-posted ballot for %s", stamp)
                elif s:
                    log.info("ballot bot: %s session has no venue set — skipping",
                             s.get("label", target.strftime("%A")))
        except Exception as e:
            log.error("ballot bot: scheduler error: %s", e)
        time.sleep(900)  # 15 minutes


# ── commands ──────────────────────────────────────────────────
HELP = (
    "I write the parents' ballot message with the ActiveSG link built in.\n\n"
    "*One-off:*\n"
    "`/ballot 11 Oct 2026, 9-11am, canberra`\n"
    "or on separate lines with `Date:` / `Time:` / `Venue:`\n\n"
    "*Weekly (14 days ahead):*\n"
    "`/here` — post the weekly messages in this chat\n"
    "`/setschedule sat 3-5pm <venue>` — set the Saturday venue\n"
    "`/autopost on` — start posting automatically\n"
    "`/schedule` — show the schedule · `/next` — preview what's next\n\n"
    "*Venues:*\n"
    "`/venues` · `/addvenue <name> = <ActiveSG ballot link>`"
)


@bot.message_handler(commands=["start", "help"])
def cmd_help(message):
    bot.reply_to(message, HELP, parse_mode="Markdown")


@bot.message_handler(commands=["venues"])
def cmd_venues(message):
    venues = load_venues()
    lines = [f"• {v['name']}" for v in sorted(venues.values(), key=lambda v: v["name"])]
    bot.reply_to(message, "Venues I can build links for:\n" + "\n".join(lines)
                 if lines else "No venues saved yet — add one with /addvenue.")


@bot.message_handler(commands=["addvenue"])
def cmd_addvenue(message):
    body = re.sub(r"^/addvenue(@\w+)?\s*", "", message.text or "", flags=re.I).strip()
    ids = ids_from_link(body)
    if not ids:
        bot.reply_to(message, "Send it as:\n/addvenue Canberra Primary School (DUS) = "
                              "<paste an ActiveSG ballot link for that venue>")
        return
    name = re.split(r"=|https?://", body)[0].strip(" -=") or "Unnamed venue"
    if fb_put(f"ballot_venues/{venue_key(name)}", {"name": name, **ids}):
        bot.reply_to(message, f"Saved “{name}”. You can use it in /ballot and /setschedule now.")
    else:
        bot.reply_to(message, "Couldn't save that venue — please try again.")


@bot.message_handler(commands=["here"])
def cmd_here(message):
    cfg = load_config()
    cfg["chat_id"] = message.chat.id
    # In a forum group this is the topic the command was sent in
    cfg["topic_id"] = getattr(message, "message_thread_id", None)
    if save_config(cfg):
        where = f"this topic ({cfg['topic_id']})" if cfg["topic_id"] else "this chat"
        bot.reply_to(message, f"Got it — weekly ballot messages will be posted in {where}.\n"
                              "Turn them on with /autopost on.")
    else:
        bot.reply_to(message, "Couldn't save that — please try again.")


@bot.message_handler(commands=["autopost"])
def cmd_autopost(message):
    arg = re.sub(r"^/autopost(@\w+)?\s*", "", message.text or "", flags=re.I).strip().lower()
    cfg = load_config()
    if arg not in ("on", "off"):
        bot.reply_to(message, f"Auto-post is currently *{'on' if cfg.get('autopost') else 'off'}*. "
                              "Use `/autopost on` or `/autopost off`.", parse_mode="Markdown")
        return
    if arg == "on" and not cfg.get("chat_id"):
        bot.reply_to(message, "Tell me where to post first — send /here in the parents group.")
        return
    cfg["autopost"] = (arg == "on")
    if save_config(cfg):
        bot.reply_to(message, f"Auto-post is now *{arg}*.", parse_mode="Markdown")
    else:
        bot.reply_to(message, "Couldn't save that — please try again.")


@bot.message_handler(commands=["setschedule"])
def cmd_setschedule(message):
    body = re.sub(r"^/setschedule(@\w+)?\s*", "", message.text or "", flags=re.I).strip()
    m = re.match(r"\s*([a-z]{3,})\s+(.*)", body, re.I)
    if not m:
        bot.reply_to(message, "Send it as:\n/setschedule sat 3-5pm Canberra Primary School (DUS)")
        return
    dow = DOW_ALIASES.get(m.group(1)[:3].lower())
    if dow is None:
        bot.reply_to(message, "Which day? Use mon/tue/wed/thu/fri/sat/sun.")
        return
    rest = m.group(2)
    times = parse_time_range(rest)
    if not times:
        bot.reply_to(message, "I couldn't read the time — try `3-5pm`.", parse_mode="Markdown")
        return
    venues = load_venues()
    venue_text = re.sub(r"\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|till|until)\s*\d{1,2}(:\d{2})?\s*(am|pm)?",
                        " ", rest, flags=re.I)
    venue = find_venue(venue_text, venues)
    if not venue:
        known = ", ".join(sorted(v["name"] for v in venues.values())) or "none yet"
        bot.reply_to(message, f"I don't know that venue. Known: {known}.\n"
                              "Add it with /addvenue first.")
        return
    cfg = load_config()
    label = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][dow]
    cfg.setdefault("sessions", {})[str(dow)] = {
        "label": label, "start": times[0], "end": times[1],
        "venue_key": venue_key(venue["name"]),
    }
    if save_config(cfg):
        bot.reply_to(message, f"{label} set to {fmt_hour(times[0])}–{fmt_hour(times[1])} "
                              f"at {venue['name']}.")
    else:
        bot.reply_to(message, "Couldn't save that — please try again.")


def _where(cfg, message):
    if not cfg.get("chat_id"):
        return "not set — send /here where you want them"
    here = cfg["chat_id"] == message.chat.id and \
        cfg.get("topic_id") == getattr(message, "message_thread_id", None)
    if here:
        return "this topic" if cfg.get("topic_id") else "this chat"
    return f"chat {cfg['chat_id']}" + (f", topic {cfg['topic_id']}" if cfg.get("topic_id") else "")


@bot.message_handler(commands=["schedule"])
def cmd_schedule(message):
    cfg, venues = load_config(), load_venues()
    lines = [f"Auto-post: *{'on' if cfg.get('autopost') else 'off'}*",
             f"Posts: {cfg.get('lead_days', 14)} days ahead, from {cfg.get('post_hour', 9)}am",
             f"Posting to: {_where(cfg, message)}",
             ""]
    for dow in sorted((cfg.get("sessions") or {}).keys()):
        s = cfg["sessions"][dow]
        v = venues.get(s.get("venue_key") or "")
        lines.append(f"• {s.get('label', dow)} {fmt_hour(int(s['start']))}–{fmt_hour(int(s['end']))} — "
                     + (v["name"] if v else "_no venue set_"))
    bot.reply_to(message, "\n".join(lines), parse_mode="Markdown")


@bot.message_handler(commands=["next"])
def cmd_next(message):
    cfg, venues = load_config(), load_venues()
    upcoming = next_occurrences(cfg, venues, count=3)
    if not upcoming:
        bot.reply_to(message, "Nothing scheduled — see /schedule.")
        return
    post_on, target, s, v = upcoming[0]
    header = (f"Next: *{target.strftime('%a %-d %b')}* "
              f"{fmt_hour(int(s['start']))}–{fmt_hour(int(s['end']))}, "
              f"posting on {post_on.strftime('%a %-d %b')}.\n")
    if not v:
        bot.reply_to(message, header + "\n⚠️ No venue set for that day — "
                     "`/setschedule " + target.strftime('%a')[:3].lower() + " "
                     f"{fmt_hour(int(s['start']))}-{fmt_hour(int(s['end']))} <venue>`",
                     parse_mode="Markdown")
        return
    bot.reply_to(message, header, parse_mode="Markdown")
    send(message.chat.id, compose(target, int(s["start"]), int(s["end"]), v),
         getattr(message, "message_thread_id", None))


@bot.message_handler(commands=["ballot"])
def cmd_ballot(message):
    body = re.sub(r"^/ballot(@\w+)?\s*", "", message.text or "", flags=re.I).strip()
    if not body:
        cmd_help(message)
        return
    parsed, err = parse_request(body, load_venues())
    if err:
        bot.reply_to(message, err, parse_mode="Markdown")
        return
    day, sh, eh, venue = parsed
    log.info("ballot: %s %s-%s %s (%d slots)", day.date(), sh, eh, venue["name"], eh - sh)
    # Plain text with no preview card so it can be copied/forwarded verbatim
    send(message.chat.id, compose(day, sh, eh, venue),
         getattr(message, "message_thread_id", None))


def main() -> None:
    try:
        bot.delete_webhook()
    except Exception as e:
        log.warning("ballot bot: webhook deletion: %s", e)
    threading.Thread(target=scheduler_loop, daemon=True).start()
    log.info("Ballot bot started — listening for /ballot")
    bot.infinity_polling()


if __name__ == "__main__":
    logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
    main()
