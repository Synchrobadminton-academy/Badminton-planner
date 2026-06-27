"use client";
import { useState, useEffect, useCallback } from "react";

interface AttendanceSession {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  programme_name: string | null;
  class_type: string | null;
  court_no: string | null;
  venue_name: string | null;
  total_participants: number;
  present_count: number;
  absent_count: number;
  excused_count: number;
}

interface AttendanceRecord {
  id: number;
  participant_name: string;
  status: "present" | "absent" | "excused";
}

const STATUS_CYCLE: Record<string, "present" | "absent" | "excused"> = {
  absent: "present",
  present: "excused",
  excused: "absent",
};

const STATUS_STYLE: Record<string, string> = {
  present: "bg-green-100 text-green-700 border-green-300",
  absent:  "bg-slate-100 text-slate-500 border-slate-200",
  excused: "bg-amber-100 text-amber-700 border-amber-300",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent:  "Absent",
  excused: "Excused",
};

export default function AttendancePage() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selected, setSelected] = useState<AttendanceSession | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/attendance");
      setSessions(await res.json());
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    // Auto-sync then load
    (async () => {
      await fetch("/api/firebase-sync", { method: "POST" });
      await fetchSessions();
    })();
  }, [fetchSessions]);

  async function selectSession(s: AttendanceSession) {
    setSelected(s);
    setLoadingRecords(true);
    try {
      const res = await fetch(`/api/attendance?session_id=${s.id}`);
      setRecords(await res.json());
    } finally {
      setLoadingRecords(false);
    }
  }

  async function cycleStatus(record: AttendanceRecord) {
    const next = STATUS_CYCLE[record.status] ?? "present";
    setUpdating(record.id);
    try {
      const res = await fetch("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, status: next }),
      });
      const updated = await res.json();
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));

      // Refresh session summary counts
      fetchSessions();
    } finally {
      setUpdating(null);
    }
  }

  async function markAll(status: "present" | "absent") {
    if (!selected) return;
    for (const r of records) {
      if (r.status !== status) {
        await fetch("/api/attendance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, status }),
        });
      }
    }
    const res = await fetch(`/api/attendance?session_id=${selected.id}`);
    setRecords(await res.json());
    fetchSessions();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(`Synced ${data.synced} session(s), ${data.attendance} attendance records`);
      await fetchSessions();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Attendance</h1>
          <p className="text-sm text-slate-500 mt-0.5">Programme sessions auto-filled from rosters</p>
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

      <div className="flex gap-4" style={{ minHeight: 480 }}>
        {/* Session list */}
        <div className="w-72 flex-shrink-0">
          {loadingSessions ? (
            <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
              <div className="text-3xl mb-2">📋</div>
              <div className="text-sm text-slate-500">No programme sessions yet.</div>
              <div className="text-xs text-slate-400 mt-1">Send a roster to Telegram and sync.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const pct =
                  s.total_participants > 0
                    ? Math.round((s.present_count / s.total_participants) * 100)
                    : 0;
                const isSelected = selected?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectSession(s)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? "border-blue-400 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-semibold text-slate-800 text-xs leading-tight truncate">
                      {s.programme_name || s.class_type || "Programme Session"}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {s.date} · {s.start_time}–{s.end_time}
                    </div>
                    <div className="text-xs text-slate-400 truncate">{s.venue_name}</div>
                    {s.total_participants > 0 && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {s.present_count}/{s.total_participants}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Attendance detail */}
        <div className="flex-1">
          {!selected ? (
            <div className="bg-white rounded-xl border border-slate-200 h-full flex items-center justify-center">
              <div className="text-center text-slate-400">
                <div className="text-3xl mb-2">👈</div>
                <div className="text-sm">Select a session to take attendance</div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Session header */}
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="font-semibold text-slate-800">
                  {selected.programme_name || selected.class_type || "Programme Session"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {selected.date} · {selected.start_time}–{selected.end_time}
                  {selected.venue_name && <> · {selected.venue_name}</>}
                  {selected.court_no && <> · Court {selected.court_no}</>}
                </div>
                {/* Quick mark buttons */}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => markAll("present")}
                    className="text-xs px-2.5 py-1 rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  >
                    Mark all present
                  </button>
                  <button
                    onClick={() => markAll("absent")}
                    className="text-xs px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {/* Summary chips */}
              <div className="px-4 py-2 border-b border-slate-100 flex gap-3 text-xs">
                <span className="text-green-600 font-medium">{selected.present_count} present</span>
                <span className="text-slate-400">{selected.absent_count} absent</span>
                {selected.excused_count > 0 && (
                  <span className="text-amber-600">{selected.excused_count} excused</span>
                )}
                <span className="text-slate-400 ml-auto">{selected.total_participants} total</span>
              </div>

              {/* Participant list */}
              {loadingRecords ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {records.map((r, idx) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                    >
                      <span className="text-xs text-slate-300 w-5 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <span className="flex-1 text-sm text-slate-800">{r.participant_name}</span>
                      <button
                        onClick={() => cycleStatus(r)}
                        disabled={updating === r.id}
                        className={`text-xs px-3 py-1 rounded border font-medium min-w-16 text-center transition-colors ${
                          STATUS_STYLE[r.status]
                        } ${updating === r.id ? "opacity-50" : "hover:opacity-80"}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
