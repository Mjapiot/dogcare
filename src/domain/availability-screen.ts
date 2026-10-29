/**
 * "Mes dispos" screen: weeks to fill, quick selections, copying last week,
 * how much is filled, the group's needs on my days and a plain summary of my
 * habits. Pure; Paris days. A one-off entry always wins over a habit.
 */
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "./availability";
import { SLOTS, SLOT_KEYS, type SlotKey } from "./config";
import type { Interval } from "./intervals";
import { addDays, dateRange, isoWeekday, localDatesTouched, startOfWeek, type LocalDate } from "./time";

export const cellKey = (date: LocalDate, slot: SlotKey) => `${date}|${slot}`;

/** Mondays of the weeks shown: the current week and the next ones. */
export function weekStarts(today: LocalDate, count = 4): LocalDate[] {
  const first = startOfWeek(today);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

export function weekDays(monday: LocalDate): LocalDate[] {
  return dateRange(monday, addDays(monday, 6));
}

export type Preset = "week" | "evenings" | "weekend";

export const PRESET_LABELS: Record<Preset, string> = {
  week: "Toute la semaine",
  evenings: "Les soirs",
  weekend: "Le week-end",
};

/** Cells a quick selection picks in a week (never days already past). */
export function presetCells(preset: Preset, monday: LocalDate, today: LocalDate): string[] {
  const days = weekDays(monday).filter((d) => d >= today);
  const pick = (d: LocalDate): readonly SlotKey[] => {
    if (preset === "evenings") return ["evening", "night"];
    if (preset === "weekend") return isoWeekday(d) >= 6 ? SLOT_KEYS : [];
    return SLOT_KEYS;
  };
  return days.flatMap((d) => pick(d).map((s) => cellKey(d, s)));
}

/**
 * "Comme la semaine dernière": what I entered day by day the week before,
 * moved 7 days later (habits already apply by themselves). Past days skipped.
 */
export function copyPreviousWeek(entries: readonly AvailabilityEntry[], monday: LocalDate, today: LocalDate): AvailabilityEntry[] {
  const previous = new Set(weekDays(addDays(monday, -7)));
  return entries
    .filter((e) => previous.has(e.date))
    .map((e) => ({ ...e, date: addDays(e.date, 7) }))
    .filter((e) => e.date >= today);
}

/** Slots with a declared state (entry or habit) among the days still ahead in the week. */
export function filledCount(
  monday: LocalDate,
  today: LocalDate,
  entries: readonly AvailabilityEntry[],
  rules: readonly AvailabilityRule[],
): { filled: number; total: number } {
  const days = weekDays(monday).filter((d) => d >= today);
  let filled = 0;
  for (const d of days) for (const s of SLOT_KEYS) if (resolveSlot(d, s, entries, rules).status !== "unknown") filled++;
  return { filled, total: days.length * SLOT_KEYS.length };
}

export type DayNeed = { requestId: string; href: string; dogName: string };

/** Needs waiting for my answer, on each day they touch. */
export function needsByDay(needs: ReadonlyArray<DayNeed & { period: Interval }>): Record<LocalDate, DayNeed[]> {
  const out: Record<LocalDate, DayNeed[]> = {};
  for (const n of needs) {
    for (const d of localDatesTouched(n.period)) {
      (out[d] ??= []).push({ requestId: n.requestId, href: n.href, dogName: n.dogName });
    }
  }
  return out;
}

const WEEKDAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function joinFr(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;
}

/** "Disponible le mercredi après-midi et le samedi matin et soir." */
export function habitsSummary(rules: readonly AvailabilityRule[]): string {
  const days = [1, 2, 3, 4, 5, 6, 7]
    .map((w) => {
      const slots = SLOT_KEYS.filter((s) => rules.some((r) => r.weekday === w && r.slot === s && r.status === "available"));
      if (!slots.length) return null;
      const what = slots.length === SLOT_KEYS.length ? "toute la journée" : joinFr(slots.map((s) => SLOTS[s].label.toLowerCase()));
      return `le ${WEEKDAY_NAMES[w - 1]} ${what}`;
    })
    .filter((x): x is string => x !== null);
  return days.length ? `Disponible ${joinFr(days)}.` : "Aucune habitude de disponibilité pour l'instant.";
}
