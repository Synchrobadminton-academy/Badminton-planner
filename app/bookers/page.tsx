"use client";
import { useState, useEffect } from "react";

interface BookerStat {
  name: string;
  sessions: number;
  hours: number;
  total_amount: number;
  venues: string[];
  last_date: string;
}

export default function BookersPage() {
  const [bookers, setBookers] = useState<BookerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/bookers")
      .then((r) => r.json())
      .then((data) => setBookers(data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = bookers.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Bookers</h1>
      <p className="text-sm mb-5" style={{ color: "var(--text2)" }}>
        Individuals who book courts — discovered from receipt data
      </p>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search bookers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            border: "1px solid var(--border)", borderRadius: 6, padding: "7px 12px",
            fontSize: 13, width: 260, background: "var(--surface)", color: "var(--text)",
            outline: "none",
          }}
        />
      </div>

      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        {loading ? (
          <div className="text-sm text-slate-400 p-8 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-slate-400 p-8 text-center">
            {bookers.length === 0
              ? "No bookers found. Sync from Firebase to discover bookers from receipt data."
              : "No bookers match your search."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Booker Name</th>
                <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Sessions</th>
                <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Hours</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Venues</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--text2)" }}>Last Booking</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.name} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text)" }}>{b.name}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{b.sessions}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>{b.hours.toFixed(1)}h</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text2)" }}>
                    {b.venues.slice(0, 2).join(", ")}{b.venues.length > 2 ? ` +${b.venues.length - 2}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text2)" }}>{b.last_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs mt-4" style={{ color: "var(--text2)" }}>
        Booker names are extracted automatically from court booking receipts sent via Telegram.
      </p>
    </div>
  );
}
