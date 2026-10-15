"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Eraser, Minus, X } from "lucide-react";
import { applyAvailability } from "@/server/actions/availability";
import { SLOTS, SLOT_KEYS, type SlotKey } from "@/domain/config";
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "@/domain/availability";
import { isoWeekday, type LocalDate } from "@/domain/time";
import { formatLocalDate, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PillButton, Segmented } from "@/components/ui/kit";
import { SlotCellFace, STATUS_TEXT } from "./slot-cell";

const key = (date: string, slot: SlotKey) => `${date}|${slot}`;

export function AvailabilityEditor({
  dates,
  weeks,
  entries: initialEntries,
  rules,
}: {
  dates: LocalDate[];
  weeks: 2 | 4;
  entries: AvailabilityEntry[];
  rules: AvailabilityRule[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const resolved = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveSlot>>();
    for (const date of dates) for (const slot of SLOT_KEYS) map.set(key(date, slot), resolveSlot(date, slot, entries, rules));
    return map;
  }, [dates, entries, rules]);

  const toggle = (keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const apply = (status: "available" | "unavailable" | "clear") => {
    const cells = [...selected].map((k) => {
      const [date, slot] = k.split("|") as [string, SlotKey];
      return { date, slot };
    });
    const previous = entries;
    // optimistic update
    const untouched = entries.filter((e) => !selected.has(key(e.date, e.slot)));
    setEntries(status === "clear" ? untouched : [...untouched, ...cells.map((c) => ({ ...c, status }))]);
    setSelected(new Set());
    startTransition(async () => {
      const result = await applyAvailability({ cells, status });
      if (!result.ok) {
        setEntries(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        status === "clear"
          ? "Disponibilités effacées"
          : `${cells.length} créneau${cells.length > 1 ? "x" : ""} marqué${cells.length > 1 ? "s" : ""} ${status === "available" ? "disponible" : "indisponible"}${cells.length > 1 ? "s" : ""}`,
      );
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="availability-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="availability-title" className="text-[17px] font-semibold text-ink">
          Prochains jours
        </h2>
        <Segmented
          label="Horizon"
          value={String(weeks) as "2" | "4"}
          onChange={(v) => router.replace(v === "4" ? "/availability?weeks=4" : "/availability", { scroll: false })}
          options={[
            { value: "2", label: "2 sem." },
            { value: "4", label: "4 sem." },
          ]}
          className="w-44"
        />
      </div>
      <p className="text-[14px] text-ink-3">
        Touchez des cases, une ligne (le jour) ou une colonne (le créneau) pour les sélectionner, puis choisissez un état.
      </p>

      <div className="rounded-[28px] bg-surface p-3">
        <div className="sticky top-16 z-10 grid grid-cols-[76px_repeat(4,1fr)] gap-1.5 bg-surface pb-2">
          <span />
          {SLOT_KEYS.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => toggle(dates.map((d) => key(d, slot)))}
              className="flex min-h-11 flex-col items-center justify-center rounded-xl text-center hover:bg-surface-2"
              aria-label={`Sélectionner tous les créneaux ${SLOTS[slot].label}`}
            >
              <span className="text-[12px] font-semibold text-ink">{SLOTS[slot].label}</span>
              <span className="text-[10px] text-ink-3 tabular">
                {SLOTS[slot].start.replace(":00", "h")}–{SLOTS[slot].end.replace(":00", "h")}
              </span>
            </button>
          ))}
        </div>
        <ol className="flex flex-col gap-1.5">
          {dates.map((date) => {
            const weekend = isoWeekday(date) >= 6;
            const newWeek = isoWeekday(date) === 1 && date !== dates[0];
            return (
              <li key={date} className={cn("grid grid-cols-[76px_repeat(4,1fr)] gap-1.5", newWeek && "mt-3")}>
                <button
                  type="button"
                  onClick={() => toggle(SLOT_KEYS.map((s) => key(date, s)))}
                  className="flex min-h-11 flex-col justify-center rounded-xl px-2 text-left hover:bg-surface-2"
                  aria-label={`Sélectionner toute la journée du ${formatLocalDate(date, { weekday: "long", day: "numeric", month: "long" })}`}
                >
                  <span className={cn("text-[13px] font-semibold", weekend ? "text-sage" : "text-ink")}>
                    {weekdayLabel(date, "short").replace(".", "")}
                  </span>
                  <span className="text-[12px] text-ink-3 tabular">{formatLocalDate(date, { day: "numeric", month: "short" })}</span>
                </button>
                {SLOT_KEYS.map((slot) => {
                  const k = key(date, slot);
                  const r = resolved.get(k)!;
                  const isSelected = selected.has(k);
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggle([k])}
                      aria-label={`${formatLocalDate(date, { weekday: "long", day: "numeric", month: "long" })}, ${SLOTS[slot].label} : ${STATUS_TEXT[r.status]}${
                        r.source === "rule" ? " (habitude)" : ""
                      }`}
                    >
                      <SlotCellFace status={r.status} fromRule={r.source === "rule"} selected={isSelected} />
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] text-ink-3">
        <li className="flex items-center gap-1.5">
          <Check className="size-3.5 text-[var(--tone-covered-ink)]" aria-hidden /> Disponible
        </li>
        <li className="flex items-center gap-1.5">
          <Minus className="size-3.5" aria-hidden /> Indisponible
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3.5 rounded border border-dashed border-ink/30" aria-hidden /> Non renseigné
        </li>
        <li>Cases plus pâles = habitude hebdomadaire</li>
      </ul>

      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Appliquer à la sélection"
          className="fixed inset-x-3 bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom,0px)+10px)] z-40 mx-auto flex max-w-lg flex-col gap-2 rounded-[24px] bg-ink p-3 text-surface shadow-xl"
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[14px] font-medium">
              {selected.size} créneau{selected.size > 1 ? "x" : ""} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Annuler la sélection"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <PillButton variant="primary" className="bg-[var(--tone-covered)] text-[var(--tone-covered-ink)] hover:bg-[var(--tone-covered)]/90" onClick={() => apply("available")} disabled={pending}>
              <Check className="size-4" aria-hidden /> Dispo
            </PillButton>
            <PillButton variant="primary" className="bg-[#d9d5cd] text-[#2f2c28] hover:bg-[#d9d5cd]/90" onClick={() => apply("unavailable")} disabled={pending}>
              <Minus className="size-4" aria-hidden /> Indispo
            </PillButton>
            <PillButton variant="primary" className="bg-white/10 text-surface hover:bg-white/15" onClick={() => apply("clear")} disabled={pending}>
              <Eraser className="size-4" aria-hidden /> Effacer
            </PillButton>
          </div>
        </div>
      )}
    </section>
  );
}
