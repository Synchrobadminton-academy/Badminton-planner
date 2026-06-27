import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/attendance
 *   → list of programme_roster sessions with attendance summary
 *
 * GET /api/attendance?session_id=N
 *   → attendance records for that session
 *
 * PATCH /api/attendance
 *   body: { id: number, status: "present"|"absent"|"excused" }
 *   → updated attendance record
 */

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");

  if (sessionId) {
    // Detail: attendance for one session
    const records = db
      .prepare(
        `SELECT id, participant_name, status
         FROM attendance
         WHERE session_instance_id = ?
         ORDER BY participant_name`
      )
      .all(Number(sessionId));
    return NextResponse.json(records);
  }

  // Summary: all programme_roster sessions with attendance counts
  const sessions = db
    .prepare(
      `SELECT
         si.id,
         si.date,
         si.start_time,
         si.end_time,
         si.programme_name,
         si.class_type,
         si.court_no,
         v.name AS venue_name,
         COUNT(a.id) AS total_participants,
         SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present_count,
         SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END) AS absent_count,
         SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused_count
       FROM session_instances si
       LEFT JOIN venues v ON v.id = si.venue_id
       LEFT JOIN attendance a ON a.session_instance_id = si.id
       WHERE si.receipt_type = 'programme_roster'
       GROUP BY si.id
       ORDER BY si.date DESC, si.start_time`
    )
    .all();

  return NextResponse.json(sessions);
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  const { id, status } = await req.json();

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (!["present", "absent", "excused"].includes(status)) {
    return NextResponse.json({ error: "status must be present, absent, or excused" }, { status: 400 });
  }

  db.prepare("UPDATE attendance SET status = ? WHERE id = ?").run(status, id);
  const row = db.prepare("SELECT * FROM attendance WHERE id = ?").get(id);
  return NextResponse.json(row);
}
