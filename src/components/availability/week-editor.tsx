"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Copy, HeartHandshake, Minus, Repeat } from "lucide-react";
import { applyAvailability } from "@/server/actions/availability";
import { SLOTS, SLOT_KEYS, type SlotKey } from "@/domain/config";
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "@/domain/availability";
import {
  PRESET_LABELS,
  availableCount,
  cellKey,
  copyPreviousWeek,
  nextTap,
  presetCells,
  weekDays,
  type DayNeed,
  type Preset,
} from "@/domain/availability-screen";
import type { LocalDate } from "@/domain/time";
import { formatLocalDate, weekdayLabel } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { BigNumber, SegmentGauge } from "@/components/ui/editorial";

const STATE_LABEL = { available: "Dispo", unavailable: "Pas dispo", unknown: "Non renseigné" } as const;

/**
 * "Mes dispos", one week at a time: how many slots I offer, the days of the
 * week, then the four slots of the chosen day as big tiles (a tap goes
 * not filled → dispo → pas dispo → back), quick fills, and the group's needs
 * this week. Never an engagement.
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
  const [entries, setEntries] = useState(initialEntries);
  // fresh server data (after a refresh) replaces the local copy
  const [serverEntries, setServerEntries] = useState(initialEntries);
  if (initialEntries !== serverEntries) {
    setServerEntries(initialEntries);
    setEntries(initialEntries);
  }
  const [day, setDay] = useState<LocalDate>(today);
  const [pending, startTransition] = useTransition();

  const monday = mondays[index];
  const days = weekDays(monday);
  const shownDay = days.includes(day) && day >= today ? day : (days.find((d) => d >= today) ?? days[0]);
  const count = availableCount(monday, today, entries, rules);
  // each need once, on its first day still ahead this week
  const seen = new Map<string, DayNeed & { date: LocalDate }>();
  for (const d of days) for (const n of needs[d] ?? []) if (d >= today && !seen.has(n.requestId)) seen.set(n.requestId, { ...n, date: d });
  const weekNeeds = [...seen.values()];

  const move = (delta: -1 | 1) => {
    const next = index + delta;
    if (next < 0 || next >= mondays.length) return;
    setIndex(next);
  };

  /** Saves cells with a state (optimistic; put back if the server refuses). */
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

  const tap = (slot: SlotKey) => {
    const action = nextTap(resolveSlot(shownDay, slot, entries, rules));
    startTransition(async () => {
      const r = await save([{ date: shownDay, slot }], action);
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  };

  const fill = (preset: Preset) => {
    const cells = presetCells(preset, monday, today).map((k) => {
      const [date, slot] = k.split("|") as [LocalDate, SlotKey];
      return { date, slot };
    });
    if (!cells.length) return void toast.info("Plus aucun jour à remplir cette semaine.");
    startTransition(async () => {
      const r = await save(cells, "available");
      if (!r.ok) return void toast.error(r.error);
      hapticSuccess();
      toast.success(`${cells.length} créneau${cells.length > 1 ? "x" : ""} marqué${cells.length > 1 ? "s" : ""} disponible${cells.length > 1 ? "s" : ""}`);
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

  const dayName = (d: LocalDate) => formatLocalDate(d, { weekday: "long", day: "numeric", month: "long" });

  return (
    <section aria-labelledby="week-title" className="flex flex-col gap-4">
      <div className="rounded-[30px] bg-[var(--tone-info)] p-5 text-[var(--tone-info-ink)]">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={index === 0}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/50 disabled:opacity-40"
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h2 id="week-title" className="text-center text-[15px] font-semibold" aria-live="polite">
            {index === 0 ? "Cette semaine, je suis dispo" : `Semaine du ${formatLocalDate(monday, { day: "numeric", month: "long" })}`}
          </h2>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={index === mondays.length - 1}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/50 disabled:opacity-40"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <BigNumber className="mt-2" value={count.available} unit={`/${count.total} créneaux`} />
        <SegmentGauge
          className="mt-3"
          total={14}
          done={count.total ? Math.round((count.available / count.total) * 14) : 0}
          label={`${count.available} créneau${count.available > 1 ? "x" : ""} disponible${count.available > 1 ? "s" : ""} sur ${count.total}`}
        />
      </div>

      <div className="rounded-[26px] bg-surface px-2.5 py-3">
        <ul className="grid grid-cols-7 gap-0.5">
          {days.map((d) => {
            const past = d < today;
            const on = d === shownDay;
            const offered = SLOT_KEYS.some((s) => resolveSlot(d, s, entries, rules).status === "available");
            return (
              <li key={d}>
                <button
                  type="button"
                  disabled={past}
                  onClick={() => setDay(d)}
                  aria-pressed={on}
                  aria-label={`${dayName(d)}${offered ? ", dispo sur au moins un créneau" : ""}`}
                  className="flex min-h-16 w-full flex-col items-center gap-1 py-1 disabled:opacity-35"
                >
                  <span className="text-[11px] tracking-wide text-ink-3 uppercase" aria-hidden>
                    {weekdayLabel(d, "short").replace(".", "")}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl text-[15px] font-medium tabular transition-colors",
                      on ? "bg-ink text-surface" : d === today ? "ring-[1.5px] ring-ink ring-inset" : "text-ink",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
                  <span aria-hidden className={cn("size-1.5 rounded-full", offered ? "bg-[var(--tone-covered-ink)]" : "bg-transparent")} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <h3 className="px-1 text-[15px] font-semibold text-ink first-letter:uppercase">{dayName(shownDay)}</h3>
      <div className="grid grid-cols-2 gap-2">
        {SLOT_KEYS.map((slot) => {
          const r = resolveSlot(shownDay, slot, entries, rules);
          const fromHabit = r.source === "rule";
          return (
            <button
              key={slot}
              type="button"
              onClick={() => tap(slot)}
              aria-label={`${SLOTS[slot].label}, ${dayName(shownDay)} : ${STATE_LABEL[r.status].toLowerCase()}${fromHabit ? " (habitude)" : ""}. Toucher pour changer.`}
              className={cn(
                "flex min-h-20 flex-col items-start justify-center gap-0.5 rounded-[22px] px-4 text-left transition-colors active:scale-[0.97]",
                r.status === "available" && "bg-[#2b2450] text-surface",
                r.status === "unavailable" && "bg-[#d9d5cd] text-[#2f2c28]",
                r.status === "unknown" && "border-[1.5px] border-dashed border-ink/25 bg-surface text-ink",
              )}
            >
              <span className="flex w-full items-center justify-between text-[16px] font-semibold">
                {SLOTS[slot].label}
                {r.status === "available" && <Check className="size-4" aria-hidden />}
                {r.status === "unavailable" && <Minus className="size-4" aria-hidden />}
              </span>
              <span className="text-[13px] opacity-80">
                {Number(SLOTS[slot].start.slice(0, 2))}&nbsp;h–{Number(SLOTS[slot].end.slice(0, 2))}&nbsp;h · {STATE_LABEL[r.status]}
              </span>
              {fromHabit && (
                <span className="inline-flex items-center gap-1 text-[12px] opacity-80">
                  <Repeat className="size-3" aria-hidden /> habitude
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Remplir d'un geste">
        {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => fill(p)}
            className="min-h-11 shrink-0 rounded-full border-[1.5px] border-ink px-4 text-[14px] font-medium text-ink"
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        {index > 0 && (
          <button
            type="button"
            onClick={copyLastWeek}
            disabled={pending}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-ink px-4 text-[14px] font-medium text-ink"
          >
            <Copy className="size-4" aria-hidden /> Comme la semaine dernière
          </button>
        )}
      </div>

      {weekNeeds.length > 0 && (
        <section aria-label="Besoins de la semaine" className="flex flex-col gap-2">
          <h3 className="px-1 text-[15px] font-semibold text-ink">Besoins du groupe cette semaine</h3>
          {weekNeeds.map((n) => (
            <Link
              key={n.requestId}
              href={n.href}
              className="flex min-h-12 items-center gap-2 rounded-2xl bg-[var(--tone-pending)] px-4 text-[14px] font-medium text-[var(--tone-pending-ink)]"
            >
              <HeartHandshake className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {n.dogName} a besoin d&apos;aide · {formatLocalDate(n.date, { weekday: "short", day: "numeric" })}
              </span>
              <span className="font-semibold underline underline-offset-2">Répondre</span>
            </Link>
          ))}
        </section>
      )}

      <p className="px-1 text-[13px] text-ink-3">Touchez un créneau pour le changer. Une disponibilité n&apos;est jamais un engagement.</p>
    </section>
  );
}
