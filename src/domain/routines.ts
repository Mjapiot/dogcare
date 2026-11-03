/**
 * Routines (meals, walks, medication…) during a garde: their occurrences, day
 * by day in Paris time, and what the care log says about each one. Pure; the
 * same rules are checked by add_care_log in the database.
 */
import type { Interval } from "./intervals";
import { isoWeekday, localDatesTouched, toLocalDate, toLocalTime, zonedInstant, type LocalDate } from "./time";

export type RoutineKind = "meal" | "walk" | "medication" | "other";

export const ROUTINE_KINDS: readonly RoutineKind[] = ["meal", "walk", "medication", "other"];

export const ROUTINE_KIND_LABELS: Record<RoutineKind, string> = {
  meal: "Repas",
  walk: "Promenade",
  medication: "Médicament",
  other: "Autre",
};

export type Routine = {
  id: string;
  kind: RoutineKind;
  label: string;
  /** "HH:MM", Paris time. */
  times: readonly string[];
  /** ISO weekdays (1 = Monday); null = every day. */
  weekdays: readonly number[] | null;
  instructions: string | null;
};

/** How far ahead an occurrence may be checked off (same as the database). */
export const ROUTINE_EARLY_MS = 3 * 3_600_000;

export type RoutineOccurrence = {
  routineId: string;
  kind: RoutineKind;
  label: string;
  instructions: string | null;
  /** The instant of this occurrence. */
  at: number;
  date: LocalDate;
  time: string;
};

/** Every occurrence of the routines inside a period (half-open), in time order. */
export function routineOccurrences(routines: readonly Routine[], period: Interval): RoutineOccurrence[] {
  const out: RoutineOccurrence[] = [];
  for (const date of localDatesTouched(period)) {
    const weekday = isoWeekday(date);
    for (const r of routines) {
      if (r.weekdays && !r.weekdays.includes(weekday)) continue;
      for (const time of r.times) {
        const at = zonedInstant(date, time);
        // 02:30 does not exist the night clocks go forward: no occurrence (the database agrees)
        if (toLocalTime(at) !== time) continue;
        if (at >= period.start && at < period.end) {
          out.push({ routineId: r.id, kind: r.kind, label: r.label, instructions: r.instructions, at, date, time });
        }
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label, "fr"));
}

export type RoutineCheck = { routine_id: string | null; routine_at: string | null; occurred_at: string; authorName: string; entryId: string };

export type RoutineItem = RoutineOccurrence & {
  /** done: checked off · due: can be checked now · upcoming: later · missed: past and not checked */
  state: "done" | "due" | "upcoming" | "missed";
  done: { at: number; by: string; entryId: string } | null;
};

/** The occurrences of a day with what the care log says (the helper checks "due" ones). */
export function routineChecklist(
  occurrences: readonly RoutineOccurrence[],
  checks: readonly RoutineCheck[],
  now: number,
  date: LocalDate = toLocalDate(now),
): RoutineItem[] {
  return occurrences
    .filter((o) => o.date === date)
    .map((o) => {
      const c = checks.find((x) => x.routine_id === o.routineId && x.routine_at !== null && Date.parse(x.routine_at) === o.at);
      if (c) return { ...o, state: "done" as const, done: { at: Date.parse(c.occurred_at), by: c.authorName, entryId: c.entryId } };
      const state = o.at > now + ROUTINE_EARLY_MS ? "upcoming" : o.at < now - 12 * 3_600_000 ? "missed" : "due";
      return { ...o, state, done: null };
    });
}

/** "Repas 8 h et 19 h", "Médicament 20 h (lun., mer.)". */
export function describeRoutine(r: Pick<Routine, "label" | "times" | "weekdays">): string {
  const days = r.weekdays && r.weekdays.length < 7 ? ` (${r.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")})` : "";
  return `${r.label} ${r.times.map(spokenTime).join(" et ")}${days}`;
}

export const WEEKDAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** "08:00" → "8 h", "20:30" → "20 h 30". */
export function spokenTime(time: string): string {
  const [h, m] = time.split(":");
  return `${Number(h)} h${m === "00" ? "" : ` ${m}`}`;
}
