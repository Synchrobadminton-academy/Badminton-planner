"use client";
import { useState, useEffect, useCallback } from "react";

interface Receipt {
  id: number;
  firebase_key: string;
  image_data: string;
  mime_type: string;
  created_at: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  hours: number | null;
  venue_name: string | null;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "scheduled";
  const cls =
    s === "completed"
      ? "bg-green-100 text-green-700 border-green-200"
      : s === "cancelled"
      ? "bg-red-100 text-red-500 border-red-200"
      : "bg-blue-100 text-blue-600 border-blue-200";
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${cls}`}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/receipts");
      setReceipts(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setSyncResult(`Error: ${data.error}`);
      } else {
        setSyncResult(
          `Synced ${data.synced} new session${data.synced !== 1 ? "s" : ""} and ${data.images} image${data.images !== 1 ? "s" : ""} (${data.total} total in Firebase)`
        );
        await fetchReceipts();
      }
    } catch (err) {
      setSyncResult(`Failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">Telegram Receipts</h1>
        <div className="flex items-center gap-3">
          {syncResult && (
            <span className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
              {syncResult}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? (
              <>
                <span className="animate-spin">↻</span> Syncing…
              </>
            ) : (
              <>↺ Sync from Telegram</>
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">Loading receipts…</div>
      ) : receipts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">📷</div>
          <div className="text-slate-600 font-medium mb-1">No receipts yet</div>
          <div className="text-sm text-slate-400 mb-4">
            Send booking photos to your Telegram group, then click &ldquo;Sync from Telegram&rdquo; above.
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
        <div className="grid gap-4 sm:grid-cols-2">
          {receipts.map((r) => (
            <div
              key={r.firebase_key}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Receipt image */}
              <div
                className="relative bg-slate-100 cursor-pointer"
                style={{ height: 200 }}
                onClick={() => setExpanded(expanded === r.firebase_key ? null : r.firebase_key)}
              >
                <img
                  src={`data:${r.mime_type};base64,${r.image_data}`}
                  alt="Receipt"
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-2 right-2 bg-black/40 text-white text-xs px-2 py-0.5 rounded">
                  {expanded === r.firebase_key ? "Click to collapse" : "Click to expand"}
                </div>
              </div>

              {expanded === r.firebase_key && (
                <div className="border-t border-slate-100 bg-slate-50 p-3 flex justify-center">
                  <img
                    src={`data:${r.mime_type};base64,${r.image_data}`}
                    alt="Receipt full"
                    className="max-w-full rounded"
                    style={{ maxHeight: 480 }}
                  />
                </div>
              )}

              {/* Booking details */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">
                      {r.venue_name ?? "Unknown Venue"}
                    </div>
                    {r.date && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {r.date}
                        {r.start_time && r.end_time && (
                          <> &bull; {r.start_time}–{r.end_time}</>
                        )}
                        {r.hours != null && <> &bull; {r.hours.toFixed(1)}h</>}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-2 text-xs text-slate-400 font-mono truncate">
                  {r.firebase_key}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
