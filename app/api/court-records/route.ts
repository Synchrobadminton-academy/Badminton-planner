import { NextRequest, NextResponse } from "next/server";
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
         si.booker_name,
         si.reimbursed,
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

/** PATCH: toggle reimbursed status for all slots sharing the same receipt_ref */
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const { receipt_ref, reimbursed } = await req.json();

  if (!receipt_ref) {
    return NextResponse.json({ error: "receipt_ref required" }, { status: 400 });
  }

  db.prepare(
    "UPDATE session_instances SET reimbursed = ? WHERE receipt_ref = ?"
  ).run(reimbursed ? 1 : 0, receipt_ref);

  return NextResponse.json({ ok: true, receipt_ref, reimbursed: !!reimbursed });
}
