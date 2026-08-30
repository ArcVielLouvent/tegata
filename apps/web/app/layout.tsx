import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AuthProvider } from "../lib/AuthContext";
import { AuthStatus } from "../lib/AuthStatus";
import { NavTabs } from "../lib/NavTabs";

export const metadata: Metadata = {
  title: "Tegata — Access Warrant Demo",
  description: "Time-boxed privileged access authorization — demo UI (Phase 6).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Three fonts, one intent — this should read as a stamped travel
            permit, not a generic SaaS dashboard:
              - Shippori Mincho: the 手形 kanji mark AND page headings
                (a real Japanese mincho, not a plain sans pretending).
              - Zen Kaku Gothic New: body/UI text. Same type family as
                the mincho counterpart above, so headings and body feel
                designed together instead of a Japanese logo bolted onto
                a generic UI font.
              - JetBrains Mono: warrant IDs, hashes, risk-factor numbers
                — anything the person might need to copy or compare
                character-for-character.
            Loaded via a plain <link> (not next/font) so it degrades
            gracefully to the serif/sans-serif fallback if the person's
            browser can't reach Google Fonts, rather than failing the
            build. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-kanji">手形</span>
              <span className="brand-name">Tegata</span>
            </Link>
            <NavTabs />
            <AuthStatus />
          </header>
          <main className="page">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
