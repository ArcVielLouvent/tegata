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
      <body>
        <AuthProvider>
          <header className="topbar">
            <span className="brand">
              手形 <span className="brand-name">Tegata</span>
            </span>
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
