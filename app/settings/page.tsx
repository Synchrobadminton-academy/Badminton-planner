"use client";
import { useState, useEffect } from "react";

interface Venue {
  id: number;
  name: string;
  venue_type: string;
}

export default function SettingsPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [newVenue, setNewVenue] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchVenues() {
    const res = await fetch("/api/venues");
    setVenues(await res.json());
  }

  useEffect(() => {
    fetchVenues();
  }, []);

  async function addVenue(e: React.FormEvent) {
    e.preventDefault();
    if (!newVenue.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newVenue.trim() }),
      });
      setNewVenue("");
      await fetchVenues();
    } finally {
      setSaving(false);
    }
  }

  async function updateVenueType(id: number, venue_type: string) {
    await fetch("/api/venues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, venue_type }),
    });
    await fetchVenues();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">Manage venues and reimbursement configuration</p>

      {/* Venues */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-700">Venues</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Venue type determines the incentive rate applied to reimbursements
          </p>
        </div>

        {venues.length === 0 ? (
          <div className="text-slate-400 text-sm p-6 text-center">No venues yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Venue Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Type</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">Incentive Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {venues.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-800">{v.name}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={v.venue_type ?? "sports_hall"}
                      onChange={(e) => updateVenueType(v.id, e.target.value)}
                      className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <option value="school">School</option>
                      <option value="sports_hall">Sports Hall / Clubhouse</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-green-700">
                    {(v.venue_type ?? "sports_hall") === "school" ? "S$5.00/hr" : "S$2.50/hr"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
          <form onSubmit={addVenue} className="flex gap-2">
            <input
              type="text"
              placeholder="New venue name…"
              value={newVenue}
              onChange={(e) => setNewVenue(e.target.value)}
              className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="submit"
              disabled={saving || !newVenue.trim()}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add Venue"}
            </button>
          </form>
        </div>
      </div>

      {/* Reimbursement rules reference */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-700 mb-3">Reimbursement Rules</h2>
        <div className="text-sm text-slate-600 space-y-2">
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span>Weekday before 6 pm</span>
            <span className="font-medium text-slate-800">S$3.50/hr court cost</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span>Weekday after 6 pm / Weekend / Public holiday</span>
            <span className="font-medium text-slate-800">S$7.40/hr court cost</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span>School venue incentive</span>
            <span className="font-medium text-green-700">+S$5.00/hr</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span>Sports Hall / Clubhouse incentive</span>
            <span className="font-medium text-green-700">+S$2.50/hr</span>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Total reimbursement = court cost + incentive. Public holidays exclude in-lieu days.
        </p>
      </div>
    </div>
  );
}
