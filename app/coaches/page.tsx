"use client";
import { useState, useEffect } from "react";
import type { Coach } from "@/lib/types";

const emptyForm = { name: "", contact: "", hourly_rate: "", active: true };

export default function CoachesPage() {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Coach | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchCoaches() {
    const res = await fetch("/api/coaches");
    setCoaches(await res.json());
  }

  useEffect(() => { fetchCoaches(); }, []);

  function startEdit(c: Coach) {
    setEditing(c);
    setForm({
      name: c.name,
      contact: c.contact,
      hourly_rate: String(c.hourly_rate),
      active: Boolean(c.active),
    });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        contact: form.contact.trim(),
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        active: form.active ? 1 : 0,
      };
      await fetch("/api/coaches", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      cancelEdit();
      await fetchCoaches();
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(c: Coach) {
    await fetch("/api/coaches", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, active: c.active ? 0 : 1 }),
    });
    await fetchCoaches();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800 mb-6">Coaches</h1>

      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="font-semibold text-slate-700 mb-4">
          {editing ? `Edit: ${editing.name}` : "Add New Coach"}
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Coach name"
              required
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Contact</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="Phone / email"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hourly Rate (RM)</label>
            <input
              type="number"
              min="0"
              step="0.50"
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={form.hourly_rate}
              onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div className="flex items-end gap-3 pb-0.5">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Active
            </label>
          </div>
          <div className="col-span-2 flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white rounded px-5 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : editing ? "Save Changes" : "Add Coach"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-5 py-2 text-sm border rounded hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Coach list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {coaches.length === 0 ? (
          <div className="text-slate-400 text-sm p-6 text-center">No coaches yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Rate / hr</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coaches.map((c) => (
                <tr key={c.id} className={`hover:bg-slate-50 ${!c.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.contact || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {c.hourly_rate > 0 ? `RM ${c.hourly_rate.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(c)}
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium cursor-pointer ${
                        c.active
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      }`}
                    >
                      {c.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => startEdit(c)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
