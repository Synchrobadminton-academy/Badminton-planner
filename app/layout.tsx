import type { Metadata } from "next";
import "./globals.css";
import ClientShell from "./components/ClientShell";

export const metadata: Metadata = {
  title: "Synchro Planner",
  description: "Badminton coaching & court management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
