/**
 * Half-open time intervals [start, end) expressed in epoch milliseconds.
 * Adjacent intervals ([a, b) and [b, c)) touch but do not overlap, and merge
 * into a single [a, c) when unioned.
 */
export type Interval = { start: number; end: number };

export function isValidInterval(i: Interval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.start < i.end;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

export function duration(i: Interval): number {
  return Math.max(0, i.end - i.start);
}

/** Sorts and merges overlapping or adjacent intervals. Invalid ones are dropped. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter(isValidInterval)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/** Parts of `base` not covered by any of `cuts`. */
export function subtractIntervals(base: Interval, cuts: readonly Interval[]): Interval[] {
  if (!isValidInterval(base)) return [];
  const gaps: Interval[] = [];
  let cursor = base.start;
  for (const cut of mergeIntervals(cuts)) {
    if (cut.end <= cursor) continue;
    if (cut.start >= base.end) break;
    if (cut.start > cursor) gaps.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
    if (cursor >= base.end) break;
  }
  if (cursor < base.end) gaps.push({ start: cursor, end: base.end });
  return gaps;
}

export function totalDuration(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + duration(i), 0);
}

export function toInterval(start: string | Date, end: string | Date): Interval {
  return { start: new Date(start).getTime(), end: new Date(end).getTime() };
}
