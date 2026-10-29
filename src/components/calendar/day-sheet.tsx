import Link from "next/link";
import { ChevronRight, Plus, Users } from "lucide-react";
import type { CalItem } from "@/domain/calendar";
import { SLOT_KEYS, SLOTS, type SlotKey } from "@/domain/config";
import { REQUEST_TYPE_LABELS } from "@/domain/status";
import { toLocalDate, type LocalDate } from "@/domain/time";
import { formatLocalDate, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PillLink } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { REQUEST_TYPE_ICONS } from "@/components/domain/request-bits";
import { STATUS_ICONS, TONE_CLASSES } from "@/components/domain/tone";

/** A day: its needs, who declared themselves available (slot by slot), and adding a need. */
export function DaySheet({
  date,
  items,
  available,
  onClose,
}: {
  date: LocalDate | null;
  items: CalItem[];
  available: Record<SlotKey, string[]> | undefined;
  onClose: () => void;
}) {
  const dayItems = date ? items.filter((i) => toLocalDate(i.start) <= date && date <= toLocalDate(i.end - 1)) : [];
  const slots = available ? SLOT_KEYS.filter((k) => available[k].length > 0) : [];
  return (
    <Sheet open={date !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[28px] border-0 pb-safe">
        {date && (
          <>
            <SheetHeader>
              <SheetTitle className="text-2xl font-semibold tracking-tight first-letter:uppercase">
                {formatLocalDate(date, { weekday: "long", day: "numeric", month: "long" })}
              </SheetTitle>
              <SheetDescription>
                {dayItems.length === 0 ? "Aucun besoin ce jour-là." : `${dayItems.length} besoin${dayItems.length > 1 ? "s" : ""}`}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              {dayItems.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {dayItems.map((item) => {
                    const TypeIcon = REQUEST_TYPE_ICONS[item.type];
                    const StatusIcon = STATUS_ICONS[item.status];
                    return (
                      <li key={item.id}>
                        <Link href={`/requests/${item.id}`} onClick={onClose} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", TONE_CLASSES[item.tone])}>
                            <TypeIcon className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold text-ink">
                              {item.dogName} · {REQUEST_TYPE_LABELS[item.type]}
                            </span>
                            <span className="block truncate text-[13px] text-ink-3">{formatPeriod(item.start, item.end)}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-ink-2">
                              <StatusIcon className="size-3.5" aria-hidden />
                              {item.label}
                              {item.helpers.length > 0 && ` · ${item.helpers.join(", ")}`}
                            </span>
                          </span>
                          <ChevronRight className="size-5 text-ink-3" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              <section className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4" aria-labelledby="day-available">
                <h3 id="day-available" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <Users className="size-4" aria-hidden /> Disponibles ce jour
                </h3>
                {slots.length === 0 ? (
                  <p className="text-[14px] text-ink-3">Personne n&apos;a indiqué de disponibilité ce jour.</p>
                ) : (
                  <dl className="flex flex-col gap-1.5 text-[14px]">
                    {slots.map((k) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-24 shrink-0 font-medium text-ink-2">{SLOTS[k].label}</dt>
                        <dd className="text-ink">{available![k].join(", ")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="text-[12px] text-ink-3">Une disponibilité est une indication, pas un engagement : seule une garde confirmée compte.</p>
              </section>

              <PillLink href={`/requests/new?date=${date}`} className="w-full" onClick={onClose}>
                <Plus className="size-4" aria-hidden /> Ajouter un besoin ce jour
              </PillLink>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
