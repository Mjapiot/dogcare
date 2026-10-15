import {
  duration,
  intersect,
  isValidInterval,
  mergeIntervals,
  overlaps,
  subtractIntervals,
  type Interval,
} from "./intervals";

export type CoverageState = "none" | "partial" | "full";

export type CoverageResult = {
  state: CoverageState;
  /** Merged confirmed intervals, clipped to the requested period. */
  covered: Interval[];
  /** Parts of the requested period with no confirmed caretaker. */
  gaps: Interval[];
  coveredMs: number;
  totalMs: number;
};

/**
 * Coverage of a requested period by confirmed assignments.
 * Intervals are half-open [start, end): a request is "full" only when not a
 * single millisecond of the period is left without a confirmed caretaker.
 */
export function computeCoverage(
  requested: Interval,
  confirmedAssignments: readonly Interval[],
): CoverageResult {
  if (!isValidInterval(requested)) {
    return { state: "none", covered: [], gaps: [], coveredMs: 0, totalMs: 0 };
  }
  const clipped = confirmedAssignments
    .map((a) => intersect(a, requested))
    .filter((a): a is Interval => a !== null);
  const covered = mergeIntervals(clipped);
  const gaps = subtractIntervals(requested, covered);
  const totalMs = duration(requested);
  const coveredMs = covered.reduce((sum, i) => sum + duration(i), 0);
  const state: CoverageState = gaps.length === 0 ? "full" : covered.length === 0 ? "none" : "partial";
  return { state, covered, gaps, coveredMs, totalMs };
}

/**
 * Assignments of one helper that overlap each other across different
 * requests (e.g. two dogs at the same time). Returned as id pairs.
 */
export function findAssignmentConflicts<T extends Interval & { id: string; requestId: string }>(
  assignments: readonly T[],
): Array<[T, T]> {
  const sorted = [...assignments].sort((a, b) => a.start - b.start);
  const conflicts: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start >= sorted[i].end) break;
      if (sorted[i].requestId !== sorted[j].requestId && overlaps(sorted[i], sorted[j])) {
        conflicts.push([sorted[i], sorted[j]]);
      }
    }
  }
  return conflicts;
}
