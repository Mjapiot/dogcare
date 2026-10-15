"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Eraser, Minus } from "lucide-react";
import { applyRules } from "@/server/actions/availability";
import { SLOTS, SLOT_KEYS, type SlotKey } from "@/domain/config";
import type { AvailabilityRule } from "@/domain/availability";
import { PillButton } from "@/components/ui/kit";
import { SlotCellFace } from "./slot-cell";

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const key = (weekday: number, slot: SlotKey) => `${weekday}|${slot}`;

/** Weekly habits (simple recurrence). One-off declarations always win. */
export function RulesEditor({ rules }: { rules: AvailabilityRule[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const statusOf = (weekday: number, slot: SlotKey) => rules.find((r) => r.weekday === weekday && r.slot === slot)?.status ?? "unknown";

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const apply = (status: "available" | "unavailable" | "clear") => {
    const cells = [...selected].map((k) => k.split("|"));
    const byWeekdays = new Map<string, number[]>();
    for (const [weekday, slot] of cells) byWeekdays.set(slot, [...(byWeekdays.get(slot) ?? []), Number(weekday)]);
    startTransition(async () => {
      for (const [slot, weekdays] of byWeekdays) {
        const result = await applyRules({ weekdays, slots: [slot as SlotKey], status });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      }
      setSelected(new Set());
      toast.success("Habitudes enregistrées");
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-3">
      <div>
        <h2 id="rules-title" className="text-[17px] font-semibold text-ink">
          Mes habitudes
        </h2>
        <p className="mt-1 text-[14px] text-ink-3">
          Par exemple « disponible tous les mercredis après-midi ». Ce que vous saisissez jour par jour reste prioritaire.
        </p>
      </div>
      <details className="rounded-[28px] bg-surface p-3" open={rules.length > 0}>
        <summary className="min-h-10 cursor-pointer px-2 py-2 text-[15px] font-medium text-ink">
          {rules.length > 0 ? `${rules.length} habitude${rules.length > 1 ? "s" : ""} définie${rules.length > 1 ? "s" : ""}` : "Définir des habitudes"}
        </summary>
        <div className="mt-2 grid grid-cols-[76px_repeat(4,1fr)] gap-1.5 pb-2">
          <span />
          {SLOT_KEYS.map((slot) => (
            <span key={slot} className="text-center text-[12px] font-semibold text-ink">
              {SLOTS[slot].label}
            </span>
          ))}
        </div>
        <ol className="flex flex-col gap-1.5">
          {WEEKDAYS.map((label, i) => {
            const weekday = i + 1;
            return (
              <li key={label} className="grid grid-cols-[76px_repeat(4,1fr)] items-center gap-1.5">
                <span className="px-2 text-[13px] font-semibold text-ink">{label.slice(0, 3)}.</span>
                {SLOT_KEYS.map((slot) => {
                  const k = key(weekday, slot);
                  const status = statusOf(weekday, slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={selected.has(k)}
                      onClick={() => toggle(k)}
                      aria-label={`Tous les ${label.toLowerCase()}s, ${SLOTS[slot].label} : ${
                        status === "unknown" ? "aucune habitude" : status === "available" ? "disponible" : "indisponible"
                      }`}
                    >
                      <SlotCellFace status={status} fromRule={false} selected={selected.has(k)} />
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ol>
        {selected.size > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <PillButton size="sm" onClick={() => apply("available")} loading={pending} className="bg-[var(--tone-covered)] text-[var(--tone-covered-ink)] hover:bg-[var(--tone-covered)]/90">
              <Check className="size-4" aria-hidden /> Dispo
            </PillButton>
            <PillButton size="sm" variant="soft" onClick={() => apply("unavailable")} disabled={pending}>
              <Minus className="size-4" aria-hidden /> Indispo
            </PillButton>
            <PillButton size="sm" variant="outline" onClick={() => apply("clear")} disabled={pending}>
              <Eraser className="size-4" aria-hidden /> Retirer
            </PillButton>
          </div>
        )}
      </details>
    </section>
  );
}
