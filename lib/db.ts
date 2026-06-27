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
      created_at TEXT DEFAULT (datetime('now'))
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
  `);

  // Add firebase_key column to session_instances if it doesn't exist yet
  const siCols = db.pragma("table_info(session_instances)") as { name: string }[];
  if (!siCols.some((c) => c.name === "firebase_key")) {
    db.exec("ALTER TABLE session_instances ADD COLUMN firebase_key TEXT");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_si_firebase_key ON session_instances(firebase_key) WHERE firebase_key IS NOT NULL"
    );
  }

  // Seed default venues if empty
  const venueCount = (db.prepare("SELECT COUNT(*) as c FROM venues").get() as { c: number }).c;
  if (venueCount === 0) {
    db.prepare("INSERT INTO venues (name) VALUES (?), (?), (?)").run(
      "Court 1", "Court 2", "Court 3"
    );
  }
}

/** Find or create a coach by name; returns the coach id. */
export function findOrCreateCoach(db: Database.Database, name: string): number {
  const existing = db.prepare("SELECT id FROM coaches WHERE name = ?").get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  return (db.prepare("INSERT INTO coaches (name, contact, hourly_rate, active) VALUES (?,?,?,?)").run(name, "", 0, 1).lastInsertRowid) as number;
}

/** Find or create a venue by name; returns the venue id. */
export function findOrCreateVenue(db: Database.Database, name: string): number {
  const existing = db.prepare("SELECT id FROM venues WHERE name = ?").get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  return (db.prepare("INSERT INTO venues (name) VALUES (?)").run(name).lastInsertRowid) as number;
}

export function computeHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
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
      // Find the next occurrence of dayOfWeek from d
      const diff = (dayOfWeek - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + (w === 0 ? diff : 0));
      const dateStr = d.toISOString().split("T")[0];
      insert.run(sessionId, coachId, venueId, dateStr, startTime, endTime, hours);
    }
  });
  instances();
}
