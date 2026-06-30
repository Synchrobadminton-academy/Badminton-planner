import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
         booker_name AS name,
         COUNT(*) AS sessions,
         SUM(hours) AS hours,
         MAX(date) AS last_date,
         GROUP_CONCAT(DISTINCT v.name) AS venues_raw
       FROM session_instances si
       LEFT JOIN venues v ON v.id = si.venue_id
       WHERE si.booker_name IS NOT NULL AND si.booker_name != ''
         AND si.receipt_type = 'court_booking'
       GROUP BY si.booker_name
       ORDER BY sessions DESC, last_date DESC`
    )
    .all() as {
    name: string;
    sessions: number;
    hours: number;
    last_date: string;
    venues_raw: string | null;
  }[];

  const result = rows.map((r) => ({
    name: r.name,
    sessions: r.sessions,
    hours: r.hours ?? 0,
    last_date: r.last_date ?? "",
    venues: r.venues_raw ? r.venues_raw.split(",").filter(Boolean) : [],
  }));

  return NextResponse.json(result);
}
