import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
        r.id,
        r.firebase_key,
        r.image_data,
        r.mime_type,
        r.created_at,
        si.date,
        si.start_time,
        si.end_time,
        si.status,
        si.hours,
        si.receipt_type,
        si.court_no,
        si.total_amount,
        si.receipt_ref,
        si.class_type,
        si.programme_name,
        v.name AS venue_name
       FROM receipts r
       LEFT JOIN session_instances si ON si.firebase_key = r.firebase_key
       LEFT JOIN venues v ON v.id = si.venue_id
       ORDER BY si.date DESC, r.created_at DESC`
    )
    .all();

  return NextResponse.json(rows);
}
