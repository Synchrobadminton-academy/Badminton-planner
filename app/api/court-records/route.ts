import { NextRequest, NextResponse } from "next/server";
import { getDb, calculateReimbursement } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
         si.id,
         si.firebase_key,
         si.venue_id,
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
         si.payment_date,
         v.name AS venue_name,
         r.image_data,
         r.mime_type
       FROM session_instances si
       LEFT JOIN venues v ON v.id = si.venue_id
       LEFT JOIN receipts r ON r.firebase_key = si.firebase_key
       WHERE si.receipt_type = 'court_booking'
       ORDER BY si.date DESC, si.start_time ASC`
    )
    .all() as {
    id: number;
    firebase_key: string;
    venue_id: number;
    date: string;
    start_time: string;
    end_time: string;
    hours: number;
    status: string;
    court_no: string | null;
    total_amount: string | null;
    receipt_ref: string | null;
    booker_name: string | null;
    reimbursed: number;
    payment_date: string | null;
    venue_name: string | null;
    image_data: string | null;
    mime_type: string | null;
  }[];

  const enriched = rows.map((row) => {
    const reimb = calculateReimbursement(
      db,
      row.date,
      row.start_time,
      row.hours,
      row.venue_id
    );
    return {
      ...row,
      is_peak: reimb.isPeak,
      peak_reason: reimb.peakReason,
      court_rate_per_hour: reimb.courtRatePerHour,
      court_cost: reimb.courtCost,
      venue_type: reimb.venueType,
      incentive_rate_per_hour: reimb.incentiveRatePerHour,
      incentive: reimb.incentive,
      reimbursement_total: reimb.total,
    };
  });

  return NextResponse.json(enriched);
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
