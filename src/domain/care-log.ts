/**
 * Care log ("carnet de garde") rules shared by screens: when a garde's log
 * is open (same window as the database), day grouping and the latest news.
 */
import type { Interval } from "./intervals";
import { toLocalDate, type LocalDate } from "./time";
import type { CareLogEntryRow, CareLogKind } from "@/lib/types";

export const CARE_LOG_OPENS_BEFORE_MS = 2 * 3_600_000;
export const CARE_LOG_CLOSES_AFTER_MS = 24 * 3_600_000;

/** Order of the quick buttons. */
export const CARE_LOG_KINDS: readonly CareLogKind[] = ["meal", "walk", "medication", "drop_off", "pick_up", "photo", "note"];

export const CARE_LOG_LABELS: Record<CareLogKind, string> = {
  meal: "Repas",
  walk: "Promenade",
  medication: "Médicament",
  drop_off: "Déposé",
  pick_up: "Récupéré",
  photo: "Photo",
  note: "Note",
};

/** Sentence used in the timeline and the "latest news". */
export const CARE_LOG_SENTENCES: Record<CareLogKind, string> = {
  meal: "a mangé",
  walk: "promenade",
  medication: "médicament donné",
  drop_off: "pris en charge",
  pick_up: "récupéré",
  photo: "photo",
  note: "note",
};

/** Kinds that notify the caretakers (also enforced in add_care_log). */
export const CARE_LOG_NOTIFYING: readonly CareLogKind[] = ["drop_off", "pick_up", "photo"];

type AssignmentLike = { status: string; starts_at: string; ends_at: string };

/** When the helper may write: from 2 hours before the garde until 24 hours after it. */
export function careLogWindow(a: Pick<AssignmentLike, "starts_at" | "ends_at">): Interval {
  return {
    start: new Date(a.starts_at).getTime() - CARE_LOG_OPENS_BEFORE_MS,
    end: new Date(a.ends_at).getTime() + CARE_LOG_CLOSES_AFTER_MS,
  };
}

export function isCareLogOpen(a: AssignmentLike, now: number): boolean {
  if (a.status !== "confirmed") return false;
  const w = careLogWindow(a);
  return now >= w.start && now < w.end;
}

/** The garde is happening now (for the owner's home card). */
export function isOngoing(a: AssignmentLike, now: number): boolean {
  return a.status === "confirmed" && new Date(a.starts_at).getTime() <= now && now < new Date(a.ends_at).getTime();
}

export type CareLogDay<T> = { date: LocalDate; entries: T[] };

/** Newest day first, newest entry first within a day (Paris days). */
export function groupCareLogByDay<T extends Pick<CareLogEntryRow, "occurred_at">>(entries: readonly T[]): CareLogDay<T>[] {
  const sorted = [...entries].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const days: CareLogDay<T>[] = [];
  for (const e of sorted) {
    const date = toLocalDate(e.occurred_at);
    const last = days.at(-1);
    if (last && last.date === date) last.entries.push(e);
    else days.push({ date, entries: [e] });
  }
  return days;
}

/** Most recent entry, or null. */
export function latestCareNews<T extends Pick<CareLogEntryRow, "occurred_at">>(entries: readonly T[]): T | null {
  let latest: T | null = null;
  for (const e of entries) if (!latest || e.occurred_at > latest.occurred_at) latest = e;
  return latest;
}
