import { describe, expect, it } from "vitest";
import { computeCoverage, findAssignmentConflicts } from "@/domain/coverage";
import { computeRequestStatus, dayTone, type StatusInput } from "@/domain/status";
import { zonedInstant } from "@/domain/time";
import type { PeriodAvailability } from "@/domain/availability";

const HOUR = 3_600_000;
// Friday 2026-11-06 18:00 → Sunday 2026-11-08 18:00
const FRI = "2026-11-06";
const SAT = "2026-11-07";
const SUN = "2026-11-08";
const weekend = { start: zonedInstant(FRI, "18:00"), end: zonedInstant(SUN, "18:00") };

describe("computeCoverage", () => {
  it("spec example: Emma + Chloé leave the last 9 hours uncovered", () => {
    const emma = { start: zonedInstant(FRI, "18:00"), end: zonedInstant(SAT, "10:00") };
    const chloe = { start: zonedInstant(SAT, "10:00"), end: zonedInstant(SUN, "09:00") };
    const result = computeCoverage(weekend, [emma, chloe]);
    expect(result.state).toBe("partial");
    expect(result.covered).toEqual([{ start: emma.start, end: chloe.end }]);
    expect(result.gaps).toEqual([{ start: zonedInstant(SUN, "09:00"), end: weekend.end }]);
    expect(result.gaps[0].end - result.gaps[0].start).toBe(9 * HOUR);
  });

  it("is full only when not a single minute is missing", () => {
    const almost = { start: weekend.start, end: weekend.end - 60_000 };
    expect(computeCoverage(weekend, [almost]).state).toBe("partial");
    expect(computeCoverage(weekend, [weekend]).state).toBe("full");
  });

  it("ignores assignments outside the period and clips overflowing ones", () => {
    const outside = { start: weekend.end, end: weekend.end + HOUR };
    const overflow = { start: weekend.start - HOUR, end: weekend.end + HOUR };
    expect(computeCoverage(weekend, [outside]).state).toBe("none");
    const result = computeCoverage(weekend, [overflow]);
    expect(result.state).toBe("full");
    expect(result.coveredMs).toBe(result.totalMs);
  });
});

describe("findAssignmentConflicts", () => {
  it("flags overlapping assignments on different requests only", () => {
    const a = { id: "a", requestId: "r1", start: 0, end: 10 };
    const b = { id: "b", requestId: "r2", start: 5, end: 15 };
    const c = { id: "c", requestId: "r3", start: 15, end: 20 };
    const d = { id: "d", requestId: "r1", start: 8, end: 12 };
    const pairs = findAssignmentConflicts([a, b, c, d]).map(([x, y]) => `${x.id}-${y.id}`);
    expect(pairs).toEqual(["a-b", "b-d"]);
  });
});

describe("computeRequestStatus", () => {
  const none = computeCoverage(weekend, []);
  const base = (over: Partial<StatusInput> = {}): StatusInput => ({
    period: weekend,
    necessity: "required",
    lifecycle: "active",
    coverage: none,
    eligibleUserIds: ["emma", "chloe", "leo"],
    responses: [],
    availability: new Map<string, PeriodAvailability>(),
    now: weekend.start - 24 * HOUR,
    ...over,
  });

  it("awaits responses when nobody answered and nobody declared availability", () => {
    const r = computeRequestStatus(base());
    expect(r.status).toBe("awaiting_responses");
    expect(r.tone).toBe("pending");
    expect(r.counts.pending).toBe(3);
  });

  it("never says 'uncovered' while someone has not answered", () => {
    const r = computeRequestStatus(
      base({
        responses: [
          { userId: "emma", status: "no", proposed: null },
          { userId: "chloe", status: "no", proposed: null },
        ],
      }),
    );
    expect(r.status).toBe("awaiting_responses");
    expect(r.counts).toMatchObject({ no: 2, pending: 1 });
  });

  it("is uncovered (red) when every eligible member explicitly said no", () => {
    const r = computeRequestStatus(
      base({
        responses: ["emma", "chloe", "leo"].map((userId) => ({ userId, status: "no" as const, proposed: null })),
      }),
    );
    expect(r.status).toBe("uncovered");
    expect(r.tone).toBe("uncovered");
  });

  it("is not red for a nice-to-have request nobody can do", () => {
    const r = computeRequestStatus(
      base({
        necessity: "nice_to_have",
        responses: ["emma", "chloe", "leo"].map((userId) => ({ userId, status: "no" as const, proposed: null })),
      }),
    );
    expect(r.status).toBe("uncovered");
    expect(r.tone).toBe("muted");
  });

  it("signals potential helpers from declared availability", () => {
    const r = computeRequestStatus(base({ availability: new Map([["leo", "available"]]) }));
    expect(r.status).toBe("potential_helpers");
    expect(r.counts.pendingPotentiallyAvailable).toBe(1);
  });

  it("a yes is a volunteer, not a confirmation", () => {
    const r = computeRequestStatus(base({ responses: [{ userId: "emma", status: "yes", proposed: null }] }));
    expect(r.status).toBe("volunteer_found");
    expect(r.volunteersForGaps).toEqual(["emma"]);
  });

  it("ignores responses from non-eligible users (e.g. the owner)", () => {
    const r = computeRequestStatus(base({ responses: [{ userId: "julie", status: "yes", proposed: null }] }));
    expect(r.status).toBe("awaiting_responses");
  });

  it("is partially covered, then confirmed", () => {
    const half = computeCoverage(weekend, [{ start: weekend.start, end: weekend.start + 10 * HOUR }]);
    expect(computeRequestStatus(base({ coverage: half })).status).toBe("partially_covered");
    expect(computeRequestStatus(base({ coverage: half })).tone).toBe("partial");
    const full = computeCoverage(weekend, [weekend]);
    expect(computeRequestStatus(base({ coverage: full })).status).toBe("confirmed");
  });

  it("informational and cancelled take precedence", () => {
    expect(computeRequestStatus(base({ necessity: "info" })).status).toBe("informational");
    expect(computeRequestStatus(base({ lifecycle: "cancelled" })).status).toBe("cancelled");
  });

  it("treats a group with no eligible member as uncovered", () => {
    expect(computeRequestStatus(base({ eligibleUserIds: [] })).status).toBe("uncovered");
  });

  it("flags past requests", () => {
    expect(computeRequestStatus(base({ now: weekend.end })).isPast).toBe(true);
  });
});

describe("dayTone", () => {
  it("shows the most urgent tone", () => {
    expect(dayTone(["covered", "pending", "info"])).toBe("pending");
    expect(dayTone(["covered", "uncovered"])).toBe("uncovered");
    expect(dayTone([])).toBe("none");
  });
});
