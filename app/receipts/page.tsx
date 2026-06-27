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
  receipt_type: string | null;
  court_no: string | null;
  total_amount: string | null;
  receipt_ref: string | null;
  class_type: string | null;
  programme_name: string | null;
  venue_name: string | null;
}

function TypeBadge({ type }: { type: string | null }) {
  if (type === "court_booking")
    return (
      <span className="text-xs px-2 py-0.5 rounded border font-medium bg-red-50 text-red-600 border-red-200">
        Court Booking
      </span>
    );
  if (type === "programme_roster")
    return (
      <span className="text-xs px-2 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">
        Programme
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded border font-medium bg-slate-100 text-slate-500 border-slate-200">
      Unknown
    </span>
  );
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<Receipt | null>(null);
  const [filter, setFilter] = useState<"all" | "court_booking" | "programme_roster">("all");

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
    // Auto-sync from Telegram on load so receipts are always current
    fetch("/api/firebase-sync", { method: "POST" }).then(() => fetchReceipts());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          `Synced ${data.synced} new session${data.synced !== 1 ? "s" : ""} and ${data.images} image${data.images !== 1 ? "s" : ""}`
        );
        await fetchReceipts();
      }
    } catch (err) {
      setSyncResult(`Failed: ${err}`);
    } finally {
      setSyncing(false);
    }
  }

  const visible =
    filter === "all" ? receipts : receipts.filter((r) => r.receipt_type === filter);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-slate-800">Receipts</h1>
        <div className="flex items-center gap-3">
          {syncResult && (
            <span className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
              {syncResult}
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

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5">
        {(["all", "court_booking", "programme_roster"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              filter === f
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100 border border-slate-200"
            }`}
          >
            {f === "all"
              ? `All (${receipts.length})`
              : f === "court_booking"
              ? `Court Bookings (${receipts.filter((r) => r.receipt_type === "court_booking").length})`
              : `Programmes (${receipts.filter((r) => r.receipt_type === "programme_roster").length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">Loading receipts…</div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">📷</div>
          <div className="text-slate-600 font-medium mb-1">No receipts yet</div>
          <div className="text-sm text-slate-400 mb-4">
            Send booking photos to your Telegram group, then click &ldquo;Sync from Telegram&rdquo;.
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <div
              key={r.firebase_key}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
            >
              {/* Thumbnail */}
              <div
                className="relative bg-slate-100 cursor-zoom-in flex-shrink-0"
                style={{ height: 180 }}
                onClick={() => setLightbox(r)}
              >
                <img
                  src={`data:${r.mime_type};base64,${r.image_data}`}
                  alt="Receipt"
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Details */}
              <div className="p-3 flex-1 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <TypeBadge type={r.receipt_type} />
                  {r.date && (
                    <span className="text-xs text-slate-500">{r.date}</span>
                  )}
                </div>

                <div className="font-semibold text-slate-800 text-sm leading-tight mt-1">
                  {r.receipt_type === "programme_roster" && r.programme_name
                    ? r.programme_name
                    : (r.venue_name ?? "Unknown Venue")}
                </div>

                {r.receipt_type === "court_booking" ? (
                  <div className="text-xs text-slate-500 space-y-0.5">
                    {r.start_time && r.end_time && (
                      <div>{r.start_time}–{r.end_time}{r.court_no && ` · Court ${r.court_no}`}</div>
                    )}
                    {r.total_amount && (
                      <div className="font-semibold text-red-600">S${r.total_amount}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 space-y-0.5">
                    {r.class_type && <div>{r.class_type}</div>}
                    {r.start_time && r.end_time && (
                      <div>{r.start_time}–{r.end_time}{r.court_no && ` · Court ${r.court_no}`}</div>
                    )}
                    {r.venue_name && <div>{r.venue_name}</div>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div>
                <div className="font-medium text-slate-800 text-sm">
                  {lightbox.receipt_type === "programme_roster" && lightbox.programme_name
                    ? lightbox.programme_name
                    : lightbox.venue_name}
                </div>
                {lightbox.date && (
                  <div className="text-xs text-slate-500">{lightbox.date}</div>
                )}
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <img
              src={`data:${lightbox.mime_type};base64,${lightbox.image_data}`}
              alt="Receipt full size"
              className="w-full object-contain"
              style={{ maxHeight: 600 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
