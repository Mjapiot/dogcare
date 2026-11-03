/**
 * Agenda screen, "Besoins": one card per need (even over several days) in a
 * month, and who declared themselves available on a day. Pure; Paris days.
 */
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "./availability";
import { SLOT_KEYS, type SlotKey } from "./config";
import type { RequestStatus, RequestType, StatusTone } from "./status";
import { toLocalDate, type LocalDate } from "./time";
import type { RequestView } from "./views";

export type CalItem = {
  id: string;
  dogId: string;
  dogName: string;
  type: RequestType;
  status: RequestStatus;
  tone: StatusTone;
  label: string;
  start: number;
  end: number;
  /** Confirmed helpers, in order. */
  helpers: string[];
  /** Share of the period with a confirmed garde (0–1). */
  covered: number;
  /** One of my dogs. */
  mine: boolean;
  /** I have a live garde on it. */
  myGuard: boolean;
  isPast: boolean;
};

export function toCalItem(v: RequestView): CalItem {
  return {
    id: v.request.id,
    dogId: v.request.dog_id,
    dogName: v.dog?.name ?? "Chien",
    type: v.request.request_type,
    status: v.status.status,
    tone: v.status.tone,
    label: v.label,
    start: v.period.start,
    end: v.period.end,
    helpers: v.assignments.map((a) => a.name),
    covered: v.coverage.totalMs ? v.coverage.coveredMs / v.coverage.totalMs : 0,
    mine: v.iAmCaretaker,
    myGuard: v.myAssignments.length > 0,
    isPast: v.status.isPast,
  };
}

const firstDay = (i: CalItem) => toLocalDate(i.start);
const lastDay = (i: CalItem) => toLocalDate(i.end - 1);

/**
 * "Besoins" of the agenda: one card per need touching [from, to], on its first
 * day shown (a need already going on shows on `from`), soonest first.
 */
export function needCards(items: readonly CalItem[], from: LocalDate, to: LocalDate): Array<{ date: LocalDate; item: CalItem }> {
  return items
    .filter((i) => firstDay(i) <= to && lastDay(i) >= from)
    .sort((a, b) => a.start - b.start)
    .map((item) => ({ date: firstDay(item) < from ? from : firstDay(item), item }));
}

/** Everyone declared available on a day, whatever the slot (a one-off entry wins over a habit). */
export function availableNames(day: Record<SlotKey, string[]>): string[] {
  return [...new Set(SLOT_KEYS.flatMap((s) => day[s]))];
}

/** Members declared available on a day, slot by slot (a one-off entry wins over a habit). */
export function availableOn(
  date: LocalDate,
  people: ReadonlyArray<{ userId: string; name: string; entries: readonly AvailabilityEntry[]; rules: readonly AvailabilityRule[] }>,
): Record<SlotKey, string[]> {
  const out = Object.fromEntries(SLOT_KEYS.map((k) => [k, [] as string[]])) as Record<SlotKey, string[]>;
  for (const p of people) {
    for (const slot of SLOT_KEYS) {
      if (resolveSlot(date, slot, p.entries, p.rules).status === "available") out[slot].push(p.name);
    }
  }
  return out;
}
