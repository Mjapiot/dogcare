import { TZDate } from "@date-fns/tz";
import { APP_TIME_ZONE, SLOTS, SLOT_KEYS, type SlotKey } from "./config";
import type { Interval } from "./intervals";

/** A calendar date without time, "YYYY-MM-DD", interpreted in a time zone. */
export type LocalDate = string;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid local date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function parseLocalTime(time: string): { hours: number; minutes: number } {
  const match = LOCAL_TIME_RE.exec(time.slice(0, 5));
  if (!match) throw new Error(`Invalid local time: ${time}`);
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Pure calendar arithmetic (no time zone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Inclusive list of local dates from `from` to `to`. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; compareLocalDates(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Absolute instant (epoch ms) of a local wall-clock time in a time zone. */
export function zonedInstant(date: LocalDate, time: string, timeZone = APP_TIME_ZONE): number {
  const { year, month, day } = parseLocalDate(date);
  const { hours, minutes } = parseLocalTime(time);
  return new TZDate(year, month - 1, day, hours, minutes, 0, 0, timeZone).getTime();
}

/** Local date of an instant in a time zone. */
export function toLocalDate(instant: number | string | Date, timeZone = APP_TIME_ZONE): LocalDate {
  const d = new TZDate(new Date(instant).getTime(), timeZone);
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Local "HH:MM" of an instant in a time zone. */
export function toLocalTime(instant: number | string | Date, timeZone = APP_TIME_ZONE): string {
  const d = new TZDate(new Date(instant).getTime(), timeZone);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayLocal(now: number = Date.now(), timeZone = APP_TIME_ZONE): LocalDate {
  return toLocalDate(now, timeZone);
}

/** Start of a local day [00:00, next day 00:00). Handles 23h/25h DST days. */
export function localDayInterval(date: LocalDate, timeZone = APP_TIME_ZONE): Interval {
  return {
    start: zonedInstant(date, "00:00", timeZone),
    end: zonedInstant(addDays(date, 1), "00:00", timeZone),
  };
}

/** Absolute interval of a slot starting on a given local date. */
export function slotInterval(date: LocalDate, slot: SlotKey, timeZone = APP_TIME_ZONE): Interval {
  const def = SLOTS[slot];
  const start = zonedInstant(date, def.start, timeZone);
  const endsNextDay = def.end <= def.start;
  const end = zonedInstant(endsNextDay ? addDays(date, 1) : date, def.end, timeZone);
  return { start, end };
}

export type SlotInstance = { date: LocalDate; slot: SlotKey; interval: Interval };

/**
 * All slot instances overlapping an interval. Includes the previous day's
 * night slot, which spills over midnight.
 */
export function slotInstancesOverlapping(
  interval: Interval,
  timeZone = APP_TIME_ZONE,
): SlotInstance[] {
  const first = addDays(toLocalDate(interval.start, timeZone), -1);
  const last = toLocalDate(interval.end, timeZone);
  const out: SlotInstance[] = [];
  for (const date of dateRange(first, last)) {
    for (const slot of SLOT_KEYS) {
      const si = slotInterval(date, slot, timeZone);
      if (si.start < interval.end && interval.start < si.end) out.push({ date, slot, interval: si });
    }
  }
  return out;
}

/** Local dates an interval touches (end is exclusive). */
export function localDatesTouched(interval: Interval, timeZone = APP_TIME_ZONE): LocalDate[] {
  const first = toLocalDate(interval.start, timeZone);
  const last = toLocalDate(interval.end - 1, timeZone);
  return dateRange(first, last);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}
