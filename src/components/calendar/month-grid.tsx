import { weekBars, type CalItem } from "@/domain/calendar";
import { TONE_LABELS, dayTone } from "@/domain/status";
import { addDays, dateRange, toLocalDate, type LocalDate } from "@/domain/time";
import { formatLocalDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, TONE_ICONS } from "@/components/domain/tone";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const LANES = 3;

/** Month: each request is a bar over its days (split per week); a tap on a day opens it. */
export function MonthGrid({
  items,
  from,
  to,
  anchor,
  today,
  onSelectDay,
}: {
  items: CalItem[];
  from: LocalDate;
  to: LocalDate;
  anchor: LocalDate;
  today: LocalDate;
  onSelectDay: (date: LocalDate) => void;
}) {
  const month = anchor.slice(0, 7);
  const days = dateRange(from, to);
  const mondays = days.filter((_, i) => i % 7 === 0);
  const touching = (date: LocalDate) => items.filter((i) => toLocalDate(i.start) <= date && date <= toLocalDate(i.end - 1));

  return (
    <div className="shadow-soft rounded-[28px] bg-surface p-2 ring-1 ring-white/70">
      <div className="grid grid-cols-7 pb-1 text-center text-[12px] font-semibold text-ink-3" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div role="grid" aria-label="Mois" className="flex flex-col divide-y divide-line">
        {mondays.map((monday) => {
          const week = dateRange(monday, addDays(monday, 6));
          const { bars, hidden } = weekBars(items, monday, LANES);
          const lanes = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
          return (
            <div role="row" key={monday} className="relative min-h-12 pb-1">
              {/* day numbers */}
              <div className="grid grid-cols-7">
                {week.map((d) => (
                  <span
                    key={d}
                    aria-hidden
                    className={cn(
                      "mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-[14px] font-medium tabular",
                      !d.startsWith(month) && "text-ink-3/50",
                      d === today && "bg-ink text-surface",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
                ))}
              </div>
              {/* request bars, on lanes */}
              {lanes > 0 && (
              <div className="mt-1 grid grid-cols-7 gap-y-1" style={{ gridTemplateRows: `repeat(${lanes}, 18px)` }} aria-hidden>
                {bars.map((b) => {
                  const Icon = TONE_ICONS[b.item.tone];
                  return (
                    <span
                      key={`${b.item.id}-${monday}`}
                      className={cn(
                        "flex min-w-0 items-center gap-0.5 px-1 text-[11px] font-semibold",
                        TONE_CLASSES[b.item.tone],
                        b.continuesBefore ? "rounded-l-none" : "ml-0.5 rounded-l-md",
                        b.continuesAfter ? "rounded-r-none" : "mr-0.5 rounded-r-md",
                      )}
                      style={{ gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`, gridRow: b.lane + 1 }}
                    >
                      <Icon className="size-3 shrink-0" />
                      <span className="truncate">{b.item.dogName}</span>
                    </span>
                  );
                })}
              </div>
              )}
              {hidden.some((n) => n > 0) && (
                <div className="grid grid-cols-7 text-center text-[11px] font-medium text-ink-3" aria-hidden>
                  {hidden.map((n, i) => (
                    <span key={i}>{n > 0 ? `+${n}` : ""}</span>
                  ))}
                </div>
              )}
              {/* one tap target per day over the whole week row */}
              <div className="absolute inset-0 grid grid-cols-7">
                {week.map((d) => {
                  const list = touching(d);
                  const tone = list.length ? dayTone(list.map((i) => i.tone)) : null;
                  return (
                    <button
                      role="gridcell"
                      key={d}
                      type="button"
                      onClick={() => onSelectDay(d)}
                      className="min-h-11 rounded-xl focus-visible:ring-2 focus-visible:ring-ink"
                      aria-label={`${formatLocalDate(d, { weekday: "long", day: "numeric", month: "long" })}${
                        list.length ? `, ${list.length} besoin${list.length > 1 ? "s" : ""}${tone ? `, ${TONE_LABELS[tone]}` : ""}` : ", aucun besoin"
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
