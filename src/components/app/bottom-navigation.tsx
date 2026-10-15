"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck2, CalendarDays, Inbox, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const TABS: Tab[] = [
  { href: "/", label: "Calendrier", icon: CalendarDays, match: (p) => p === "/" || p.startsWith("/calendar") },
  { href: "/availability", label: "Mes dispos", icon: CalendarCheck2, match: (p) => p.startsWith("/availability") },
  { href: "/requests", label: "Demandes", icon: Inbox, match: (p) => p.startsWith("/requests") },
  {
    href: "/profile",
    label: "Profil",
    icon: UserRound,
    match: (p) => p.startsWith("/profile") || p.startsWith("/dogs") || p.startsWith("/groups") || p.startsWith("/notifications"),
  },
];

export function BottomNavigation({ toAnswer }: { toAnswer: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/92 pb-safe backdrop-blur-md"
    >
      <ul className="mx-auto flex h-[var(--nav-height)] max-w-xl items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const badge = tab.href === "/requests" && toAnswer > 0 ? toAnswer : 0;
          return (
            <li key={tab.href} className="flex flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${tab.label}, ${badge} à répondre` : tab.label}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-3",
                )}
              >
                <span className={cn("relative flex h-8 w-14 items-center justify-center rounded-full transition-colors", active && "bg-surface-2")}>
                  <tab.icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                  {badge > 0 && (
                    <span className="absolute -top-1 right-1 min-w-5 rounded-full bg-[#b3261e] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
