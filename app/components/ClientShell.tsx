"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const COACHES_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/attendance", label: "Attendance" },
  { href: "/courts", label: "Courts" },
];

const ADMIN_LINKS = [
  { href: "/tracker", label: "Tracker" },
  { href: "/analytics", label: "Analytics" },
  { href: "/coaches", label: "Cal. Settings" },
  { href: "/bookers", label: "Bookers" },
  { href: "/booking-records", label: "Booking Records" },
  { href: "/receipts", label: "Receipts" },
  { href: "/debug", label: "Debug" },
];

const SIDEBAR_BG = "#1e293b";
const SIDEBAR_BORDER = "#334155";
const SIDEBAR_TEXT = "#94a3b8";
const SIDEBAR_HOVER = "#334155";
const SIDEBAR_ACTIVE_BG = "#2563eb";
const SIDEBAR_ACTIVE_TEXT = "#ffffff";
const TOPBAR_BG = "#0f172a";

function SidebarLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block",
        padding: "6px 14px 6px 30px",
        color: active ? SIDEBAR_ACTIVE_TEXT : hovered ? "#e2e8f0" : SIDEBAR_TEXT,
        background: active ? SIDEBAR_ACTIVE_BG : hovered ? SIDEBAR_HOVER : "transparent",
        textDecoration: "none",
        fontSize: 13,
        transition: "background 0.1s, color 0.1s",
        borderLeft: active ? "3px solid #60a5fa" : "3px solid transparent",
        paddingLeft: active ? 27 : 27,
      }}
    >
      {label}
    </Link>
  );
}

function FolderSection({
  icon, label, links, pathname,
}: {
  icon: string;
  label: string;
  links: { href: string; label: string }[];
  pathname: string;
}) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "7px 12px",
          background: hovered ? "rgba(255,255,255,0.05)" : "none",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12 }}>{icon}</span> {label}
        </span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && links.map((l) => (
        <SidebarLink key={l.href} href={l.href} label={l.label} active={isActive(l.href)} />
      ))}
    </div>
  );
}

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("synchro-dark") === "true";
    setDark(saved);
    if (saved) document.documentElement.setAttribute("data-dark", "");
    else document.documentElement.removeAttribute("data-dark");
  }, []);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-dark", "");
    else document.documentElement.removeAttribute("data-dark");
    localStorage.setItem("synchro-dark", String(next));
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/firebase-sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(`✓ +${data.synced ?? 0} sessions`);
      setTimeout(() => setSyncMsg(null), 4000);
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const sw = sidebarOpen ? 220 : 0;

  return (
    <>
      {/* Top bar */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 50, zIndex: 200,
        background: TOPBAR_BG, borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", padding: "0 12px", gap: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="Toggle sidebar"
          style={{
            color: "#94a3b8", background: "none", border: "none", cursor: "pointer",
            fontSize: 17, padding: "4px 6px", lineHeight: 1, borderRadius: 4,
          }}
        >
          ☰
        </button>
        <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
          🏸 Synchro
        </span>
        <div style={{ flex: 1 }} />
        {syncMsg && (
          <span style={{ color: "#86efac", fontSize: 12, fontWeight: 500 }}>{syncMsg}</span>
        )}
        <button
          onClick={toggleDark}
          title={dark ? "Light mode" : "Dark mode"}
          style={{
            color: "#94a3b8", background: "none", border: "none", cursor: "pointer",
            fontSize: 15, padding: "4px 7px", lineHeight: 1, borderRadius: 4,
          }}
        >
          {dark ? "☀️" : "🌙"}
        </button>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            background: syncing ? "#1d4ed8" : "#2563eb", color: "#fff",
            border: "none", borderRadius: 6, padding: "5px 14px",
            fontSize: 12, fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer",
            opacity: syncing ? 0.75 : 1, letterSpacing: "0.01em",
          }}
        >
          {syncing ? "↻ Syncing…" : "↺ Sync"}
        </button>
      </header>

      {/* Sidebar */}
      <aside style={{
        position: "fixed", top: 50, bottom: 0, left: 0,
        width: sw, overflow: "hidden", transition: "width 0.2s ease", zIndex: 100,
        background: SIDEBAR_BG, borderRight: `1px solid ${SIDEBAR_BORDER}`,
      }}>
        <div style={{ width: 220, height: "100%", overflowY: "auto", paddingTop: 8, paddingBottom: 16 }}>
          <FolderSection icon="📁" label="Coaches" links={COACHES_LINKS} pathname={pathname} />
          <div style={{ height: 1, background: SIDEBAR_BORDER, margin: "6px 0" }} />
          <FolderSection icon="📁" label="Admin" links={ADMIN_LINKS} pathname={pathname} />
        </div>
      </aside>

      {/* Main */}
      <main style={{
        marginLeft: sw, marginTop: 50,
        minHeight: "calc(100vh - 50px)",
        padding: "24px",
        transition: "margin-left 0.2s ease",
        background: "var(--bg)",
        color: "var(--text)",
      }}>
        {children}
      </main>
    </>
  );
}
