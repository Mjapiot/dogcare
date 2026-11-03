"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { CalendarDays, House, PawPrint, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const TABS: Tab[] = [
  {
    href: "/",
    label: "Accueil",
    icon: House,
    match: (p) => p === "/" || p.startsWith("/requests") || p.startsWith("/notifications") || p.startsWith("/plan"),
  },
  { href: "/calendar", label: "Agenda", icon: CalendarDays, match: (p) => p.startsWith("/calendar") || p.startsWith("/availability") },
  { href: "/dogs", label: "Chiens", icon: PawPrint, match: (p) => p.startsWith("/dogs") },
  { href: "/profile", label: "Profil", icon: UserRound, match: (p) => p.startsWith("/profile") || p.startsWith("/groups") },
];

/** Floating round buttons; the black disc slides to the current one. */
export function BottomNavigation({ toDo }: { toDo: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      style={{ bottom: "calc(var(--safe-bottom) + var(--nav-gap))" }}
    >
      <ul className="glass pointer-events-auto flex items-center gap-2 rounded-full p-2 shadow-[0_10px_30px_rgba(28,27,25,0.14)]">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const badge = tab.href === "/" && toDo > 0 ? toDo : 0;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${tab.label}, ${badge} à répondre` : tab.label}
                className="relative flex size-14 items-center justify-center rounded-full active:scale-95"
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                  />
                )}
                <tab.icon className={cn("relative size-[22px] transition-colors", active ? "text-surface" : "text-ink")} strokeWidth={1.9} aria-hidden />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 min-w-5 rounded-full bg-[#b3261e] px-1.5 text-center text-[11px] font-semibold leading-5 text-white ring-2 ring-surface"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
