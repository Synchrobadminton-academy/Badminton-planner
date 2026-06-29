"use client";
import { useState, useEffect } from "react";

interface Stats {
  court_bookings: number;
  programme_sessions: number;
  attendance_records: number;
  receipts: number;
}

interface MonthlyData {
  month: string;
  sessions: number;
  hours: number;
  reimbursement: number;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/firebase-sync").then((r) => r.json()),
      fetch("/api/analytics").then((r) => r.json()),
    ])
      .then(([s, m]) => {
        setStats(s);
        setMonthly(m ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const maxHours = Math.max(...monthly.map((m) => m.hours), 1);
  const maxReimb = Math.max(...monthly.map((m) => m.reimbursement), 1);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Analytics</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text2)" }}>Session and reimbursement trends</p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Court Bookings", value: stats?.court_bookings ?? "—", color: "#3b82f6" },
          { label: "Programme Sessions", value: stats?.programme_sessions ?? "—", color: "#f59e0b" },
          { label: "Attendance Records", value: stats?.attendance_records ?? "—", color: "#8b5cf6" },
          { label: "Receipt Images", value: stats?.receipts ?? "—", color: "#10b981" },
        ].map((c) => (
          <div key={c.label} style={{
            background: "var(--surface)", borderRadius: 10,
            border: "1px solid var(--border)", padding: 16,
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>
              {loading ? "—" : c.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">Loading analytics…</div>
      ) : monthly.length === 0 ? (
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <p style={{ color: "var(--text2)", fontSize: 14 }}>No data yet. Sync from Firebase to populate analytics.</p>
        </div>
      ) : (
        <>
          {/* Hours bar chart */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20, marginBottom: 20 }}>
            <h2 className="font-semibold text-sm mb-4" style={{ color: "var(--text)" }}>Court Hours by Month</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
              {monthly.map((m) => (
                <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text2)", fontWeight: 600 }}>
                    {m.hours.toFixed(0)}h
                  </span>
                  <div
                    style={{
                      width: "100%", borderRadius: "4px 4px 0 0",
                      background: "#3b82f6",
                      height: `${Math.round((m.hours / maxHours) * 90)}px`,
                      minHeight: m.hours > 0 ? 4 : 0,
                    }}
                  />
                  <span style={{ fontSize: 10, color: "var(--text2)", writingMode: "vertical-lr", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
                    {m.month}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reimbursement bar chart */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20, marginBottom: 20 }}>
            <h2 className="font-semibold text-sm mb-4" style={{ color: "var(--text)" }}>Reimbursement by Month (S$)</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
              {monthly.map((m) => (
                <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text2)", fontWeight: 600 }}>
                    ${m.reimbursement.toFixed(0)}
                  </span>
                  <div
                    style={{
                      width: "100%", borderRadius: "4px 4px 0 0",
                      background: "#10b981",
                      height: `${Math.round((m.reimbursement / maxReimb) * 90)}px`,
                      minHeight: m.reimbursement > 0 ? 4 : 0,
                    }}
                  />
                  <span style={{ fontSize: 10, color: "var(--text2)", writingMode: "vertical-lr", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
                    {m.month}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly table */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Month</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Sessions</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Hours</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Reimbursement</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text)" }}>{m.month}</td>
                    <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{m.sessions}</td>
                    <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{m.hours.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-green-700">S${m.reimbursement.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--surface2)", fontWeight: 700 }}>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>Total</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{monthly.reduce((s, m) => s + m.sessions, 0)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{monthly.reduce((s, m) => s + m.hours, 0).toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right text-green-700">S${monthly.reduce((s, m) => s + m.reimbursement, 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
