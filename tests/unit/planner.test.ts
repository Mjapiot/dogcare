import { describe, expect, it } from "vitest";
import { consecutiveNights, countHandoffs, nightAnchors, proposePlan, type PlanOffer } from "@/domain/planner";
import { zonedInstant } from "@/domain/time";

const H = 3_600_000;
// Monday 9 → Sunday 15 November 2026, Paris
const at = (day: number, time: string) => zonedInstant(`2026-11-${String(day).padStart(2, "0")}`, time);
const period = { start: at(9, "09:00"), end: at(15, "18:00") };
const offer = (userId: string, start: number, end: number, respondedAt = "2026-11-01T10:00:00Z", busy: { start: number; end: number }[] = []): PlanOffer => ({
  userId,
  name: userId,
  offer: { start, end },
  busy,
  respondedAt,
});
const view = (p: ReturnType<typeof proposePlan>) => ({
  slices: p.slices.map((s) => [s.userId, new Date(s.start).toISOString(), new Date(s.end).toISOString()]),
  holes: p.holes.map((h) => [new Date(h.start).toISOString(), new Date(h.end).toISOString()]),
});
const iso = (t: number) => new Date(t).toISOString();

describe("nights", () => {
  it("one anchor per night, also across daylight saving changes", () => {
    expect(nightAnchors(period)).toHaveLength(6);
    // clocks go forward on 2027-03-28 and back on 2026-10-25
    expect(nightAnchors({ start: zonedInstant("2027-03-27", "12:00"), end: zonedInstant("2027-03-30", "12:00") })).toHaveLength(3);
    expect(nightAnchors({ start: zonedInstant("2026-10-24", "12:00"), end: zonedInstant("2026-10-27", "12:00") })).toHaveLength(3);
  });

  it("counts the longest run of consecutive nights per person", () => {
    const slices = [
      { userId: "emma", start: at(9, "09:00"), end: at(11, "10:00") },
      { userId: "lea", start: at(11, "10:00"), end: at(12, "10:00") },
      { userId: "emma", start: at(12, "10:00"), end: at(15, "18:00") },
    ];
    expect(consecutiveNights(slices, period)).toEqual({ emma: 3, lea: 1 });
    expect(countHandoffs(slices)).toBe(2);
  });
});

describe("proposePlan", () => {
  it("one volunteer for the whole holiday: never more than 3 nights in a row", () => {
    const p = proposePlan({ period, taken: [], offers: [offer("emma", period.start, period.end)] });
    expect(view(p)).toEqual({
      slices: [
        ["emma", iso(at(9, "09:00")), iso(at(12, "20:00"))],
        ["emma", iso(at(13, "10:00")), iso(at(15, "18:00"))],
      ],
      holes: [[iso(at(12, "20:00")), iso(at(13, "10:00"))]],
    });
    expect(p.holes[0].reason).toBe("emma dépasserait 3 nuits d'affilée");
    expect(p.nights.emma).toBe(3);
  });

  it("splits partial offers with as few handoffs as possible", () => {
    const p = proposePlan({
      period,
      taken: [],
      offers: [
        offer("emma", at(9, "09:00"), at(11, "18:00")),
        offer("lea", at(11, "12:00"), at(15, "18:00")),
        offer("chloe", at(12, "08:00"), at(14, "12:00")),
      ],
      rules: { maxConsecutiveNights: 4, minSliceMs: 3 * H },
    });
    expect(view(p)).toEqual({
      slices: [
        ["emma", iso(at(9, "09:00")), iso(at(11, "18:00"))],
        ["lea", iso(at(11, "18:00")), iso(at(15, "18:00"))],
      ],
      holes: [],
    });
    expect(p.coveredMs).toBe(p.openMs);
    expect(p.handoffs).toBe(1);
  });

  it("keeps what is already confirmed and plans around it", () => {
    const p = proposePlan({
      period: { start: at(9, "09:00"), end: at(9, "18:00") },
      taken: [{ start: at(9, "09:00"), end: at(9, "12:00") }],
      offers: [offer("emma", at(9, "09:00"), at(9, "18:00"))],
    });
    expect(view(p).slices).toEqual([["emma", iso(at(9, "12:00")), iso(at(9, "18:00"))]]);
    expect(p.openMs).toBe(6 * H);
  });

  it("never gives a slice to someone busy with another garde", () => {
    const p = proposePlan({
      period: { start: at(9, "09:00"), end: at(9, "18:00") },
      taken: [],
      offers: [offer("emma", at(9, "09:00"), at(9, "18:00"), undefined, [{ start: at(9, "12:00"), end: at(9, "14:00") }])],
    });
    expect(view(p).slices).toEqual([
      ["emma", iso(at(9, "09:00")), iso(at(9, "12:00"))],
      ["emma", iso(at(9, "14:00")), iso(at(9, "18:00"))],
    ]);
    expect(p.holes).toEqual([{ start: at(9, "12:00"), end: at(9, "14:00"), reason: "emma a déjà une autre garde à ce moment-là" }]);
  });

  it("explains holes nobody offered, and keeps an unavoidable short slice", () => {
    const p = proposePlan({
      period: { start: at(9, "09:00"), end: at(9, "18:00") },
      taken: [],
      offers: [offer("emma", at(9, "09:00"), at(9, "16:00")), offer("chloe", at(9, "17:00"), at(9, "18:00"))],
    });
    expect(view(p).slices).toEqual([
      ["emma", iso(at(9, "09:00")), iso(at(9, "16:00"))],
      ["chloe", iso(at(9, "17:00")), iso(at(9, "18:00"))],
    ]);
    expect(p.holes[0].reason).toBe("Personne n'a proposé ce créneau");
  });

  it("is deterministic: ties go to who has less time, then who answered first", () => {
    const short = { start: at(9, "09:00"), end: at(9, "18:00") };
    const input = {
      period: short,
      taken: [],
      offers: [offer("zoe", short.start, short.end, "2026-11-02T10:00:00Z"), offer("ana", short.start, short.end, "2026-11-01T10:00:00Z")],
    };
    expect(view(proposePlan(input)).slices).toEqual([["ana", iso(short.start), iso(short.end)]]);
    expect(proposePlan(input)).toEqual(proposePlan(input));
  });
});
