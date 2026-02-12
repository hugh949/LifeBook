"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useParticipantIdentity } from "./ParticipantIdentity";

export default function BottomNav() {
  const pathname = usePathname();
  const { listReady } = useParticipantIdentity();

  const link = (href: string, label: string) => {
    const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
    return (
      <Link
        href={href}
        onClick={(e) => !listReady && href !== "/" && e.preventDefault()}
        aria-current={isActive ? "page" : undefined}
        style={{
          pointerEvents: listReady || href === "/" ? undefined : "none",
          opacity: listReady || href === "/" ? undefined : 0.6,
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="app-bottom-nav" aria-label="Main">
      {link("/", "Home")}
      {link("/talk/session", "Create Memories")}
      {link("/talk/memories", "My Memories")}
      {link("/bank", "Shared Memories")}
    </nav>
  );
}
