"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Copy, Eraser, HeartHandshake, Minus, X } from "lucide-react";
import { applyAvailability } from "@/server/actions/availability";
import { SLOTS, SLOT_KEYS, type SlotKey } from "@/domain/config";
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "@/domain/availability";
import {
  PRESET_LABELS,
  cellKey,
  copyPreviousWeek,
  filledCount,
  presetCells,
  weekDays,
  type DayNeed,
  type Preset,
} from "@/domain/availability-screen";
import type { LocalDate } from "@/domain/time";
import { formatLocalDate, weekdayLabel } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/kit";
import { SlotCellFace, STATUS_TEXT } from "./slot-cell";

const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * "Prochains jours", one week at a time: quick selections, copying last week,
 * the filled gauge and the group's needs on my days. Selected cells get a
 * state from the floating bar. Never an engagement.
 */
export function WeekEditor({
  mondays,
  today,
  entries: initialEntries,
  rules,
  needs,
}: {
  mondays: LocalDate[];
  today: LocalDate;
  entries: AvailabilityEntry[];
  rules: AvailabilityRule[];
  needs: Record<LocalDate, DayNeed[]>;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [entries, setEntries] = useState(initialEntries);
  // fresh server data (after a refresh) replaces the local copy
  const [serverEntries, setServerEntries] = useState(initialEntries);
  if (initialEntries !== serverEntries) {
    setServerEntries(initialEntries);
    setEntries(initialEntries);
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const monday = mondays[index];
  const days = weekDays(monday);
  const gauge = filledCount(monday, today, entries, rules);
  const resolved = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveSlot>>();
    for (const d of days) for (const s of SLOT_KEYS) map.set(cellKey(d, s), resolveSlot(d, s, entries, rules));
    return map;
  }, [days, entries, rules]);

  const move = (delta: -1 | 1) => {
    const next = index + delta;
    if (next < 0 || next >= mondays.length) return;
    setDirection(delta);
    setSelected(new Set());
    setIndex(next);
  };

  const toggle = (keys: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const save = (cells: Array<{ date: LocalDate; slot: SlotKey }>, status: "available" | "unavailable" | "clear") => {
    const touched = new Set(cells.map((c) => cellKey(c.date, c.slot)));
    const before = entries.filter((e) => touched.has(cellKey(e.date, e.slot)));
    setEntries((current) => {
      const untouched = current.filter((e) => !touched.has(cellKey(e.date, e.slot)));
      return status === "clear" ? untouched : [...untouched, ...cells.map((c) => ({ ...c, status }))];
    });
    return applyAvailability({ cells, status }).then((r) => {
      if (!r.ok) setEntries((current) => [...current.filter((e) => !touched.has(cellKey(e.date, e.slot))), ...before]);
      return r;
    });
  };

  const apply = (status: "available" | "unavailable" | "clear") => {
    const cells = [...selected].map((k) => {
      const [date, slot] = k.split("|") as [LocalDate, SlotKey];
      return { date, slot };
    });
    setSelected(new Set());
    startTransition(async () => {
      const r = await save(cells, status);
      if (!r.ok) return void toast.error(r.error);
      hapticSuccess();
      toast.success(
        status === "clear"
          ? "Disponibilités effacées"
          : `${cells.length} créneau${cells.length > 1 ? "x" : ""} marqué${cells.length > 1 ? "s" : ""} ${status === "available" ? "disponible" : "indisponible"}${cells.length > 1 ? "s" : ""}`,
      );
      router.refresh();
    });
  };

  const copyLastWeek = () => {
    const copied = copyPreviousWeek(entries, monday, today);
    if (!copied.length) return void toast.info("Rien à recopier : la semaine précédente n'a pas de saisie jour par jour.");
    startTransition(async () => {
      for (const status of ["available", "unavailable"] as const) {
        const cells = copied.filter((c) => c.status === status).map(({ date, slot }) => ({ date, slot }));
        if (!cells.length) continue;
        const r = await save(cells, status);
        if (!r.ok) return void toast.error(r.error);
      }
      hapticSuccess();
      toast.success(`Semaine recopiée : ${copied.length} créneau${copied.length > 1 ? "x" : ""}`);
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="week-title" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={index === 0}
          className="glass flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          aria-label="Semaine précédente"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <h2 id="week-title" className="text-[19px] font-semibold tracking-tight text-ink" aria-live="polite">
            {index === 0 ? "Cette semaine" : `Semaine du ${formatLocalDate(monday, { day: "numeric", month: "long" })}`}
          </h2>
          <p className="text-[13px] text-ink-3">
            {gauge.filled} créneau{gauge.filled > 1 ? "x" : ""} renseigné{gauge.filled > 1 ? "s" : ""} sur {gauge.total}
          </p>
        </div>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={index === mondays.length - 1}
          className="glass flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          aria-label="Semaine suivante"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/10" aria-hidden>
        <div
          className="h-full rounded-full bg-[var(--tone-covered-ink)] transition-[width] duration-500"
          style={{ width: `${gauge.total ? (gauge.filled / gauge.total) * 100 : 0}%` }}
        />
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Raccourcis">
        {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSelected(new Set(presetCells(p, monday, today)))}
            className="min-h-11 shrink-0 rounded-full bg-surface px-4 text-[14px] font-medium text-ink"
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        {index > 0 && (
          <button
            type="button"
            onClick={copyLastWeek}
            disabled={pending}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-medium text-ink"
          >
            <Copy className="size-4" aria-hidden /> Comme la semaine dernière
          </button>
        )}
      </div>

      <div className="overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={monday}
            initial={{ opacity: 0, x: direction * 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -48 }}
            transition={{ duration: 0.35, ease: EASE }}
            drag="x"
            dragSnapToOrigin
            dragElastic={0.15}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80) move(1);
              else if (info.offset.x > 80) move(-1);
            }}
            style={{ touchAction: "pan-y" }}
            className="shadow-soft rounded-[28px] bg-surface p-3 ring-1 ring-white/70"
          >
            <div className="grid grid-cols-[76px_repeat(4,1fr)] gap-1.5 pb-2">
              <span />
              {SLOT_KEYS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggle(days.filter((d) => d >= today).map((d) => cellKey(d, slot)))}
                  className="flex min-h-11 flex-col items-center justify-center rounded-xl text-center hover:bg-surface-2"
                  aria-label={`Sélectionner tous les créneaux ${SLOTS[slot].label} de la semaine`}
                >
                  <span className="text-[12px] font-semibold text-ink">{SLOTS[slot].label}</span>
                  <span className="text-[10px] text-ink-3 tabular">
                    {SLOTS[slot].start.replace(":00", "h")}–{SLOTS[slot].end.replace(":00", "h")}
                  </span>
                </button>
              ))}
            </div>
            <ol className="flex flex-col gap-1.5">
              {days.map((date) => {
                const past = date < today;
                const dayNeeds = needs[date] ?? [];
                return (
                  <li key={date} className={cn("flex flex-col gap-1", past && "opacity-40")}>
                    <div className="grid grid-cols-[76px_repeat(4,1fr)] gap-1.5">
                      <button
                        type="button"
                        disabled={past}
                        onClick={() => toggle(SLOT_KEYS.map((s) => cellKey(date, s)))}
                        className={cn(
                          "flex min-h-11 flex-col justify-center rounded-xl px-2 text-left hover:bg-surface-2",
                          date === today && "bg-ink/[0.06]",
                        )}
                        aria-label={`Sélectionner toute la journée du ${formatLocalDate(date, { weekday: "long", day: "numeric", month: "long" })}`}
                      >
                        <span className="text-[13px] font-semibold text-ink">{weekdayLabel(date, "short").replace(".", "")}</span>
                        <span className="text-[12px] text-ink-3 tabular">{formatLocalDate(date, { day: "numeric", month: "short" })}</span>
                      </button>
                      {SLOT_KEYS.map((slot) => {
                        const k = cellKey(date, slot);
                        const r = resolved.get(k)!;
                        const isSelected = selected.has(k);
                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={past}
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
                    </div>
                    {!past &&
                      dayNeeds.map((n) => (
                        <Link
                          key={n.requestId}
                          href={n.href}
                          className="ml-[82px] flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--tone-pending)] px-3 text-[13px] font-medium text-[var(--tone-pending-ink)]"
                        >
                          <HeartHandshake className="size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{n.dogName} a besoin d&apos;aide</span>
                          <span className="font-semibold underline underline-offset-2">Répondre</span>
                        </Link>
                      ))}
                  </li>
                );
              })}
            </ol>
          </motion.div>
        </AnimatePresence>
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
        <li>Cases plus pâles avec ↻ = habitude</li>
      </ul>
      <p className="px-1 text-[13px] text-ink-3">
        Astuce : touchez un jour ou l&apos;en-tête d&apos;un créneau pour sélectionner toute la ligne ou la colonne.
      </p>

      {/* room to scroll the last days above the floating bar */}
      {selected.size > 0 && <div className="h-36" aria-hidden />}

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
              className="flex size-11 items-center justify-center rounded-full hover:bg-white/10"
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
