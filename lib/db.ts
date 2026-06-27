import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "planner.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

// Singapore public holidays 2026 (variable-date holidays are approximate)
const SG_HOLIDAYS_2026 = [
  ["2026-01-01", "New Year's Day"],
  ["2026-02-17", "Chinese New Year (Day 1)"],
  ["2026-02-18", "Chinese New Year (Day 2)"],
  ["2026-03-20", "Hari Raya Puasa"],          // approximate — lunar
  ["2026-04-03", "Good Friday"],
  ["2026-05-01", "Labour Day"],
  ["2026-05-22", "Vesak Day"],                 // approximate — lunar
  ["2026-05-29", "Hari Raya Haji"],            // approximate — lunar
  ["2026-08-09", "National Day"],
  ["2026-10-09", "Deepavali"],                 // approximate — Hindu lunar
  ["2026-12-25", "Christmas Day"],
];

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coaches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      hourly_rate REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      venue_type TEXT DEFAULT 'sports_hall',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS public_holidays (
      date TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      recurring INTEGER DEFAULT 0,
      day_of_week INTEGER,
      date TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      coach_id INTEGER NOT NULL REFERENCES coaches(id),
      venue_id INTEGER NOT NULL REFERENCES venues(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      hours REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firebase_key TEXT UNIQUE NOT NULL,
      image_data TEXT NOT NULL,
      mime_type TEXT DEFAULT 'image/jpeg',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_instance_id INTEGER NOT NULL REFERENCES session_instances(id) ON DELETE CASCADE,
      participant_name TEXT NOT NULL,
      status TEXT DEFAULT 'absent',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_instance_id, participant_name)
    );
  `);

  // ── Column migrations ────────────────────────────────────────────────────
  const siCols = db.pragma("table_info(session_instances)") as { name: string }[];
  const siColNames = siCols.map((c) => c.name);

  if (!siColNames.includes("firebase_key")) {
    db.exec("ALTER TABLE session_instances ADD COLUMN firebase_key TEXT");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_si_firebase_key ON session_instances(firebase_key) WHERE firebase_key IS NOT NULL"
    );
  }
  for (const col of [
    "receipt_type TEXT",
    "court_no TEXT",
    "total_amount TEXT",
    "receipt_ref TEXT",
    "class_type TEXT",
    "programme_name TEXT",
    "booker_name TEXT",
    "reimbursed INTEGER DEFAULT 0",
    "payment_date TEXT",
  ]) {
    const colName = col.split(" ")[0];
    if (!siColNames.includes(colName)) {
      db.exec(`ALTER TABLE session_instances ADD COLUMN ${col}`);
    }
  }

  // Add venue_type to venues if missing (existing DB upgrade)
  const venueCols = db.pragma("table_info(venues)") as { name: string }[];
  if (!venueCols.some((c) => c.name === "venue_type")) {
    db.exec("ALTER TABLE venues ADD COLUMN venue_type TEXT DEFAULT 'sports_hall'");
  }

  // ── Seed data ────────────────────────────────────────────────────────────
  const venueCount = (db.prepare("SELECT COUNT(*) as c FROM venues").get() as { c: number }).c;
  if (venueCount === 0) {
    db.prepare("INSERT INTO venues (name) VALUES (?), (?), (?)").run(
      "Court 1", "Court 2", "Court 3"
    );
  }

  // Pre-populate 2026 Singapore public holidays (skip if already seeded)
  const holidayCount = (
    db.prepare("SELECT COUNT(*) as c FROM public_holidays WHERE date LIKE '2026%'").get() as { c: number }
  ).c;
  if (holidayCount === 0) {
    const insertHoliday = db.prepare(
      "INSERT OR IGNORE INTO public_holidays (date, name) VALUES (?, ?)"
    );
    for (const [date, name] of SG_HOLIDAYS_2026) {
      insertHoliday.run(date, name);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Infer venue_type from name: schools get $5/hr incentive, everything else $2.50/hr */
export function inferVenueType(name: string): "school" | "sports_hall" {
  const lower = name.toLowerCase();
  if (
    lower.includes("school") ||
    lower.includes("primary") ||
    lower.includes("secondary") ||
    lower.includes("junior college") ||
    lower.includes(" jc ") ||
    lower.includes("polytechnic") ||
    lower.includes("institute of technical")
  ) {
    return "school";
  }
  return "sports_hall";
}

/** Find or create a coach by name; returns the coach id. */
export function findOrCreateCoach(db: Database.Database, name: string): number {
  const existing = db
    .prepare("SELECT id FROM coaches WHERE name = ?")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  return db
    .prepare("INSERT INTO coaches (name, contact, hourly_rate, active) VALUES (?,?,?,?)")
    .run(name, "", 0, 1).lastInsertRowid as number;
}

/** Find or create a venue by name (auto-detects venue_type); returns the venue id. */
export function findOrCreateVenue(db: Database.Database, name: string): number {
  const existing = db
    .prepare("SELECT id FROM venues WHERE name = ?")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const vType = inferVenueType(name);
  return db
    .prepare("INSERT INTO venues (name, venue_type) VALUES (?,?)")
    .run(name, vType).lastInsertRowid as number;
}

export function computeHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

// ── Reimbursement calculation ────────────────────────────────────────────────

export interface ReimbursementBreakdown {
  hours: number;
  isPeak: boolean;
  peakReason: string;
  courtRatePerHour: number;
  courtCost: number;
  venueType: "school" | "sports_hall";
  incentiveRatePerHour: number;
  incentive: number;
  total: number;
}

/**
 * Calculate the full reimbursement for one court slot:
 *   total = court_cost + incentive
 *
 * Peak = weekday after 18:00 OR weekend OR Singapore public holiday (excluding in-lieu days).
 * Peak rate:     S$7.40/hr
 * Non-peak rate: S$3.50/hr
 *
 * Incentive: school → S$5.00/hr | sports hall / clubhouse → S$2.50/hr
 */
export function calculateReimbursement(
  db: Database.Database,
  date: string,
  startTime: string,
  hours: number,
  venueId: number
): ReimbursementBreakdown {
  // Day-of-week (use local date string to avoid TZ shift)
  const [y, m, d] = date.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const isHoliday = !!(
    db.prepare("SELECT 1 FROM public_holidays WHERE date = ?").get(date)
  );

  const startHour = parseInt(startTime.split(":")[0], 10);
  const isAfterSix = startHour >= 18;

  const isPeak = isWeekend || isHoliday || isAfterSix;
  const peakReason = isWeekend
    ? "Weekend"
    : isHoliday
    ? "Public holiday"
    : isAfterSix
    ? "After 6 pm"
    : "Non-peak";

  const courtRatePerHour = isPeak ? 7.4 : 3.5;
  const courtCost = courtRatePerHour * hours;

  const venue = db
    .prepare("SELECT venue_type FROM venues WHERE id = ?")
    .get(venueId) as { venue_type: string | null } | undefined;
  const venueType = (venue?.venue_type ?? "sports_hall") as "school" | "sports_hall";
  const incentiveRatePerHour = venueType === "school" ? 5.0 : 2.5;
  const incentive = incentiveRatePerHour * hours;

  return {
    hours,
    isPeak,
    peakReason,
    courtRatePerHour,
    courtCost,
    venueType,
    incentiveRatePerHour,
    incentive,
    total: courtCost + incentive,
  };
}

// Generate recurring instances for next N weeks from a given date
export function generateRecurringInstances(
  db: Database.Database,
  sessionId: number,
  coachId: number,
  venueId: number,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  fromDate: Date,
  weeks = 12
) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO session_instances
      (session_id, coach_id, venue_id, date, start_time, end_time, hours)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const hours = computeHours(startTime, endTime);
  const instances = db.transaction(() => {
    for (let w = 0; w < weeks; w++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + w * 7);
      const diff = (dayOfWeek - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + (w === 0 ? diff : 0));
      const dateStr = d.toISOString().split("T")[0];
      insert.run(sessionId, coachId, venueId, dateStr, startTime, endTime, hours);
    }
  });
  instances();
}
