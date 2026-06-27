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
  booker_name: string | null;
  reimbursed: number;
  venue_name: string | null;
  image_data: string | null;
  mime_type: string | null;
}

/** Group slots by receipt_ref (one receipt = one booking event, possibly multiple slots) */
function groupByReceipt(records: CourtRecord[]): Map<string, CourtRecord[]> {
  const map = new Map<string, CourtRecord[]>();
  for (const r of records) {
    const key = r.receipt_ref ?? r.firebase_key;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return map;
}

export default function CourtRecordsPage() {
  const [records, setRecords] = useState<CourtRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<CourtRecord | null>(null);
  const [reimbursing, setReimbursing] = useState<string | null>(null);

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
    // Auto-sync on mount then fetch
    (async () => {
      await fetch("/api/firebase-sync", { method: "POST" });
      await fetchRecords();
    })();
  }, [fetchRecords]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(`Synced ${data.synced} new entry/entries`);
      await fetchRecords();
    } finally {
      setSyncing(false);
    }
  }

  async function toggleReimbursed(receipt_ref: string, current: number) {
    setReimbursing(receipt_ref);
    try {
      await fetch("/api/court-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_ref, reimbursed: !current }),
      });
      await fetchRecords();
    } finally {
      setReimbursing(null);
    }
  }

  const grouped = groupByReceipt(records);
  const groupEntries = Array.from(grouped.entries()).sort(([, a], [, b]) =>
    b[0].date.localeCompare(a[0].date)
  );

  // Totals
  const uniqueReceipts = Array.from(
    new Map(records.filter((r) => r.receipt_ref).map((r) => [r.receipt_ref!, r])).values()
  );
  const totalPaid = uniqueReceipts.reduce((s, r) => s + parseFloat(r.total_amount || "0"), 0);
  const totalPending = uniqueReceipts
    .filter((r) => !r.reimbursed)
    .reduce((s, r) => s + parseFloat(r.total_amount || "0"), 0);
  const totalReimbursed = uniqueReceipts
    .filter((r) => r.reimbursed)
    .reduce((s, r) => s + parseFloat(r.total_amount || "0"), 0);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Court Records</h1>
          <p className="text-sm text-slate-500 mt-0.5">One-off ActiveSG court bookings &amp; reimbursements</p>
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

      {/* Summary cards */}
      {records.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-2xl font-bold text-slate-800">S${totalPaid.toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Total paid</div>
          </div>
          <div className="bg-white rounded-lg border border-red-100 p-4">
            <div className="text-2xl font-bold text-red-600">S${totalPending.toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Pending reimbursement</div>
          </div>
          <div className="bg-white rounded-lg border border-green-100 p-4">
            <div className="text-2xl font-bold text-green-600">S${totalReimbursed.toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Reimbursed</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">Loading…</div>
      ) : groupEntries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">🏸</div>
          <div className="text-slate-600 font-medium mb-1">No court records yet</div>
          <div className="text-sm text-slate-400 mb-4">
            Send an ActiveSG court booking receipt to the Telegram group and sync.
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
                <th className="text-left px-3 py-3 font-medium text-slate-600">Booked by</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Slots</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Reimbursed</th>
                <th className="text-center px-3 py-3 font-medium text-slate-600">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupEntries.map(([receiptRef, slots]) => {
                const first = slots[0];
                const isExpanded = expanded === receiptRef;
                const isReimbursed = !!first.reimbursed;

                return (
                  <>
                    <tr
                      key={receiptRef}
                      className={`hover:bg-slate-50 cursor-pointer ${
                        isReimbursed ? "opacity-60" : ""
                      }`}
                      onClick={() => setExpanded(isExpanded ? null : receiptRef)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">{first.date}</td>
                      <td className="px-4 py-3 text-slate-600">{first.venue_name ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600 font-medium">
                        {first.booker_name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-700">
                        {slots.length}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">
                        {first.total_amount ? `S$${first.total_amount}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (first.receipt_ref) {
                              toggleReimbursed(first.receipt_ref, first.reimbursed);
                            }
                          }}
                          disabled={!first.receipt_ref || reimbursing === first.receipt_ref}
                          className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors ${
                            isReimbursed
                              ? "bg-green-100 text-green-700 border-green-300"
                              : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                          }`}
                        >
                          {reimbursing === first.receipt_ref
                            ? "…"
                            : isReimbursed
                            ? "✓ Done"
                            : "Pending"}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {first.image_data ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox(first);
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

                    {isExpanded && (
                      <tr key={`${receiptRef}-detail`}>
                        <td colSpan={7} className="bg-slate-50 px-6 py-3">
                          <div className="text-xs font-medium text-slate-500 mb-2">
                            Slot breakdown · Ref: {first.receipt_ref ?? "n/a"}
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400">
                                <th className="text-left pb-1 font-medium">Time</th>
                                <th className="text-left pb-1 font-medium">Court</th>
                                <th className="text-left pb-1 font-medium">Hours</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {slots.map((s) => (
                                <tr key={s.id}>
                                  <td className="py-1 text-slate-700">
                                    {s.start_time}–{s.end_time}
                                  </td>
                                  <td className="py-1 text-slate-600">
                                    {s.court_no ? `Court ${s.court_no}` : "—"}
                                  </td>
                                  <td className="py-1 text-slate-600">{s.hours.toFixed(1)}h</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
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
              <div>
                <div className="font-medium text-slate-800 text-sm">{lightbox.venue_name}</div>
                <div className="text-xs text-slate-500">
                  {lightbox.date}
                  {lightbox.booker_name && <> · Booked by {lightbox.booker_name}</>}
                  {lightbox.total_amount && <> · S${lightbox.total_amount}</>}
                </div>
              </div>
              <button onClick={() => setLightbox(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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
