#!/usr/bin/env python3
"""
Weekly meeting fun facts — builds a short stats + trivia message for the
academy's weekly meeting, from the same Firebase data the planner uses.

Two ways it reaches the group (both wired up in bot.py):
- posted automatically once a week on a schedule
- on demand with /funfacts in the group

Environment variables:
    FIREBASE_URL       — Realtime Database URL (has a default)
    FIREBASE_SECRET    — optional, for locked-down database rules
    ANTHROPIC_API_KEY  — optional here; used for the trivia fact, with a
                         built-in fallback list if the call fails
    FUN_FACTS_DAY      — weekday to post (mon/tue/…, default mon)
    FUN_FACTS_TIME     — time to post, 24h Singapore time (default 09:00)
"""

import logging
import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

log = logging.getLogger(__name__)

TZ = ZoneInfo("Asia/Singapore")
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
FIREBASE_SECRET = os.environ.get("FIREBASE_SECRET")

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# Fallback trivia, rotated by ISO week number when the Claude call fails
FALLBACK_FACTS = [
    "A smashed shuttlecock can fly over 400 km/h — the fastest projectile in racquet sports.",
    "The best shuttlecocks are made from feathers of the left wing of a goose only, for consistent spin.",
    "Badminton became an Olympic sport in 1992 — and 1.1 billion people watched it on TV that year.",
    "A shuttlecock has 16 feathers, and top players can go through more than 10 shuttles in one match.",
    "Badminton is the second most played sport in the world after football.",
    "In a single match, a player can run more than 6 km — mostly in bursts of under 3 metres.",
    "The longest badminton match on record lasted 161 minutes.",
    "The game was named after Badminton House in England, where it was popularised in the 1870s.",
    "Shuttlecocks were once made of wool balls — feathers took over because wool got soggy.",
    "An average rally in top-level badminton has the shuttle crossing the net every 0.8 seconds.",
    "The shortest badminton match on record took just 6 minutes.",
    "Elite players change direction roughly every second during a rally.",
]


def fb_url(path: str) -> str:
    url = f"{FIREBASE_URL}/{path}"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
    return url


def _fetch_list(path: str) -> list[dict]:
    r = requests.get(fb_url(f"{path}.json"), timeout=15)
    r.raise_for_status()
    data = r.json() or []
    vals = data if isinstance(data, list) else list(data.values())
    return [v for v in vals if v]


def fmt_time(hhmm: str) -> str:
    try:
        h, m = map(int, hhmm.split(":"))
        ap = "pm" if h >= 12 else "am"
        h12 = h % 12 or 12
        return f"{h12}:{m:02d}{ap}" if m else f"{h12}{ap}"
    except Exception:
        return hhmm or "?"


def fmt_date(d) -> str:
    return d.strftime("%-d %b")


def _hours(inst: dict) -> float:
    try:
        sh, sm = map(int, inst["start_time"].split(":"))
        eh, em = map(int, inst["end_time"].split(":"))
        return max(0.0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
    except Exception:
        return 0.0


def _fmt_hours(h: float) -> str:
    return str(int(h)) if h == int(h) else f"{h:.1f}"


def _top(counts: dict) -> tuple | None:
    """(name, count) with the highest count, or None if empty."""
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])


