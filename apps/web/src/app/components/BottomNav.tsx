"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; match: (path: string) => boolean };

const TABS: Tab[] = [
  { href: "/talk", label: "Talk", match: (p) => p === "/talk" || p.startsWith("/talk/") },
  { href: "/library", label: "Library", match: (p) => p === "/library" || p.startsWith("/library/") },
  { href: "/me", label: "Me", match: (p) => p === "/me" || p.startsWith("/me/") },
];

export default function BottomNav() {
  const pathname = usePathname() || "";
  return (
    <nav className="app-bottom-nav" aria-label="Main">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={active ? "active" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
