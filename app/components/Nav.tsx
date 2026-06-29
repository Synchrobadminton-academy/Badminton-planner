"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/coaches", label: "Coaches" },
  { href: "/tracker", label: "Tracker" },
  { href: "/attendance", label: "Attendance" },
  { href: "/court-records", label: "Court Records" },
  { href: "/receipts", label: "Receipts" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-6">
        <span className="font-bold text-blue-700 text-base whitespace-nowrap">
          🏸 Coach Planner
        </span>
        <div className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                pathname.startsWith(l.href)
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