def get_trivia_fact(recent: list[str]) -> str:
    """One short badminton trivia fact from Claude, avoiding recently used ones.
    Falls back to a built-in list rotated by week number."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            avoid = "\n".join(f"- {f}" for f in recent) if recent else "(none)"
            response = anthropic.Anthropic(api_key=api_key).messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": (
                        "Give me ONE surprising, true fun fact about badminton for a "
                        "badminton academy's weekly coaches meeting. One or two sentences, "
                        "no preamble, no emoji. Do not repeat any of these recently used facts:\n"
                        + avoid
                    ),
                }],
            )
            fact = response.content[0].text.strip()
            if fact:
                return fact
        except Exception as e:
            log.warning("fun facts: trivia generation failed: %s", e)
    week = datetime.now(TZ).isocalendar().week
    return FALLBACK_FACTS[week % len(FALLBACK_FACTS)]


def _load_trivia_history() -> list[str]:
    try:
        r = requests.get(fb_url("fun_facts_history.json"), timeout=15)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_trivia_history(history: list[str]) -> None:
    try:
        requests.put(fb_url("fun_facts_history.json"), json=history[-12:], timeout=15)
    except Exception as e:
        log.warning("fun facts: could not save trivia history: %s", e)


def build_fun_facts() -> str:
    """The weekly meeting message: last week's numbers, the week ahead, one trivia fact."""
    today = datetime.now(TZ).date()
    week_start = today - timedelta(days=7)
    week_end = today - timedelta(days=1)
    ahead_end = today + timedelta(days=6)

    try:
        instances = _fetch_list("instances")
    except Exception as e:
        log.error("fun facts: failed to load instances: %s", e)
        instances = None

    lines = [f"🏸 Weekly meeting fun facts — {today.strftime('%a %-d %b')}"]

    if instances is None:
        lines.append("\n⚠️ Couldn't reach the schedule data, so no stats this week.")
    else:
        active = [i for i in instances if i.get("date") and i.get("status") != "cancelled"]
        last_week = [i for i in active if week_start.isoformat() <= i["date"] <= week_end.isoformat()]
        week_ahead = [i for i in active if today.isoformat() <= i["date"] <= ahead_end.isoformat()]

        lines.append(f"\n📊 Last week ({fmt_date(week_start)}–{fmt_date(week_end)}):")
        if not last_week:
            lines.append("• No sessions — a quiet week on court!")
        else:
            hours = sum(_hours(i) for i in last_week)
            venues = {i.get("venue_text") for i in last_week if i.get("venue_text")}
            plural = "s" if len(venues) != 1 else ""
            lines.append(
                f"• {len(last_week)} session{'s' if len(last_week) != 1 else ''}, "
                f"{_fmt_hours(hours)} court-hours across {len(venues)} venue{plural}"
            )

            venue_counts: dict = {}
            for i in last_week:
                if i.get("venue_text"):
                    venue_counts[i["venue_text"]] = venue_counts.get(i["venue_text"], 0) + 1
            busiest_venue = _top(venue_counts)
            if busiest_venue and len(venue_counts) > 1:
                lines.append(f"• Busiest venue: {busiest_venue[0]} ({busiest_venue[1]} sessions)")

            try:
                coach_names = {
                    c["id"]: c.get("name", "") for c in _fetch_list("coaches") if c.get("id") is not None
                }
            except Exception as e:
                log.warning("fun facts: could not load coaches: %s", e)
                coach_names = {}
            coach_counts: dict = {}
            for i in last_week:
                for cid in i.get("coach_ids") or []:
                    name = (coach_names.get(cid) or "").strip()
                    if name:
                        coach_counts[name] = coach_counts.get(name, 0) + 1
            busiest_coach = _top(coach_counts)
            if busiest_coach:
                lines.append(f"• Hardest-working coach: {busiest_coach[0]} ({busiest_coach[1]} sessions)")

            starts = sorted(i["start_time"] for i in last_week if i.get("start_time"))
            ends = sorted(i["end_time"] for i in last_week if i.get("end_time"))
            if starts and ends:
                lines.append(f"• Earliest start {fmt_time(starts[0])} · latest finish {fmt_time(ends[-1])}")

        ahead_venues = {i.get("venue_text") for i in week_ahead if i.get("venue_text")}
        if week_ahead:
            plural = "s" if len(ahead_venues) != 1 else ""
            lines.append(
                f"\n📅 Week ahead: {len(week_ahead)} session{'s' if len(week_ahead) != 1 else ''} "
                f"at {len(ahead_venues)} venue{plural}"
            )
        else:
            lines.append("\n📅 Week ahead: nothing scheduled yet")

    history = _load_trivia_history()
    fact = get_trivia_fact(history)
    lines.append(f"\n🤔 Did you know? {fact}")
    _save_trivia_history(history + [fact])

    return "\n".join(lines)


def _next_run(now: datetime) -> datetime:
    """Next scheduled posting time (Singapore time)."""
    day = (os.environ.get("FUN_FACTS_DAY") or "mon").strip().lower()[:3]
    target_dow = WEEKDAYS.index(day) if day in WEEKDAYS else 0
    try:
        hh, mm = map(int, (os.environ.get("FUN_FACTS_TIME") or "09:00").split(":"))
    except Exception:
        hh, mm = 9, 0
    run = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    run += timedelta(days=(target_dow - run.weekday()) % 7)
    if run <= now:
        run += timedelta(weeks=1)
    return run


def scheduler_loop(send) -> None:
    """Post fun facts once a week; `send(text)` delivers the message."""
    while True:
        now = datetime.now(TZ)
        run = _next_run(now)
        log.info("Fun facts: next post at %s", run.strftime("%a %d %b %H:%M %Z"))
        while True:
            remaining = (run - datetime.now(TZ)).total_seconds()
            if remaining <= 0:
                break
            time.sleep(min(remaining, 3600))
        try:
            send(build_fun_facts())
            log.info("Fun facts: weekly post sent")
        except Exception as e:
            log.error("Fun facts: weekly post failed: %s", e)
        time.sleep(60)  # step past the slot so _next_run picks next week's
