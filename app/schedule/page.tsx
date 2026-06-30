"use client";
import { useState, useEffect, useCallback } from "react";
import type { Coach, Venue, SessionInstance } from "@/lib/types";

const HOUR_START = 6;
const HOUR_END = 22;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLORS = [
  "bg-blue-100 border-blue-300 text-blue-800",
  "bg-green-100 border-green-300 text-green-800",
  "bg-purple-100 border-purple-300 text-purple-800",
  "bg-orange-100 border-orange-300 text-orange-800",
  "bg-pink-100 border-pink-300 text-pink-800",
  "bg-teal-100 border-teal-300 text-teal-800",
  "bg-yellow-100 border-yellow-300 text-yellow-800",
];

function getWeekRange(baseDate: Date) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

function timeToDecimal(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h + m / 60;
}

function roundToHalf(decimal: number) {
  return Math.round(decimal * 2) / 2;
}

function decimalToTime(d: number) {
  const h = Math.floor(d);
  const m = d % 1 === 0.5 ? "30" : "00";
  return `${String(h).padStart(2, "0")}:${m}`;
}

interface SlotModal {
  date: string;
  dayIndex: number;
  startHour: number;
}

export default function SchedulePage() {
  const [baseDate, setBaseDate] = useState(() => new Date());
  const { monday, sunday } = getWeekRange(baseDate);

  const [instances, setInstances] = useState<SessionInstance[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [modal, setModal] = useState<SlotModal | null>(null);
  const [loading, setLoading] = useState(false);

  // form state
  const [form, setForm] = useState({
    coach_id: "",
    venue_id: "",
    start_time: "",
    end_time: "",
    recurring: false,
  });

  const fetchInstances = useCallback(async () => {
    const res = await fetch(
      `/api/sessions?week_start=${fmt(monday)}&week_end=${fmt(sunday)}`
    );
    setInstances(await res.json());
  }, [monday, sunday]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync from Telegram on first load so new bookings appear immediately
  useEffect(() => {
    fetch("/api/firebase-sync", { method: "POST" }).then(() => fetchInstances());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  useEffect(() => {
    fetch("/api/coaches").then((r) => r.json()).then(setCoaches);
    fetch("/api/venues").then((r) => r.json()).then(setVenues);
  }, []);

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const hours = Array.from(
    { length: (HOUR_END - HOUR_START) * 2 },
    (_, i) => HOUR_START + i * 0.5
  );

  function openSlot(date: Date, hour: number) {
    const start = decimalToTime(hour);
    const end = decimalToTime(hour + 1);
    setForm({
      coach_id: coaches[0]?.id ? String(coaches[0].id) : "",
      venue_id: venues[0]?.id ? String(venues[0].id) : "",
      start_time: start,
      end_time: end,
      recurring: false,
    });
    setModal({ date: fmt(date), dayIndex: date.getDay(), startHour: hour });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setLoading(true);
    try {
      const body = {
        coach_id: Number(form.coach_id),
        venue_id: Number(form.venue_id),
        start_time: form.start_time,
        end_time: form.end_time,
        recurring: form.recurring,
        day_of_week: form.recurring ? modal.dayIndex : null,
        date: form.recurring ? null : modal.date,
      };
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setModal(null);
      await fetchInstances();
    } finally {
      setLoading(false);
    }
  }

  async function deleteInstance(id: number) {
    await fetch(`/api/session-instances?id=${id}`, { method: "DELETE" });
    await fetchInstances();
  }

  async function cycleStatus(inst: SessionInstance) {
    const next =
      inst.status === "scheduled"
        ? "completed"
        : inst.status === "completed"
        ? "cancelled"
        : "scheduled";
    await fetch("/api/session-instances", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: inst.id, status: next }),
    });
    await fetchInstances();
  }

  const coachColorMap = new Map<number, string>();
  coaches.forEach((c, i) => coachColorMap.set(c.id, COLORS[i % COLORS.length]));

  // Map instances to date+time for rendering
  function getInstancesForSlot(date: Date, hour: number) {
    const dateStr = fmt(date);
    return instances.filter((inst) => {
      if (inst.date !== dateStr) return false;
      const s = timeToDecimal(inst.start_time);
      const e = timeToDecimal(inst.end_time);
      return s <= hour && e > hour;
    });
  }

  function isSlotStart(inst: SessionInstance, hour: number) {
    return timeToDecimal(inst.start_time) === hour;
  }

  return (
    <div>
      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => {
            const d = new Date(baseDate);
            d.setDate(d.getDate() - 7);
            setBaseDate(d);
          }}
          className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50"
        >
          ← Prev
        </button>
        <span className="font-semibold text-slate-700">
          {fmt(monday)} — {fmt(sunday)}
        </span>
        <button
          onClick={() => {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + 7);
            setBaseDate(d);
          }}
          className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50"
        >
          Next →
        </button>
        <button
          onClick={() => setBaseDate(new Date())}
          className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50 text-blue-600"
        >
          Today
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-3">
        {coaches.map((c) => (
          <span
            key={c.id}
            className={`text-xs px-2 py-0.5 rounded border ${coachColorMap.get(c.id) ?? ""}`}
          >
            {c.name}
          </span>
        ))}
        <span className="text-xs text-slate-400 ml-2">Click a cell to add session</span>
      </div>

      {/* Grid */}
      <div className="overflow-auto border rounded-lg bg-white shadow-sm">
        <table className="w-full border-collapse text-xs" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              <th className="w-14 border-r border-b border-slate-200 bg-slate-50 p-1 text-slate-400 font-normal sticky left-0 z-10">
                Time
              </th>
              {weekDates.map((d, i) => {
                const isToday = fmt(d) === fmt(new Date());
                return (
                  <th
                    key={i}
                    className={`border-r border-b border-slate-200 p-1 font-medium text-center ${
                      isToday ? "bg-blue-50 text-blue-700" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    <div>{DAYS[d.getDay()]}</div>
                    <div className={`text-base ${isToday ? "font-bold" : ""}`}>
                      {d.getDate()}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => {
              const isFullHour = hour % 1 === 0;
              return (
                <tr key={hour} className={isFullHour ? "" : "border-dashed"}>
                  <td className="border-r border-b border-slate-200 p-1 text-right text-slate-400 bg-slate-50 sticky left-0 z-10 whitespace-nowrap">
                    {isFullHour ? decimalToTime(hour) : ""}
                  </td>
                  {weekDates.map((d, di) => {
                    const slotInsts = getInstancesForSlot(d, hour);
                    const startingInsts = slotInsts.filter((i) => isSlotStart(i, hour));
                    return (
                      <td
                        key={di}
                        className="border-r border-b border-slate-100 p-0 relative align-top"
                        style={{ height: 28 }}
                        onClick={() => {
                          if (slotInsts.length === 0) openSlot(d, hour);
                        }}
                      >
                        {slotInsts.length === 0 && (
                          <div className="absolute inset-0 hover:bg-blue-50 cursor-pointer transition-colors" />
                        )}
                        {startingInsts.map((inst) => {
                          const durationHrs = timeToDecimal(inst.end_time) - timeToDecimal(inst.start_time);
                          const heightSlots = durationHrs * 2;
                          const color = coachColorMap.get(inst.coach_id) ?? COLORS[0];
                          const opacityClass =
                            inst.status === "cancelled"
                              ? "opacity-40 line-through"
                              : inst.status === "completed"
                              ? "opacity-70"
                              : "";
                          return (
                            <div
                              key={inst.id}
                              className={`absolute left-0 right-0 rounded border text-xs p-0.5 overflow-hidden z-10 ${color} ${opacityClass}`}
                              style={{
                                top: 0,
                                height: `${heightSlots * 28}px`,
                                cursor: "default",
                              }}
                            >
                              <div className="font-semibold truncate leading-tight">
                                {inst.coach_name}
                              </div>
                              <div className="truncate leading-tight text-slate-500">
                                {inst.venue_name}
                              </div>
                              <div className="flex gap-1 mt-0.5">
                                <button
                                  className="text-slate-400 hover:text-slate-700 text-xs"
                                  title={`Status: ${inst.status} — click to cycle`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cycleStatus(inst);
                                  }}
                                >
                                  {inst.status === "scheduled" ? "⬜" : inst.status === "completed" ? "✅" : "❌"}
                                </button>
                                <button
                                  className="text-red-300 hover:text-red-600 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm("Delete this instance?")) deleteInstance(inst.id);
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Session Modal */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-4 text-slate-800">
              Add Session — {modal.date} ({DAYS[modal.dayIndex]})
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Coach</label>
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={form.coach_id}
                  onChange={(e) => setForm({ ...form, coach_id: e.target.value })}
                  required
                >
                  <option value="">Select coach…</option>
                  {coaches.filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Venue</label>
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={form.venue_id}
                  onChange={(e) => setForm({ ...form, venue_id: e.target.value })}
                  required
                >
                  <option value="">Select venue…</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Start</label>
                  <input
                    type="time"
                    step="1800"
                    className="w-full border rounded px-2 py-1.5 text-sm"
                    value={form.start_time}
                    onChange={(e) => {
                      const s = e.target.value;
                      const sh = timeToDecimal(s);
                      setForm({ ...form, start_time: s, end_time: decimalToTime(sh + 1) });
                    }}
                    required
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">End</label>
                  <input
                    type="time"
                    step="1800"
                    className="w-full border rounded px-2 py-1.5 text-sm"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="recurring"
                  checked={form.recurring}
                  onChange={(e) => setForm({ ...form, recurring: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="recurring" className="text-sm text-slate-700">
                  Recurring every {DAYS[modal.dayIndex]}
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Add Session"}
                </button>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="px-4 py-2 text-sm border rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
