"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

function dayLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface Session {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  status: string;
  coach_name: string;
  venue_name: string;
  class_type?: string;
  receipt_type?: string;
}

interface CourtRecord {
  reimbursement_total: number;
  reimbursed: number;
}

interface SyncStats {
  court_bookings: number;
  programme_sessions: number;
  attendance_records: number;
  receipts: number;
}

export default function DashboardPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [pendingReimb, setPendingReimb] = useState(0);
  const [stats, setStats] = useState<SyncStats | null>(null);

  const today = new Date();
  const twoWeeks = new Date(today);
  twoWeeks.setDate(today.getDate() + 13);

  const fetchData = useCallback(async () => {
    const [sessRes, courtRes, statsRes] = await Promise.all([
      fetch(`/api/sessions?week_start=${fmt(today)}&week_end=${fmt(twoWeeks)}`),
      fetch("/api/court-records"),
      fetch("/api/firebase-sync"),
    ]);
    const sessions: Session[] = await sessRes.json();
    const courtRecords: CourtRecord[] = await courtRes.json();
    const syncStats: SyncStats = await statsRes.json();

    setUpcoming(sessions.filter((s) => s.status !== "cancelled").slice(0, 12));
    setPendingReimb(
      courtRecords.filter((r) => !r.reimbursed).reduce((s, r) => s + r.reimbursement_total, 0)
    );
    setStats(syncStats);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/firebase-sync", { method: "POST" }).then(() => fetchData());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(`Synced ${data.synced} new entries`);
      await fetchData();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Badminton session overview</p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
              {syncMsg}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? <>↻ Syncing…</> : <>↺ Sync</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{stats?.court_bookings ?? "—"}</div>
          <div className="text-xs text-slate-500 mt-1">Court Bookings</div>
        </div>
        <div className="bg-white rounded-xl border border-amber-100 p-4">
          <div className="text-2xl font-bold text-amber-500">{stats?.programme_sessions ?? "—"}</div>
          <div className="text-xs text-slate-500 mt-1">Programme Sessions</div>
        </div>
        <div className="bg-white rounded-xl border border-purple-100 p-4">
          <div className="text-2xl font-bold text-purple-600">{stats?.attendance_records ?? "—"}</div>
          <div className="text-xs text-slate-500 mt-1">Attendance Records</div>
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-4">
          <div className="text-2xl font-bold text-red-600">S${pendingReimb.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">Pending Reimb.</div>
        </div>
      </div>

      {/* Upcoming sessions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-700 text-sm">Upcoming Sessions — Next 2 Weeks</h2>
          <Link href="/schedule" className="text-xs text-blue-600 hover:underline">
            Full schedule →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-slate-400 text-sm p-8 text-center">No upcoming sessions</div>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {upcoming.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                    {dayLabel(s.date)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                    {s.start_time}–{s.end_time}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{s.coach_name}</td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs">{s.venue_name}</td>
                  <td className="px-4 py-2.5 text-right">
                    {s.class_type && (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        {s.class_type}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { href: "/court-records", label: "Court Records", desc: "Reimbursement tracking", border: "border-red-200 hover:border-red-400" },
          { href: "/attendance", label: "Attendance", desc: "Programme attendance", border: "border-purple-200 hover:border-purple-400" },
          { href: "/receipts", label: "Receipts", desc: "Receipt image gallery", border: "border-amber-200 hover:border-amber-400" },
          { href: "/tracker", label: "Monthly Tracker", desc: "Coach hours & payroll", border: "border-green-200 hover:border-green-400" },
          { href: "/coaches", label: "Coaches", desc: "Manage coaches", border: "border-blue-200 hover:border-blue-400" },
          { href: "/settings", label: "Settings", desc: "Venues & rules", border: "border-slate-200 hover:border-slate-400" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`bg-white rounded-xl border p-4 transition-colors ${l.border}`}
          >
            <div className="font-medium text-slate-700 text-sm">{l.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
