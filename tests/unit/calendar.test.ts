import { describe, expect, it } from "vitest";
import { agendaRows, availableOn, calSummary, filterCalItems, weekBars, type CalItem } from "@/domain/calendar";
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

describe("agenda", () => {
  it("shows a multi-day request once and groups quiet days, with what goes on during them", () => {
    const rows = agendaRows([holiday, walk], "2026-11-09", "2026-11-15");
    expect(rows.map((r) => (r.kind === "day" ? ["day", r.date, r.items.map((i) => i.id)] : ["quiet", r.from, r.to, r.continuing.map((i) => i.id)]))).toEqual([
      ["day", "2026-11-09", ["Aston"]],
      ["quiet", "2026-11-10", "2026-11-10", ["Aston"]],
      ["day", "2026-11-11", ["Moka"]],
      ["quiet", "2026-11-12", "2026-11-15", ["Aston"]],
    ]);
    const day11 = rows[2];
    expect(day11.kind === "day" && day11.continuing.map((i) => i.id)).toEqual(["Aston"]);
  });

  it("a request already going on when the agenda starts appears on its first day", () => {
    const rows = agendaRows([holiday], "2026-11-11", "2026-11-12");
    expect(rows[0]).toMatchObject({ kind: "day", date: "2026-11-11" });
  });

  it("uses Paris days: ending at midnight does not touch the next day", () => {
    const night = item("Pixel", ["2026-11-09", "20:00"], ["2026-11-10", "00:00"]);
    const rows = agendaRows([night], "2026-11-09", "2026-11-10");
    expect(rows[1]).toEqual({ kind: "quiet", from: "2026-11-10", to: "2026-11-10", continuing: [] });
  });
});

describe("month bars", () => {
  it("splits a request across weeks and stacks overlapping ones in lanes", () => {
    const long = item("Oscar", ["2026-11-14", "09:00"], ["2026-11-17", "18:00"]);
    const w1 = weekBars([holiday, walk, long], "2026-11-09");
    expect(w1.bars.map((b) => [b.item.id, b.startCol, b.endCol, b.lane, b.continuesAfter])).toEqual([
      ["Aston", 0, 3, 0, false],
      ["Moka", 2, 2, 1, false],
      ["Oscar", 5, 6, 0, true],
    ]);
    const w2 = weekBars([long], "2026-11-16");
    expect(w2.bars).toMatchObject([{ startCol: 0, endCol: 1, continuesBefore: true }]);
  });

  it("counts what does not fit on the lanes, per day", () => {
    const many = ["A", "B", "C", "D"].map((id) => item(id, ["2026-11-10", "09:00"], ["2026-11-10", "18:00"]));
    const { bars, hidden } = weekBars(many, "2026-11-09", 3);
    expect(bars).toHaveLength(3);
    expect(hidden).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
});

describe("summary and filters", () => {
  const uncovered = item("U", ["2026-11-09", "09:00"], ["2026-11-09", "18:00"], { tone: "uncovered", status: "uncovered", mine: true });
  const covered = item("C", ["2026-11-10", "09:00"], ["2026-11-10", "18:00"], { tone: "covered", status: "confirmed", myGuard: true });
  it("counts and filters by scope and status", () => {
    // same rule as the home dashboard: « à organiser » includes « sans solution »
    expect(calSummary([uncovered, covered, walk])).toEqual({ uncovered: 1, organize: 2, confirmed: 1 });
    expect(filterCalItems([uncovered, covered, walk], "mine", "all").map((i) => i.id)).toEqual(["U"]);
    expect(filterCalItems([uncovered, covered, walk], "guards", "all").map((i) => i.id)).toEqual(["C"]);
    expect(filterCalItems([uncovered, covered, walk], "all", "uncovered").map((i) => i.id)).toEqual(["U"]);
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
  });
});
