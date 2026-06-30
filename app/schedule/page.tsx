"use client";
import { useState, useEffect } from "react";

const FIREBASE_URL = "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Booking {
  _key?: string;
  date?: string;
  court_date?: string;
  time?: string;
  venue?: string;
  court?: string;
  class_type?: string;
  source?: string;
  booker?: string;
  color?: string;
  status?: string;
  notes?: string;
  bot_sessions_key?: string;
}

export default function SchedulePage() {
  const [currentView, setCurrentView] = useState("schedule");
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Load bookings from Firebase
  useEffect(() => {
    loadBookings();
    const interval = setInterval(loadBookings, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadBookings() {
    try {
      const res = await fetch(`${FIREBASE_URL}/bookings.json`);
      if (res.ok) {
        const data = await res.json();
        setBookings(data || {});
      }
    } catch (e) {
      console.error("Failed to load bookings:", e);
    }
  }

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const calendarDays = [];
  const current = new Date(startDate);
  while (current <= monthEnd) {
    calendarDays.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  function formatDate(d: Date) {
    return d.toISOString().split("T")[0];
  }

  function getBookingsForDate(dateStr: string) {
    return Object.entries(bookings)
      .filter(([, b]) => {
        const bDate = b.court_date || b.date;
        return bDate === dateStr;
      })
      .map(([k, b]) => ({ ...b, _key: k }));
  }

  function navigateMonth(offset: number) {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCurrentDate(newDate);
  }

  // Render calendar view
  const CalendarView = () => (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">
          {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => navigateMonth(-1)}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            ← Prev
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-4 py-2 border rounded hover:bg-gray-50 text-blue-600"
          >
            Today
          </button>
          <button
            onClick={() => navigateMonth(1)}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((day) => (
          <div key={day} className="text-center font-semibold text-sm p-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 bg-gray-100 p-1 rounded-lg">
        {calendarDays.map((day, idx) => {
          const dateStr = formatDate(day);
          const dayBookings = getBookingsForDate(dateStr);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = formatDate(day) === formatDate(new Date());

          return (
            <div
              key={idx}
              onClick={() => setSelectedDate(dateStr)}
              className={`min-h-24 p-2 rounded cursor-pointer border-2 ${
                isToday
                  ? "border-blue-500 bg-blue-50"
                  : selectedDate === dateStr
                  ? "border-blue-400 bg-blue-100"
                  : "border-gray-200 bg-white"
              } ${!isCurrentMonth ? "opacity-30" : ""}`}
            >
              <div className="font-semibold text-sm mb-1">{day.getDate()}</div>
              <div className="text-xs space-y-0.5">
                {dayBookings.slice(0, 2).map((b, i) => (
                  <div
                    key={i}
                    className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded truncate text-xs"
                  >
                    {b.venue || b.court || "Court"}
                  </div>
                ))}
                {dayBookings.length > 2 && (
                  <div className="text-xs text-gray-500">+{dayBookings.length - 2} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected date detail */}
      {selectedDate && (
        <div className="mt-6 border-t pt-6">
          <h3 className="font-semibold text-lg mb-4">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h3>

          <div className="space-y-4">
            {getBookingsForDate(selectedDate).length === 0 ? (
              <div className="text-gray-500 text-sm">No bookings for this date</div>
            ) : (
              getBookingsForDate(selectedDate).map((b, idx) => (
                <div key={idx} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold">{b.venue || "Unknown Venue"}</div>
                    <span className="text-xs px-2 py-1 bg-amber-200 text-amber-800 rounded">
                      {b.class_type || "ActiveSG"}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    <div>Court: {b.court || "N/A"}</div>
                    <div>Time: {b.time || "N/A"}</div>
                    {b.notes && <div className="mt-2 text-xs italic">{b.notes}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Render courts view
  const CourtsView = () => {
    const allDates = Array.from(
      new Set(
        Object.values(bookings)
          .map((b) => b.court_date || b.date)
          .filter(Boolean)
      )
    ).sort();

    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Courts</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allDates.map((date) => {
            const dayBookings = Object.entries(bookings)
              .filter(([, b]) => (b.court_date || b.date) === date)
              .map(([k, b]) => ({ ...b, _key: k }));

            return (
              <div key={date} className="border rounded-lg p-4 bg-gray-50">
                <div className="font-semibold mb-3">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="space-y-2">
                  {dayBookings.map((b, idx) => (
                    <div key={idx} className="text-sm p-2 bg-white rounded border-l-4 border-amber-400">
                      <div className="font-medium">{b.venue || "Court"}</div>
                      <div className="text-xs text-gray-600">{b.time || "TBD"}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render bookings view
  const BookingsView = () => (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Booking Records</h2>
      <div className="space-y-4">
        {Object.entries(bookings)
          .sort((a, b) => (b[1].court_date || b[1].date || "").localeCompare(a[1].court_date || a[1].date || ""))
          .map(([key, b]) => (
            <div key={key} className="border rounded-lg p-4 bg-white">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold">{b.venue || "Unknown"}</div>
                  <div className="text-sm text-gray-600">
                    {b.court_date || b.date} · {b.time || "N/A"}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 bg-gray-200 rounded">{b.source || "receipt"}</span>
              </div>
              {b.notes && <div className="text-sm text-gray-700 mt-2">{b.notes}</div>}
            </div>
          ))}
      </div>
    </div>
  );

  // Render receipts view
  const ReceiptsView = () => (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Receipts</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(bookings)
          .filter(([, b]) => b.bot_sessions_key)
          .map(([key, b]) => (
            <div key={key} className="border rounded-lg p-4 bg-gray-50">
              <div className="font-semibold mb-2">{b.venue || "Court"}</div>
              <div className="text-sm text-gray-600 mb-3">
                <div>{b.court_date || b.date}</div>
                <div>{b.time}</div>
              </div>
              <div className="aspect-video bg-gray-200 rounded flex items-center justify-center text-gray-500">
                Receipt Image
              </div>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-3xl font-bold">Badminton Planner</h1>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            {[
              { id: "schedule", label: "📅 Schedule" },
              { id: "courts", label: "🏸 Courts" },
              { id: "bookings", label: "📋 Bookings" },
              { id: "receipts", label: "🧾 Receipts" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentView(tab.id)}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  currentView === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto">
        {currentView === "schedule" && <CalendarView />}
        {currentView === "courts" && <CourtsView />}
        {currentView === "bookings" && <BookingsView />}
        {currentView === "receipts" && <ReceiptsView />}
      </div>
    </div>
  );
}
