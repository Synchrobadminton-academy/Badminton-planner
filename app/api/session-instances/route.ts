import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM
  const coachId = searchParams.get("coach_id");

  let query = `
    SELECT si.*, c.name as coach_name, v.name as venue_name
    FROM session_instances si
    JOIN coaches c ON c.id = si.coach_id
    JOIN venues v ON v.id = si.venue_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (month) {
    query += " AND strftime('%Y-%m', si.date) = ?";
    params.push(month);
  }
  if (coachId) {
    query += " AND si.coach_id = ?";
    params.push(Number(coachId));
  }

  query += " ORDER BY si.date, si.start_time";
  const instances = db.prepare(query).all(...params);
  return NextResponse.json(instances);
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { id, status } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  db.prepare("UPDATE session_instances SET status = ? WHERE id = ?").run(status, id);
  const instance = db.prepare("SELECT * FROM session_instances WHERE id = ?").get(id);
  return NextResponse.json(instance);
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  db.prepare("DELETE FROM session_instances WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
