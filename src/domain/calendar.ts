/**
 * Calendar screen: one item per request (even over several days), agenda
 * rows with quiet days grouped, month bars split week by week, the summary
 * counts and who declared themselves available on a day. Pure; Paris days.
 */
import { resolveSlot, type AvailabilityEntry, type AvailabilityRule } from "./availability";
import { SLOT_KEYS, type SlotKey } from "./config";
import { needsOrganizing, type RequestStatus, type RequestType, type StatusTone } from "./status";
import { addDays, dateRange, toLocalDate, type LocalDate } from "./time";
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

export type CalScope = "all" | "mine" | "guards";
export type CalFocus = "all" | "uncovered" | "organize" | "confirmed";

const isUncovered = (i: CalItem) => (i.tone === "uncovered" || i.tone === "partial") && !i.isPast;

export function filterCalItems(items: readonly CalItem[], scope: CalScope, focus: CalFocus): CalItem[] {
  return items.filter((i) => {
    if (scope === "mine" && !i.mine) return false;
    if (scope === "guards" && !i.myGuard) return false;
    if (focus === "uncovered") return isUncovered(i);
    if (focus === "organize") return needsOrganizing(i.status) && !i.isPast;
    if (focus === "confirmed") return i.status === "confirmed";
    return true;
  });
}

/** "2 sans solution · 3 à organiser · 5 couverts" (a need can be both uncovered and to organise). */
export function calSummary(items: readonly CalItem[]): { uncovered: number; organize: number; confirmed: number } {
  return {
    uncovered: items.filter(isUncovered).length,
    organize: items.filter((i) => needsOrganizing(i.status) && !i.isPast).length,
    confirmed: items.filter((i) => i.status === "confirmed").length,
  };
}

const firstDay = (i: CalItem) => toLocalDate(i.start);
const lastDay = (i: CalItem) => toLocalDate(i.end - 1);
const touches = (i: CalItem, date: LocalDate) => firstDay(i) <= date && date <= lastDay(i);

export type AgendaRow =
  | { kind: "day"; date: LocalDate; items: CalItem[]; continuing: CalItem[] }
  | { kind: "quiet"; from: LocalDate; to: LocalDate; continuing: CalItem[] };

/**
 * One row per day where something starts (a request shows once, on its first
 * day on screen); consecutive days where nothing starts are grouped, with the
 * requests still going on during them.
 */
export function agendaRows(items: readonly CalItem[], from: LocalDate, to: LocalDate): AgendaRow[] {
  const rows: AgendaRow[] = [];
  const sorted = [...items].sort((a, b) => a.start - b.start);
  for (const date of dateRange(from, to)) {
    const starting = sorted.filter((i) => touches(i, date) && (firstDay(i) === date || (date === from && firstDay(i) < from)));
    const continuing = sorted.filter((i) => touches(i, date) && !starting.includes(i));
    const last = rows.at(-1);
    if (starting.length) rows.push({ kind: "day", date, items: starting, continuing });
    else if (last?.kind === "quiet" && last.to === addDays(date, -1)) {
      last.to = date;
      for (const c of continuing) if (!last.continuing.includes(c)) last.continuing.push(c);
    } else rows.push({ kind: "quiet", from: date, to: date, continuing });
  }
  return rows;
}

export type WeekBar = {
  item: CalItem;
  /** Columns 0–6 (Monday–Sunday), inclusive. */
  startCol: number;
  endCol: number;
  /** The request goes on before / after this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
};

/** Bars of one week (starting on `monday`), on at most `maxLanes` lanes; the rest is counted per day. */
export function weekBars(
  items: readonly CalItem[],
  monday: LocalDate,
  maxLanes = 3,
): { bars: WeekBar[]; hidden: number[] } {
  const days = dateRange(monday, addDays(monday, 6));
  const inWeek = items
    .filter((i) => firstDay(i) <= days[6] && lastDay(i) >= days[0])
    .map((item) => {
      const s = firstDay(item) < days[0] ? 0 : days.indexOf(firstDay(item));
      const e = lastDay(item) > days[6] ? 6 : days.indexOf(lastDay(item));
      return { item, startCol: s, endCol: e, continuesBefore: firstDay(item) < days[0], continuesAfter: lastDay(item) > days[6] };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol) || a.item.start - b.item.start);
  const laneEnds: number[] = [];
  const bars: WeekBar[] = [];
  const hidden = [0, 0, 0, 0, 0, 0, 0];
  for (const b of inWeek) {
    let lane = laneEnds.findIndex((end) => end < b.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.endCol;
    if (lane < maxLanes) bars.push({ ...b, lane });
    else for (let c = b.startCol; c <= b.endCol; c++) hidden[c]++;
  }
  return { bars, hidden };
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
