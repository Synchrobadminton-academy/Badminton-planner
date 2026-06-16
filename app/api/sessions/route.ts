import { NextRequest, NextResponse } from "next/server";
import { getDb, computeHours, generateRecurringInstances } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get("week_start");
  const weekEnd = searchParams.get("week_end");

  let instances;
  if (weekStart && weekEnd) {
    instances = db
      .prepare(
        `SELECT si.*, c.name as coach_name, v.name as venue_name
         FROM session_instances si
         JOIN coaches c ON c.id = si.coach_id
         JOIN venues v ON v.id = si.venue_id
         WHERE si.date >= ? AND si.date <= ?
         ORDER BY si.date, si.start_time`
      )
      .all(weekStart, weekEnd);
  } else {
    instances = db
      .prepare(
        `SELECT si.*, c.name as coach_name, v.name as venue_name
         FROM session_instances si
         JOIN coaches c ON c.id = si.coach_id
         JOIN venues v ON v.id = si.venue_id
         ORDER BY si.date, si.start_time`
      )
      .all();
  }
  return NextResponse.json(instances);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { coach_id, venue_id, recurring, day_of_week, date, start_time, end_time } = body;

  if (!coach_id || !venue_id || !start_time || !end_time) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (recurring && day_of_week == null) {
    return NextResponse.json({ error: "day_of_week required for recurring sessions" }, { status: 400 });
  }
  if (!recurring && !date) {
    return NextResponse.json({ error: "date required for one-off sessions" }, { status: 400 });
  }

  const result = db
    .prepare(
      "INSERT INTO sessions (coach_id, venue_id, recurring, day_of_week, date, start_time, end_time) VALUES (?,?,?,?,?,?,?)"
    )
    .run(coach_id, venue_id, recurring ? 1 : 0, day_of_week ?? null, date ?? null, start_time, end_time);

  const sessionId = result.lastInsertRowid as number;

  if (recurring) {
    // Generate 12 weeks of instances starting from the next occurrence
    const today = new Date();
    const targetDay = day_of_week as number;
    const diff = (targetDay - today.getDay() + 7) % 7;
    const firstDate = new Date(today);
    firstDate.setDate(today.getDate() + diff);
    generateRecurringInstances(db, sessionId, coach_id, venue_id, targetDay, start_time, end_time, firstDate, 12);
  } else {
    const hours = computeHours(start_time, end_time);
    db.prepare(
      "INSERT INTO session_instances (session_id, coach_id, venue_id, date, start_time, end_time, hours) VALUES (?,?,?,?,?,?,?)"
    ).run(sessionId, coach_id, venue_id, date, start_time, end_time, hours);
  }

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  return NextResponse.json(session, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
