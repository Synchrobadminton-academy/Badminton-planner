import { NextResponse } from "next/server";
import { getDb, computeHours, findOrCreateCoach, findOrCreateVenue } from "@/lib/db";

const FIREBASE_URL = (
  process.env.FIREBASE_URL ||
  "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/$/, "");

const BOT_COACH_NAME = "ActiveSG Court";

interface BotSession {
  date?: string;
  start_time?: string;
  end_time?: string;
  venue_text?: string;
  court_no?: string;
  class_type?: string;
  notes?: string;
  status?: string;
}

export async function GET() {
  const db = getDb();
  const imported = (
    db
      .prepare("SELECT firebase_key FROM session_instances WHERE firebase_key IS NOT NULL")
      .all() as { firebase_key: string }[]
  ).map((r) => r.firebase_key);

  return NextResponse.json({ imported_count: imported.length, imported_keys: imported });
}

export async function POST() {
  const db = getDb();

  // 1. Fetch all bot_sessions from Firebase
  let botSessions: Record<string, BotSession> | null = null;
  try {
    const res = await fetch(`${FIREBASE_URL}/bot_sessions.json`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `Firebase returned ${res.status}` }, { status: 502 });
    }
    botSessions = await res.json();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  if (!botSessions) {
    return NextResponse.json({ synced: 0, images: 0, message: "No bot sessions in Firebase" });
  }

  // 2. Collect already-imported firebase_keys
  const imported = new Set(
    (
      db
        .prepare("SELECT firebase_key FROM session_instances WHERE firebase_key IS NOT NULL")
        .all() as { firebase_key: string }[]
    ).map((r) => r.firebase_key)
  );

  const importedImages = new Set(
    (db.prepare("SELECT firebase_key FROM receipts").all() as { firebase_key: string }[]).map(
      (r) => r.firebase_key
    )
  );

  // 3. Get or create the ActiveSG placeholder coach
  const coachId = findOrCreateCoach(db, BOT_COACH_NAME);

  let syncedSessions = 0;
  let syncedImages = 0;
  const errors: string[] = [];

  // 4. Process each bot session
  for (const [key, session] of Object.entries(botSessions)) {
    if (!imported.has(key)) {
      const { date, start_time, end_time, venue_text, status } = session;

      if (!date || !start_time || !end_time) {
        errors.push(`Skipped ${key}: missing date/time`);
        continue;
      }

      const venueId = findOrCreateVenue(db, venue_text || "Unknown Venue");
      const hours = computeHours(start_time, end_time);

      try {
        // Create a parent sessions record
        const sessionResult = db
          .prepare(
            "INSERT INTO sessions (coach_id, venue_id, recurring, date, start_time, end_time) VALUES (?,?,0,?,?,?)"
          )
          .run(coachId, venueId, date, start_time, end_time);

        const sessionId = sessionResult.lastInsertRowid as number;

        db.prepare(
          `INSERT OR IGNORE INTO session_instances
            (session_id, coach_id, venue_id, date, start_time, end_time, hours, status, firebase_key)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(sessionId, coachId, venueId, date, start_time, end_time, hours, status || "scheduled", key);

        syncedSessions++;
      } catch (err) {
        errors.push(`Session ${key}: ${err}`);
      }
    }

    // 5. Fetch and store the receipt image (only for first booking of a series)
    if (!importedImages.has(key)) {
      try {
        const imgRes = await fetch(`${FIREBASE_URL}/booking_images/${key}.json`, {
          cache: "no-store",
        });
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          if (imgData?.data) {
            db.prepare(
              "INSERT OR IGNORE INTO receipts (firebase_key, image_data, mime_type) VALUES (?,?,?)"
            ).run(key, imgData.data, imgData.mime_type || "image/jpeg");
            syncedImages++;
          }
        }
      } catch {
        // Non-fatal: image may not exist for all sessions
      }
    }
  }

  return NextResponse.json({
    synced: syncedSessions,
    images: syncedImages,
    total: Object.keys(botSessions).length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
