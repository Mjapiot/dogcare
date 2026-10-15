import { describe, expect, it } from "vitest";
import {
  evaluatePeriodAvailability,
  resolveSlot,
  type AvailabilityEntry,
  type AvailabilityRule,
} from "@/domain/availability";
import { zonedInstant } from "@/domain/time";

// 2026-10-14 is a Wednesday (ISO 3)
const WED = "2026-10-14";

describe("resolveSlot", () => {
  const rules: AvailabilityRule[] = [{ weekday: 3, slot: "afternoon", status: "available" }];

  it("defaults to unknown", () => {
    expect(resolveSlot(WED, "morning", [], rules)).toEqual({ status: "unknown", source: "none" });
  });

  it("applies weekly rules", () => {
    expect(resolveSlot(WED, "afternoon", [], rules)).toEqual({ status: "available", source: "rule" });
    expect(resolveSlot("2026-10-21", "afternoon", [], rules).status).toBe("available");
    expect(resolveSlot("2026-10-15", "afternoon", [], rules).status).toBe("unknown");
  });

  it("one-off entries win over rules", () => {
    const entries: AvailabilityEntry[] = [{ date: WED, slot: "afternoon", status: "unavailable" }];
    expect(resolveSlot(WED, "afternoon", entries, rules)).toEqual({ status: "unavailable", source: "entry" });
    // the following Wednesday still follows the rule
    expect(resolveSlot("2026-10-21", "afternoon", entries, rules).status).toBe("available");
  });
});

describe("evaluatePeriodAvailability", () => {
  const period = (d: string, from: string, to: string, d2 = d) => ({
    start: zonedInstant(d, from),
    end: zonedInstant(d2, to),
  });

  it("is available when every touched slot is available", () => {
    const entries: AvailabilityEntry[] = [{ date: WED, slot: "afternoon", status: "available" }];
    expect(evaluatePeriodAvailability(period(WED, "14:00", "16:00"), entries, []).status).toBe("available");
  });

  it("is partial ('À vérifier') when only part of the period is declared available", () => {
    const entries: AvailabilityEntry[] = [{ date: WED, slot: "afternoon", status: "available" }];
    const result = evaluatePeriodAvailability(period(WED, "09:00", "18:00"), entries, []);
    expect(result.status).toBe("partial");
    expect(result.availableParts).toEqual([period(WED, "12:00", "18:00")]);
    expect(result.unknownParts).toEqual([period(WED, "09:00", "12:00")]);
  });

  it("is unavailable only when everything touched is declared unavailable", () => {
    const entries: AvailabilityEntry[] = [
      { date: WED, slot: "morning", status: "unavailable" },
      { date: WED, slot: "afternoon", status: "unavailable" },
    ];
    expect(evaluatePeriodAvailability(period(WED, "09:00", "18:00"), entries, []).status).toBe("unavailable");
  });

  it("is unknown when nothing is declared", () => {
    expect(evaluatePeriodAvailability(period(WED, "09:00", "18:00"), [], []).status).toBe("unknown");
  });

  it("stays unknown (never unavailable) when part is undeclared", () => {
    const entries: AvailabilityEntry[] = [{ date: WED, slot: "morning", status: "unavailable" }];
    expect(evaluatePeriodAvailability(period(WED, "09:00", "18:00"), entries, []).status).toBe("unknown");
  });

  it("handles overnight periods with the night slot", () => {
    const entries: AvailabilityEntry[] = [
      { date: WED, slot: "evening", status: "available" },
      { date: WED, slot: "night", status: "available" },
    ];
    const p = period(WED, "20:00", "02:00", "2026-10-15");
    expect(evaluatePeriodAvailability(p, entries, []).status).toBe("available");
  });

  it("handles the DST night (25 October 2026)", () => {
    const rules: AvailabilityRule[] = [{ weekday: 6, slot: "night", status: "available" }]; // Saturday
    const p = period("2026-10-24", "22:00", "06:00", "2026-10-25");
    const result = evaluatePeriodAvailability(p, [], rules);
    expect(result.status).toBe("available");
    expect(result.availableParts[0].end - result.availableParts[0].start).toBe(9 * 3_600_000);
  });
});
