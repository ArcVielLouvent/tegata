import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AuthProvider } from "../lib/AuthContext";
import { AuthStatus } from "../lib/AuthStatus";

export const metadata: Metadata = {
  title: "Tegata — Access Warrant Demo",
  description: "Time-boxed privileged access authorization — demo UI (Phase 6).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Yuji Mai: a real brush-calligraphy style Google Font, used only
            for the 手形 kanji mark — a plain sans-serif rendering of the
            logo undersold the "travel permit" concept the whole project
            is named after. Loaded via a plain <link> (not next/font)
            so it degrades gracefully to the serif fallback if the
            person's browser can't reach Google Fonts, rather than
            failing the build. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Yuji+Mai&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-kanji">手形</span>
              <span className="brand-name">Tegata</span>
            </Link>
            <nav className="row">
              <Link href="/">Requester</Link>
              <Link href="/approver">Approver</Link>
              <AuthStatus />
            </nav>
          </header>
          <main className="page">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
