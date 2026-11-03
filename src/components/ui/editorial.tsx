import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/domain/status";
import type { LocalDate } from "@/domain/time";
import { monthShort, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/components/domain/tone";

/**
 * Editorial building blocks of the redesign (big dates and numbers, black
 * pills, pastel cards, segmented gauges), after the user's references.
 */

/** "Mardi / 03.11 / NOV", with numbers on the side. */
export function BigDate({ date, aside }: { date: LocalDate; aside?: React.ReactNode }) {
  return (
    <section aria-label="Date du jour" className="flex items-end gap-4 px-1">
      <div>
        <p className="mb-1.5 text-[16px] text-ink-2">{weekdayLabel(date)}</p>
        <p className="text-[80px] font-light leading-[0.88] tracking-[-0.05em] text-ink tabular" aria-hidden>
          {date.slice(8, 10)}.{date.slice(5, 7)}
        </p>
        <p className="text-[80px] font-light leading-[0.9] tracking-[-0.05em] text-ink" aria-hidden>
          {monthShort(date)}
        </p>
      </div>
      {aside && <div className="mb-1.5 flex flex-col gap-3.5 border-l-[1.5px] border-ink pl-4">{aside}</div>}
    </section>
  );
}

/** A big number with its unit ("2/3 nuits"). */
export function BigNumber({ value, unit, className }: { value: React.ReactNode; unit?: string; className?: string }) {
  return (
    <p className={cn("flex items-baseline gap-1", className)}>
      <span className="text-[56px] font-light leading-none tracking-[-0.05em] tabular">{value}</span>
      {unit && <span className="text-[20px]">{unit}</span>}
    </p>
  );
}

/** Done segments filled, the others dashed (never color alone: filled vs outlined). */
export function SegmentGauge({ total, done, label, className }: { total: number; done: number; label: string; className?: string }) {
  const n = Math.max(1, Math.min(total, 14));
  const filled = Math.round((Math.min(done, total) / Math.max(total, 1)) * n);
  return (
    <div role="img" aria-label={label} className={cn("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("h-8 rounded-full", i < filled ? "bg-current opacity-80" : "border-[1.5px] border-dashed border-current opacity-60")} />
      ))}
    </div>
  );
}

/** A pastel card in a status tone, with its labelled chip (icon + text). */
export function ToneCard({
  tone,
  icon: Icon,
  tag,
  title,
  aside,
  children,
  className,
}: {
  tone: StatusTone;
  icon: LucideIcon;
  tag: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("flex flex-col gap-3 rounded-[30px] p-5", TONE_CLASSES[tone], tone === "partial" && "hatch", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/55 px-3 py-1.5 text-[13px] font-medium">
          <Icon className="size-3.5" aria-hidden /> {tag}
        </span>
        {aside}
      </div>
      <h3 className="text-[28px] font-medium leading-[1.05] tracking-[-0.03em]">{title}</h3>
      {children}
    </article>
  );
}

/** Black pills to switch views (links). */
export function PillTabs({ label, items }: { label: string; items: Array<{ href: string; label: string; active: boolean }> }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-medium transition-colors active:scale-[0.97]",
            i.active ? "bg-ink text-surface" : "bg-surface text-ink hover:bg-surface-2",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

const DOT: Record<StatusTone, string> = {
  covered: "bg-[#4f6f52]",
  pending: "bg-[#c97a1c]",
  uncovered: "bg-[#b3261e]",
  partial: "bg-[#b3261e]",
  info: "bg-[#6b5fb0]",
  muted: "bg-transparent",
  none: "bg-transparent",
};

/** "Cette semaine": seven days, today outlined, the chosen one in black, a dot when something is planned. */
export function WeekStrip({
  days,
  today,
  title = "Cette semaine",
  action,
}: {
  days: Array<{ date: LocalDate; tone: StatusTone; label: string; href: string }>;
  today: LocalDate;
  title?: string;
  action?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-[26px] bg-surface px-2.5 py-3.5">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <ul className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const isToday = d.date === today;
          return (
            <li key={d.date}>
              <Link href={d.href} aria-label={d.label} aria-current={isToday ? "date" : undefined} className="flex min-h-16 flex-col items-center gap-1 py-1">
                <span className="text-[11px] tracking-wide text-ink-3 uppercase" aria-hidden>
                  {weekdayLabel(d.date, "short").replace(".", "")}
                </span>
                <span
                  aria-hidden
                  className={cn("flex size-9 items-center justify-center rounded-xl text-[15px] font-medium tabular", isToday ? "bg-ink text-surface" : "text-ink")}
                >
                  {Number(d.date.slice(8, 10))}
                </span>
                <span aria-hidden className={cn("size-1.5 rounded-full", DOT[d.tone])} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
