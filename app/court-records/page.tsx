"use client";
import { useState, useEffect, useCallback } from "react";

interface CourtRecord {
  id: number;
  firebase_key: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  status: string;
  court_no: string | null;
  total_amount: string | null;
  receipt_ref: string | null;
  venue_name: string | null;
  image_data: string | null;
  mime_type: string | null;
}

function groupByDate(records: CourtRecord[]): [string, CourtRecord[]][] {
  const map = new Map<string, CourtRecord[]>();
  for (const r of records) {
    const list = map.get(r.date) ?? [];
    list.push(r);
    map.set(r.date, list);
  }
  return Array.from(map.entries());
}

function totalForDate(records: CourtRecord[]): string {
  // The receipt covers all slots; show the amount from the first entry that has it
  const withAmount = records.find((r) => r.total_amount);
  return withAmount ? `S$${withAmount.total_amount}` : "—";
}

export default function CourtRecordsPage() {
  const [records, setRecords] = useState<CourtRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<CourtRecord | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/court-records");
      setRecords(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setSyncMsg(`Error: ${data.error}`);
      } else {
        setSyncMsg(`Synced ${data.synced} new entry/entries and ${data.images} image(s)`);
        await fetchRecords();
      }
    } catch (err) {
      setSyncMsg(`Failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  }

  const grouped = groupByDate(records);

  // Grand total paid
  const grandTotal = records
    .filter((r) => r.total_amount && r.receipt_ref)
    // dedupe by receipt_ref (same receipt = same charge)
    .reduce<{ refs: Set<string>; total: number }>(
      (acc, r) => {
        if (!acc.refs.has(r.receipt_ref!)) {
          acc.refs.add(r.receipt_ref!);
          acc.total += parseFloat(r.total_amount || "0");
        }
        return acc;
      },
      { refs: new Set(), total: 0 }
    ).total;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Court Records</h1>
          <p className="text-sm text-slate-500 mt-0.5">One-off ActiveSG court bookings</p>
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
            {syncing ? <>↻ Syncing…</> : <>↺ Sync from Telegram</>}
          </button>
        </div>
      </div>

      {/* Summary */}
      {records.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-2xl font-bold text-slate-800">{grouped.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">Booking dates</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-2xl font-bold text-slate-800">{records.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">Total court slots</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-2xl font-bold text-red-600">S${grandTotal.toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Total paid</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">Loading…</div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">🏸</div>
          <div className="text-slate-600 font-medium mb-1">No court records yet</div>
          <div className="text-sm text-slate-400 mb-4">
            Send an ActiveSG court booking receipt to the Telegram group, then sync.
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-blue-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Venue</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Slots</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Paid</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grouped.map(([date, dayRecords]) => (
                <>
                  <tr
                    key={date}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedDate(expandedDate === date ? null : date)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{date}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {dayRecords[0]?.venue_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-center text-slate-700">
                      {dayRecords.length} slot{dayRecords.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-700">
                      {totalForDate(dayRecords)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {dayRecords[0]?.image_data ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox(dayRecords[0]);
                          }}
                          className="text-blue-500 hover:text-blue-700 text-xs underline"
                        >
                          View
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>

                  {expandedDate === date && (
                    <tr key={`${date}-detail`}>
                      <td colSpan={5} className="bg-slate-50 px-6 py-3">
                        <div className="text-xs font-medium text-slate-500 mb-2">
                          Slot details
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left pb-1">Time</th>
                              <th className="text-left pb-1">Court</th>
                              <th className="text-left pb-1">Hours</th>
                              <th className="text-left pb-1">Ref</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {dayRecords.map((r) => (
                              <tr key={r.id}>
                                <td className="py-1 text-slate-700">
                                  {r.start_time}–{r.end_time}
                                </td>
                                <td className="py-1 text-slate-600">
                                  {r.court_no ? `Court ${r.court_no}` : "—"}
                                </td>
                                <td className="py-1 text-slate-600">{r.hours.toFixed(1)}h</td>
                                <td className="py-1 text-slate-400 font-mono text-xs">
                                  {r.receipt_ref ?? "—"}
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
          </table>
        </div>
      )}

      {/* Receipt lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <span className="font-medium text-slate-800 text-sm">
                {lightbox.date} — {lightbox.venue_name}
              </span>
              <button
                onClick={() => setLightbox(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <img
              src={`data:${lightbox.mime_type};base64,${lightbox.image_data}`}
              alt="Court booking receipt"
              className="w-full object-contain"
              style={{ maxHeight: 560 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
