import { NextResponse } from "next/server";
import { getDb, computeHours, findOrCreateCoach, findOrCreateVenue } from "@/lib/db";

const FIREBASE_URL = (
  process.env.FIREBASE_URL ||
  "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/$/, "");

interface BotSession {
  receipt_type?: string;
  date?: string;
  payment_date?: string;
  start_time?: string;
  end_time?: string;
  venue_text?: string;
  court_no?: string;
  class_type?: string;
  programme_name?: string;
  booker_name?: string;
  total_amount?: string;
  receipt_ref?: string;
  participants?: string[];
  status?: string;
  notes?: string;
}

export async function GET() {
  const db = getDb();
  const stats = {
    court_bookings: (
      db
        .prepare("SELECT COUNT(*) as c FROM session_instances WHERE receipt_type = 'court_booking'")
        .get() as { c: number }
    ).c,
    programme_sessions: (
      db
        .prepare("SELECT COUNT(*) as c FROM session_instances WHERE receipt_type = 'programme_roster'")
        .get() as { c: number }
    ).c,
    attendance_records: (
      db.prepare("SELECT COUNT(*) as c FROM attendance").get() as { c: number }
    ).c,
    receipts: (db.prepare("SELECT COUNT(*) as c FROM receipts").get() as { c: number }).c,
  };
  return NextResponse.json(stats);
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
    return NextResponse.json({ synced: 0, images: 0, attendance: 0, message: "No bot sessions in Firebase" });
  }

  // 2. Keys already imported
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

  let syncedSessions = 0;
  let syncedImages = 0;
  let syncedAttendance = 0;
  const errors: string[] = [];

  const insertAttendance = db.prepare(
    "INSERT OR IGNORE INTO attendance (session_instance_id, participant_name, status) VALUES (?,?,'absent')"
  );

  for (const [key, session] of Object.entries(botSessions)) {
    // 3. Sync session if not yet imported
    if (!imported.has(key)) {
      const {
        receipt_type,
        date,
        payment_date,
        start_time,
        end_time,
        venue_text,
        court_no,
        class_type,
        programme_name,
        booker_name,
        total_amount,
        receipt_ref,
        participants,
        status,
      } = session;

      if (!date || !start_time || !end_time) {
        errors.push(`Skipped ${key}: missing date/time`);
        continue;
      }

      try {
        // court_booking uses a placeholder coach; programme_roster uses another
        const coachName =
          receipt_type === "court_booking" ? "Court Booking" : "ActiveSG Programme";
        const coachId = findOrCreateCoach(db, coachName);
        const venueId = findOrCreateVenue(db, venue_text || "Unknown Venue");
        const hours = computeHours(start_time, end_time);

        const sessionResult = db
          .prepare(
            "INSERT INTO sessions (coach_id, venue_id, recurring, date, start_time, end_time) VALUES (?,?,0,?,?,?)"
          )
          .run(coachId, venueId, date, start_time, end_time);

        const sessionId = sessionResult.lastInsertRowid as number;

        const siResult = db.prepare(
          `INSERT OR IGNORE INTO session_instances
             (session_id, coach_id, venue_id, date, start_time, end_time, hours,
              status, firebase_key, receipt_type, court_no, class_type,
              programme_name, booker_name, total_amount, receipt_ref, payment_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          sessionId, coachId, venueId, date, start_time, end_time, hours,
          status || "scheduled",
          key,
          receipt_type || null,
          court_no || null,
          class_type || null,
          programme_name || null,
          booker_name || null,
          total_amount || null,
          receipt_ref || null,
          payment_date || null,
        );

        const instanceId = siResult.lastInsertRowid as number;
        syncedSessions++;

        // 4. For programme rosters: auto-fill attendance with participant names
        if (receipt_type === "programme_roster" && Array.isArray(participants)) {
          for (const name of participants) {
            if (name && typeof name === "string" && name.trim()) {
              insertAttendance.run(instanceId, name.trim());
              syncedAttendance++;
            }
          }
        }
      } catch (err) {
        errors.push(`Session ${key}: ${err}`);
      }
    }

    // 5. Fetch and store receipt image (linked to first booking key of a receipt)
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
        // Non-fatal — image only exists for the first slot of a court booking
      }
    }
  }

  return NextResponse.json({
    synced: syncedSessions,
    images: syncedImages,
    attendance: syncedAttendance,
    total: Object.keys(botSessions).length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
