import { describe, expect, it } from "vitest";
import { availableNames, availableOn, needCards, type CalItem } from "@/domain/calendar";
import { zonedInstant } from "@/domain/time";

const at = (date: string, time: string) => zonedInstant(date, time);
function item(id: string, from: [string, string], to: [string, string], over: Partial<CalItem> = {}): CalItem {
  return {
    id,
    dogId: "d",
    dogName: id,
    type: "care",
    status: "awaiting_responses",
    tone: "pending",
    label: "En attente",
    start: at(...from),
    end: at(...to),
    helpers: [],
    covered: 0,
    mine: false,
    myGuard: false,
    isPast: false,
    ...over,
  };
}

// Monday 9 → Sunday 15 November 2026
const holiday = item("Aston", ["2026-11-09", "09:00"], ["2026-11-12", "18:00"]);
const walk = item("Moka", ["2026-11-11", "12:00"], ["2026-11-11", "13:00"], { type: "visit" });

describe("needs of the agenda", () => {
  it("one card per need, on its first day shown; a need already going on shows on the first day", () => {
    const later = item("Rex", ["2026-11-20", "09:00"], ["2026-11-21", "09:00"]);
    const outside = item("Old", ["2026-10-01", "09:00"], ["2026-10-02", "09:00"]);
    expect(needCards([later, walk, holiday, outside], "2026-11-10", "2026-11-30").map((c) => [c.date, c.item.id])).toEqual([
      ["2026-11-10", "Aston"],
      ["2026-11-11", "Moka"],
      ["2026-11-20", "Rex"],
    ]);
  });

  it("uses Paris days: a need ending at midnight does not touch the next day", () => {
    const evening = item("Nala", ["2026-11-09", "18:00"], ["2026-11-10", "00:00"]);
    expect(needCards([evening], "2026-11-10", "2026-11-30")).toEqual([]);
  });
});

describe("available on a day", () => {
  it("lists people per slot; a one-off entry wins over a habit", () => {
    const people = [
      { userId: "e", name: "Emma", entries: [{ date: "2026-11-11", slot: "evening" as const, status: "available" as const }], rules: [] },
      // Léa is usually free on Wednesday afternoons, but not this one
      {
        userId: "l",
        name: "Léa",
        entries: [{ date: "2026-11-11", slot: "afternoon" as const, status: "unavailable" as const }],
        rules: [
          { weekday: 3, slot: "afternoon" as const, status: "available" as const },
          { weekday: 3, slot: "morning" as const, status: "available" as const },
        ],
      },
    ];
    expect(availableOn("2026-11-11", people)).toEqual({ morning: ["Léa"], afternoon: [], evening: ["Emma"], night: [] });
    expect(availableNames(availableOn("2026-11-11", people))).toEqual(["Léa", "Emma"]);
  });
});
