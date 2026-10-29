import { describe, expect, it } from "vitest";
import { copyPreviousWeek, filledCount, habitsSummary, needsByDay, presetCells, weekStarts } from "@/domain/availability-screen";
import { zonedInstant } from "@/domain/time";

// Wednesday 11 November 2026
const today = "2026-11-11";

describe("weeks and quick selections", () => {
  it("shows the current week and the next three", () => {
    expect(weekStarts(today)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  });

  it("picks the right cells and never past days", () => {
    expect(presetCells("week", "2026-11-09", today)).toHaveLength(5 * 4); // Wednesday → Sunday
    expect(presetCells("evenings", "2026-11-09", today)).toEqual(
      ["11", "12", "13", "14", "15"].flatMap((d) => [`2026-11-${d}|evening`, `2026-11-${d}|night`]),
    );
    expect(presetCells("weekend", "2026-11-16", today)).toEqual(
      ["morning", "afternoon", "evening", "night"].flatMap((s) => [`2026-11-21|${s}`]).concat(
        ["morning", "afternoon", "evening", "night"].map((s) => `2026-11-22|${s}`),
      ),
    );
  });
});

describe("copying last week", () => {
  it("moves last week's entries 7 days later, skipping past days", () => {
    const entries = [
      { date: "2026-11-09", slot: "evening" as const, status: "available" as const },
      { date: "2026-11-13", slot: "morning" as const, status: "unavailable" as const },
      { date: "2026-11-02", slot: "morning" as const, status: "available" as const }, // two weeks ago
    ];
    expect(copyPreviousWeek(entries, "2026-11-16", today)).toEqual([
      { date: "2026-11-16", slot: "evening", status: "available" },
      { date: "2026-11-20", slot: "morning", status: "unavailable" },
    ]);
    // copying into the current week: Monday 9 is past
    expect(copyPreviousWeek([{ date: "2026-11-02", slot: "night", status: "available" }], "2026-11-09", today)).toEqual([]);
  });

  it("works across the clock change (dates, not hours)", () => {
    // clocks go back on Sunday 25 October 2026
    expect(copyPreviousWeek([{ date: "2026-10-25", slot: "night", status: "available" }], "2026-10-26", "2026-10-20")).toEqual([
      { date: "2026-11-01", slot: "night", status: "available" },
    ]);
  });
});

describe("filled gauge", () => {
  it("counts declared slots (entries or habits) among the days ahead", () => {
    const entries = [{ date: "2026-11-12", slot: "morning" as const, status: "unavailable" as const }];
    const rules = [{ weekday: 3, slot: "afternoon" as const, status: "available" as const }]; // Wednesdays
    expect(filledCount("2026-11-09", today, entries, rules)).toEqual({ filled: 2, total: 20 });
  });
});

describe("needs on my days", () => {
  it("lists each need on every Paris day it touches", () => {
    const need = {
      requestId: "r",
      href: "/requests/r",
      dogName: "Aston",
      period: { start: zonedInstant("2026-11-12", "20:00"), end: zonedInstant("2026-11-14", "10:00") },
    };
    expect(Object.keys(needsByDay([need]))).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });
});

describe("habits summary", () => {
  it("reads like a sentence", () => {
    expect(
      habitsSummary([
        { weekday: 3, slot: "afternoon", status: "available" },
        { weekday: 6, slot: "morning", status: "available" },
        { weekday: 6, slot: "evening", status: "available" },
        { weekday: 1, slot: "morning", status: "unavailable" },
      ]),
    ).toBe("Disponible le mercredi après-midi et le samedi matin et soir.");
    expect(habitsSummary([])).toBe("Aucune habitude de disponibilité pour l'instant.");
    expect(habitsSummary(["morning", "afternoon", "evening", "night"].map((s) => ({ weekday: 7, slot: s as "morning", status: "available" as const })))).toBe(
      "Disponible le dimanche toute la journée.",
    );
  });
});
