"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
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
      className="pointer-events-none fixed inset-x-0 z-30 px-4"
      style={{ bottom: "calc(var(--safe-bottom) + var(--nav-gap))" }}
    >
      <ul className="glass pointer-events-auto mx-auto flex h-[var(--nav-height)] max-w-md items-stretch justify-around rounded-full px-1.5">
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
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-3",
                )}
              >
                <span className="relative flex h-8 w-14 items-center justify-center">
                  {/* the dark pill slides from one tab to the next */}
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-full bg-ink"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <tab.icon
                    className={cn("relative size-[20px] transition-colors", active && "text-surface")}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden
                  />
                  {badge > 0 && (
                    <span className="absolute -top-1 right-0.5 min-w-5 rounded-full bg-[#b3261e] px-1.5 text-center text-[11px] font-semibold leading-5 text-white ring-2 ring-surface">
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
