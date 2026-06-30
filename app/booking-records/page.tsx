"use client";
import { useState, useEffect, useCallback } from "react";

interface BookingRecord {
  id: number;
  firebase_key: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  venue_name: string;
  court_no: string | null;
  booker_name: string | null;
  total_amount: string | null;
  receipt_ref: string | null;
  reimbursed: number;
  payment_date: string | null;
  is_peak: boolean;
  peak_reason: string;
  court_cost: number;
  incentive: number;
  reimbursement_total: number;
  venue_type: string;
}

export default function BookingRecordsPage() {
  const [records, setRecords] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "reimbursed">("all");
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/court-records");
    setRecords(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  async function toggleReimbursed(record: BookingRecord) {
    const ref = record.receipt_ref ?? record.firebase_key;
    setUpdating(ref);
    await fetch("/api/court-records", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_ref: ref, reimbursed: !record.reimbursed }),
    });
    await fetchRecords();
    setUpdating(null);
  }

  // Group by receipt_ref
  const grouped = new Map<string, BookingRecord[]>();
  for (const r of records) {
    const key = r.receipt_ref ?? r.firebase_key;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const groups = Array.from(grouped.entries()).map(([ref, slots]) => ({
    ref,
    slots,
    date: slots[0].date,
    venue_name: slots[0].venue_name,
    booker_name: slots[0].booker_name,
    payment_date: slots[0].payment_date,
    reimbursed: slots[0].reimbursed,
    total: slots.reduce((s, r) => s + r.reimbursement_total, 0),
    hours: slots.reduce((s, r) => s + r.hours, 0),
    total_amount: slots[0].total_amount,
  }));

  const filtered = groups.filter((g) => {
    if (filter === "pending") return !g.reimbursed;
    if (filter === "reimbursed") return g.reimbursed;
    return true;
  });

  const pendingTotal = groups.filter((g) => !g.reimbursed).reduce((s, g) => s + g.total, 0);
  const reimbuTotal = groups.filter((g) => g.reimbursed).reduce((s, g) => s + g.total, 0);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Booking Records</h1>
      <p className="text-sm mb-5" style={{ color: "var(--text2)" }}>
        Court booking reimbursement tracking
      </p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", padding: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f59e0b" }}>S${pendingTotal.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>Pending Reimbursement</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", padding: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#10b981" }}>S${reimbuTotal.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>Total Reimbursed</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", padding: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#3b82f6" }}>{groups.length}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>Total Bookings</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(["all", "pending", "reimbursed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: "1px solid var(--border)",
              background: filter === f ? "#2563eb" : "var(--surface)",
              color: filter === f ? "#fff" : "var(--text2)",
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 48, textAlign: "center" }}>
          <p style={{ color: "var(--text2)" }}>No booking records found.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((g) => (
            <div key={g.ref} style={{
              background: "var(--surface)", borderRadius: 10,
              border: g.reimbursed ? "1px solid #bbf7d0" : "1px solid var(--border)",
              overflow: "hidden",
            }}>
              {/* Group header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 16px",
                background: g.reimbursed ? "#f0fdf4" : "var(--surface2)",
                borderBottom: "1px solid var(--border)",
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                    {g.date}
                  </span>
                  <span className="mx-2" style={{ color: "var(--text2)" }}>·</span>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{g.venue_name}</span>
                  {g.booker_name && (
                    <>
                      <span className="mx-2" style={{ color: "var(--text2)" }}>·</span>
                      <span style={{ fontSize: 12, color: "var(--text2)" }}>{g.booker_name}</span>
                    </>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "#059669", fontSize: 15 }}>S${g.total.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>{g.hours.toFixed(1)}h</div>
                </div>
                <button
                  onClick={() => toggleReimbursed(g.slots[0])}
                  disabled={updating === (g.slots[0].receipt_ref ?? g.slots[0].firebase_key)}
                  style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: "pointer", border: "none",
                    background: g.reimbursed ? "#d1fae5" : "#2563eb",
                    color: g.reimbursed ? "#065f46" : "#fff",
                    opacity: updating === g.ref ? 0.6 : 1,
                  }}
                >
                  {g.reimbursed ? "✓ Reimbursed" : "Mark Reimbursed"}
                </button>
              </div>

              {/* Slot breakdown */}
              <table className="w-full text-xs">
                <tbody>
                  {g.slots.map((slot) => (
                    <tr key={slot.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-2" style={{ color: "var(--text2)", whiteSpace: "nowrap" }}>
                        {slot.start_time}–{slot.end_time} ({slot.hours}h)
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--text2)" }}>
                        {slot.court_no ? `Court ${slot.court_no}` : "—"}
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--text2)" }}>
                        <span style={{
                          padding: "1px 6px", borderRadius: 4,
                          background: slot.is_peak ? "#fff7ed" : "#eff6ff",
                          color: slot.is_peak ? "#c2410c" : "#1d4ed8",
                          fontWeight: 500,
                        }}>
                          {slot.is_peak ? "Peak" : "Non-peak"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right" style={{ color: "var(--text2)" }}>
                        Court: S${slot.court_cost.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right" style={{ color: "#059669" }}>
                        +S${slot.incentive.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text)" }}>
                        S${slot.reimbursement_total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.payment_date && (
                <div style={{ padding: "4px 16px 6px", fontSize: 11, color: "var(--text2)" }}>
                  Payment date: {g.payment_date}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
