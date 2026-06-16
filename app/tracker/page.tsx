"use client";
import { useState, useEffect, useCallback } from "react";
import type { Coach, SessionInstance } from "@/lib/types";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

interface CoachSummary {
  coach: Coach;
  sessions: SessionInstance[];
  totalSessions: number;
  scheduledSessions: number;
  completedSessions: number;
  cancelledSessions: number;
  totalHours: number;
  totalEarnings: number;
}

export default function TrackerPage() {
  const [month, setMonth] = useState(currentMonth());
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [instances, setInstances] = useState<SessionInstance[]>([]);
  const [expandedCoach, setExpandedCoach] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    const [coachRes, instRes] = await Promise.all([
      fetch("/api/coaches"),
      fetch(`/api/session-instances?month=${month}`),
    ]);
    setCoaches(await coachRes.json());
    setInstances(await instRes.json());
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build month options: past 12 months + next 3
  const monthOptions = Array.from({ length: 15 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12 + i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return ym;
  });

  const summaries: CoachSummary[] = coaches.map((coach) => {
    const coachInsts = instances.filter((i) => i.coach_id === coach.id);
    const totalHours = coachInsts
      .filter((i) => i.status !== "cancelled")
      .reduce((acc, i) => acc + i.hours, 0);
    return {
      coach,
      sessions: coachInsts,
      totalSessions: coachInsts.length,
      scheduledSessions: coachInsts.filter((i) => i.status === "scheduled").length,
      completedSessions: coachInsts.filter((i) => i.status === "completed").length,
      cancelledSessions: coachInsts.filter((i) => i.status === "cancelled").length,
      totalHours,
      totalEarnings: totalHours * coach.hourly_rate,
    };
  }).filter((s) => s.totalSessions > 0);

  const grandTotalHours = summaries.reduce((acc, s) => acc + s.totalHours, 0);
  const grandTotalEarnings = summaries.reduce((acc, s) => acc + s.totalEarnings, 0);

  async function updateStatus(instId: number, status: string) {
    await fetch("/api/session-instances", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: instId, status }),
    });
    await fetchData();
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">Monthly Tracker</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">Month:</label>
          <select
            className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{summaries.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Active coaches</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-800">{grandTotalHours.toFixed(1)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Total hours</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-green-600">
            RM {grandTotalEarnings.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Total payroll</div>
        </div>
      </div>

      {summaries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          No sessions found for {monthLabel(month)}.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Coach</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Total</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Done</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Pending</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Cancelled</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Hours</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Earnings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map((s) => (
                <>
                  <tr
                    key={s.coach.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() =>
                      setExpandedCoach(expandedCoach === s.coach.id ? null : s.coach.id)
                    }
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{s.coach.name}</td>
                    <td className="px-3 py-3 text-center text-slate-700">{s.totalSessions}</td>
                    <td className="px-3 py-3 text-center text-green-600">{s.completedSessions}</td>
                    <td className="px-3 py-3 text-center text-blue-500">{s.scheduledSessions}</td>
                    <td className="px-3 py-3 text-center text-slate-400">{s.cancelledSessions}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      {s.totalHours.toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-semibold">
                      {s.totalEarnings > 0 ? `RM ${s.totalEarnings.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs">
                      {expandedCoach === s.coach.id ? "▲" : "▼"}
                    </td>
                  </tr>
                  {expandedCoach === s.coach.id && (
                    <tr key={`${s.coach.id}-detail`}>
                      <td colSpan={8} className="bg-slate-50 px-6 py-3">
                        <div className="text-xs font-medium text-slate-500 mb-2">
                          Session details for {monthLabel(month)}
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left pb-1">Date</th>
                              <th className="text-left pb-1">Time</th>
                              <th className="text-left pb-1">Venue</th>
                              <th className="text-right pb-1">Hours</th>
                              <th className="text-center pb-1">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {s.sessions
                              .sort((a, b) => a.date.localeCompare(b.date))
                              .map((inst) => (
                                <tr key={inst.id}>
                                  <td className="py-1 text-slate-700">{inst.date}</td>
                                  <td className="py-1 text-slate-500">
                                    {inst.start_time}–{inst.end_time}
                                  </td>
                                  <td className="py-1 text-slate-500">{inst.venue_name}</td>
                                  <td className="py-1 text-right text-slate-700">
                                    {inst.hours.toFixed(1)}h
                                  </td>
                                  <td className="py-1 text-center">
                                    <select
                                      value={inst.status}
                                      onChange={(e) => updateStatus(inst.id, e.target.value)}
                                      className={`text-xs border rounded px-1 py-0.5 ${
                                        inst.status === "completed"
                                          ? "text-green-700 border-green-200 bg-green-50"
                                          : inst.status === "cancelled"
                                          ? "text-red-500 border-red-200 bg-red-50"
                                          : "text-blue-600 border-blue-200 bg-blue-50"
                                      }`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <option value="scheduled">Scheduled</option>
                                      <option value="completed">Completed</option>
                                      <option value="cancelled">Cancelled</option>
                                    </select>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Total</td>
                <td className="px-3 py-3 text-center font-semibold">
                  {summaries.reduce((a, s) => a + s.totalSessions, 0)}
                </td>
                <td className="px-3 py-3 text-center text-green-600 font-semibold">
                  {summaries.reduce((a, s) => a + s.completedSessions, 0)}
                </td>
                <td className="px-3 py-3 text-center text-blue-500 font-semibold">
                  {summaries.reduce((a, s) => a + s.scheduledSessions, 0)}
                </td>
                <td className="px-3 py-3 text-center text-slate-400 font-semibold">
                  {summaries.reduce((a, s) => a + s.cancelledSessions, 0)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">
                  {grandTotalHours.toFixed(1)}h
                </td>
                <td className="px-4 py-3 text-right font-bold text-green-700">
                  RM {grandTotalEarnings.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
