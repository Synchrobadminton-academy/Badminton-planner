import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
         si.id,
         si.firebase_key,
         si.date,
         si.start_time,
         si.end_time,
         si.hours,
         si.status,
         si.court_no,
         si.total_amount,
         si.receipt_ref,
         v.name AS venue_name,
         r.image_data,
         r.mime_type
       FROM session_instances si
       LEFT JOIN venues v ON v.id = si.venue_id
       LEFT JOIN receipts r ON r.firebase_key = si.firebase_key
       WHERE si.receipt_type = 'court_booking'
       ORDER BY si.date DESC, si.start_time ASC`
    )
    .all();

  return NextResponse.json(rows);
}
