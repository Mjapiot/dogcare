import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs of the "Demandes" screen as links (the tab is in the URL), with the
 * same sliding thumb as the segmented control.
 */
export function ScreenTabs<T extends string>({
  tabs,
  active,
}: {
  tabs: Array<{ key: T; label: string; href: string; count: number }>;
  active: T;
}) {
  const index = tabs.findIndex((t) => t.key === active);
  return (
    <nav aria-label="Catégories" className="relative grid rounded-full bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-ink shadow-sm motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ width: `calc((100% - 0.5rem) / ${tabs.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "relative z-10 flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-full px-1 text-[14px] font-medium tracking-tight transition-colors duration-300",
            t.key === active ? "text-surface" : "text-ink-2 hover:text-ink",
          )}
        >
          <span className="min-w-0 truncate">{t.label}</span>
          {t.count > 0 && (
            <span className={cn("shrink-0 rounded-full px-1 text-[12px] tabular", t.key === active ? "bg-white/20" : "bg-surface")}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
