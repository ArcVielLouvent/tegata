"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Request access" },
  { href: "/approver", label: "Approve access" },
];

/** Highlights the tab matching the current route. Split out from
 * layout.tsx (a server component) since usePathname() needs a client
 * boundary — keeping that boundary as small as this one nav strip
 * rather than making the whole layout a client component. */
export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? "active" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
