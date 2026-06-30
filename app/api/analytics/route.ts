import { NextResponse } from "next/server";
import { getDb, calculateReimbursement } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
         strftime('%Y-%m', date) AS month,
         COUNT(*) AS sessions,
         SUM(hours) AS hours,
         venue_id,
         date,
         start_time
       FROM session_instances
       WHERE receipt_type = 'court_booking' AND status != 'cancelled'
       ORDER BY month ASC`
    )
    .all() as {
    month: string;
    sessions: number;
    hours: number;
    venue_id: number;
    date: string;
    start_time: string;
  }[];

  // Group by month and sum reimbursements
  const monthMap = new Map<string, { sessions: number; hours: number; reimbursement: number }>();

  const detailed = db
    .prepare(
      `SELECT id, date, start_time, hours, venue_id,
              strftime('%Y-%m', date) AS month
       FROM session_instances
       WHERE receipt_type = 'court_booking' AND status != 'cancelled'
       ORDER BY date ASC`
    )
    .all() as {
    id: number;
    date: string;
    start_time: string;
    hours: number;
    venue_id: number;
    month: string;
  }[];

  for (const row of detailed) {
    const reimb = calculateReimbursement(db, row.date, row.start_time, row.hours, row.venue_id);
    const existing = monthMap.get(row.month) ?? { sessions: 0, hours: 0, reimbursement: 0 };
    monthMap.set(row.month, {
      sessions: existing.sessions + 1,
      hours: existing.hours + row.hours,
      reimbursement: existing.reimbursement + reimb.total,
    });
  }

  const result = Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    ...data,
  }));

  return NextResponse.json(result);
}
