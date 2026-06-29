"use client";
import { useState, useEffect, useCallback } from "react";

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}
function getWeekStart(d: Date) {
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return mon;
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CourtSession {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  status: string;
  venue_name: string;
  court_no: string | null;
  booker_name: string | null;
  total_amount: string | null;
  reimbursement_total: number;
  is_peak: boolean;
  receipt_ref: string | null;
  reimbursed: number;
}

export default function CourtsPage() {
  const [baseDate, setBaseDate] = useState(() => new Date());
  const monday = getWeekStart(baseDate);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const [sessions, setSessions] = useState<CourtSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/court-records");
      const all: CourtSession[] = await res.json();
      setSessions(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return fmt(d);
  });

  const weekSessions = sessions.filter((s) => weekDates.includes(s.date));

  function groupByDate(list: CourtSession[]) {
    const map = new Map<string, CourtSession[]>();
    for (const d of weekDates) map.set(d, []);
    for (const s of list) {
      if (map.has(s.date)) map.get(s.date)!.push(s);
    }
    return map;
  }

  const byDate = groupByDate(weekSessions);

  const statusBadge = (s: CourtSession) => {
    if (s.status === "cancelled") return <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">cancelled</span>;
    if (s.reimbursed) return <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">reimbursed</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">pending</span>;
  };

  function prevWeek() {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - 7);
    setBaseDate(d);
  }
  function nextWeek() {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 7);
    setBaseDate(d);
  }

  const weekTotal = weekSessions.reduce((s, r) => s + r.reimbursement_total, 0);
  const weekHours = weekSessions.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Courts</h1>
      <p className="text-sm mb-5" style={{ color: "var(--text2)" }}>Weekly court booking schedule</p>

      {/* Week nav */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={prevWeek} className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>← Prev</button>
        <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>
          {fmt(monday)} — {fmt(sunday)}
        </span>
        <button onClick={nextWeek} className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Next →</button>
        <button onClick={() => setBaseDate(new Date())} className="px-3 py-1.5 text-sm border rounded text-blue-600 hover:bg-blue-50" style={{ borderColor: "var(--border)" }}>Today</button>
        <div style={{ flex: 1 }} />
        <span className="text-sm font-medium text-slate-600">
          {weekHours.toFixed(1)}h · S${weekTotal.toFixed(2)}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {weekDates.map((date, i) => {
            const daySessions = byDate.get(date) ?? [];
            const isToday = date === fmt(new Date());
            const [y, m, d] = date.split("-").map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString("en-SG", { weekday: "short", day: "numeric" });
            return (
              <div key={date} style={{
                background: "var(--surface)", borderRadius: 10,
                border: isToday ? "2px solid #3b82f6" : "1px solid var(--border)",
                minHeight: 120, overflow: "hidden",
              }}>
                <div style={{
                  padding: "6px 8px", borderBottom: "1px solid var(--border)",
                  background: isToday ? "#eff6ff" : "var(--surface2)",
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? "#2563eb" : "var(--text2)" }}>
                    {DAYS[i]}
                  </span>
                  <span style={{ fontSize: 11, color: isToday ? "#2563eb" : "var(--text2)" }}>
                    {new Date(y, m - 1, d).getDate()}
                  </span>
                </div>
                <div style={{ padding: "6px 6px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {daySessions.length === 0 ? (
                    <span style={{ fontSize: 11, color: "var(--text2)", padding: "8px 2px" }}>—</span>
                  ) : daySessions.map((s) => (
                    <div key={s.id} style={{
                      fontSize: 11, padding: "4px 6px", borderRadius: 5,
                      background: s.reimbursed ? "#f0fdf4" : s.is_peak ? "#fff7ed" : "#eff6ff",
                      border: s.reimbursed ? "1px solid #bbf7d0" : s.is_peak ? "1px solid #fed7aa" : "1px solid #bfdbfe",
                      color: "#1e293b",
                    }}>
                      <div style={{ fontWeight: 600 }}>{s.start_time}–{s.end_time}</div>
                      <div style={{ color: "#64748b" }}>{s.venue_name?.split(" ").slice(0, 3).join(" ")}</div>
                      {s.court_no && <div style={{ color: "#94a3b8" }}>Ct {s.court_no}</div>}
                      <div style={{ color: "#64748b", marginTop: 2 }}>S${s.reimbursement_total.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly list below */}
      <div className="mt-8" style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>All Court Bookings</h2>
          <span className="text-xs" style={{ color: "var(--text2)" }}>{sessions.length} total</span>
        </div>
        {sessions.length === 0 ? (
          <div className="text-sm text-slate-400 p-8 text-center">No court bookings yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Date</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Time</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Venue</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Court</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Booker</th>
                <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Reimb.</th>
                <th className="text-center px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 50).map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)", whiteSpace: "nowrap" }}>{s.date}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text2)", whiteSpace: "nowrap" }}>{s.start_time}–{s.end_time}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>{s.venue_name}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text2)" }}>{s.court_no ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text2)" }}>{s.booker_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-green-700">S${s.reimbursement_total.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-center">{statusBadge(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
