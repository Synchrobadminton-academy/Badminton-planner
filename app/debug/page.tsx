"use client";
import { useState, useEffect } from "react";

interface SyncStats {
  court_bookings: number;
  programme_sessions: number;
  attendance_records: number;
  receipts: number;
}

interface SyncResult {
  synced: number;
  images: number;
  attendance: number;
  total: number;
  errors?: string[];
}

export default function DebugPage() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [firebaseOk, setFirebaseOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [firebaseUrl, setFirebaseUrl] = useState<string>("");

  useEffect(() => {
    fetch("/api/firebase-sync")
      .then((r) => r.json())
      .then(setStats);
    fetch("/api/debug")
      .then((r) => r.json())
      .then((d) => setFirebaseUrl(d.firebase_url ?? ""));
  }, []);

  async function runSync() {
    setSyncing(true);
    setLastSync(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      setLastSync(data);
      const s = await fetch("/api/firebase-sync");
      setStats(await s.json());
    } finally {
      setSyncing(false);
    }
  }

  async function checkFirebase() {
    setChecking(true);
    setFirebaseOk(null);
    try {
      const res = await fetch("/api/debug/firebase");
      setFirebaseOk(res.ok);
    } catch {
      setFirebaseOk(false);
    } finally {
      setChecking(false);
    }
  }

  const StatRow = ({ label, value }: { label: string; value: number | string }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ color: "var(--text2)", fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{value}</span>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Debug</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text2)" }}>Sync diagnostics and system status</p>

      {/* Database stats */}
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20, marginBottom: 16 }}>
        <h2 className="font-semibold text-sm mb-3" style={{ color: "var(--text)" }}>Database Records (SQLite)</h2>
        {stats ? (
          <div>
            <StatRow label="Court Bookings" value={stats.court_bookings} />
            <StatRow label="Programme Sessions" value={stats.programme_sessions} />
            <StatRow label="Attendance Records" value={stats.attendance_records} />
            <StatRow label="Receipt Images" value={stats.receipts} />
          </div>
        ) : (
          <div style={{ color: "var(--text2)", fontSize: 13 }}>Loading…</div>
        )}
      </div>

      {/* Firebase check */}
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20, marginBottom: 16 }}>
        <h2 className="font-semibold text-sm mb-3" style={{ color: "var(--text)" }}>Firebase Connection</h2>
        {firebaseUrl && (
          <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, wordBreak: "break-all" }}>
            URL: {firebaseUrl}
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={checkFirebase}
            disabled={checking}
            style={{
              padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: "none", cursor: "pointer",
              background: checking ? "#94a3b8" : "#2563eb", color: "#fff",
              opacity: checking ? 0.7 : 1,
            }}
          >
            {checking ? "Checking…" : "Test Firebase Connection"}
          </button>
          {firebaseOk === true && (
            <span style={{ color: "#16a34a", fontWeight: 600, fontSize: 13 }}>✓ Connected</span>
          )}
          {firebaseOk === false && (
            <span style={{ color: "#dc2626", fontWeight: 600, fontSize: 13 }}>✗ Failed — check FIREBASE_URL env var</span>
          )}
        </div>
      </div>

      {/* Manual sync */}
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20, marginBottom: 16 }}>
        <h2 className="font-semibold text-sm mb-3" style={{ color: "var(--text)" }}>Manual Sync</h2>
        <button
          onClick={runSync}
          disabled={syncing}
          style={{
            padding: "8px 20px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            border: "none", cursor: "pointer",
            background: syncing ? "#94a3b8" : "#2563eb", color: "#fff",
            opacity: syncing ? 0.7 : 1,
          }}
        >
          {syncing ? "↻ Syncing…" : "↺ Sync from Firebase"}
        </button>
        {lastSync && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <StatRow label="New sessions synced" value={lastSync.synced} />
              <StatRow label="Images synced" value={lastSync.images} />
              <StatRow label="Attendance records added" value={lastSync.attendance} />
              <StatRow label="Total in Firebase" value={lastSync.total} />
            </div>
            {lastSync.errors && lastSync.errors.length > 0 && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: "#fef2f2", border: "1px solid #fecaca" }}>
                <p style={{ fontWeight: 600, fontSize: 12, color: "#dc2626", marginBottom: 6 }}>Errors ({lastSync.errors.length})</p>
                {lastSync.errors.map((e, i) => (
                  <p key={i} style={{ fontSize: 11, color: "#b91c1c", marginBottom: 2 }}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 20 }}>
        <h2 className="font-semibold text-sm mb-3" style={{ color: "var(--text)" }}>System Info</h2>
        <div>
          <StatRow label="SQLite storage" value="Ephemeral on Railway (auto-refills on load)" />
          <StatRow label="Data source" value="Firebase Realtime Database" />
          <StatRow label="Bot topics" value="5, 229 (topic 171 ignored)" />
          <StatRow label="Sync trigger" value="Page load + manual button" />
        </div>
      </div>
    </div>
  );
}
