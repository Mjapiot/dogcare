import { describe, expect, it } from "vitest";
import { groupByHorizon, horizonOf, responsesSummary, splitScreenItems, type ScreenItem } from "@/domain/requests-screen";

const H = 3_600_000;
// Tuesday 10 November 2026, 20:00 in Paris
const NOW = Date.parse("2026-11-10T19:00:00Z");
const paris = (date: string, hour: number) => Date.parse(`${date}T${String(hour - 1).padStart(2, "0")}:00:00Z`);

function item(over: Partial<ScreenItem> & { start: number }): ScreenItem {
  const { start, ...rest } = over;
  return {
    key: `k-${start}`,
    source: "group",
    requestId: `r-${start}`,
    href: "/requests/x",
    dogId: "d",
    dogName: "Aston",
    requestType: "care",
    necessity: "required",
    period: { start, end: start + 4 * H },
    ownerNames: ["Julie"],
    description: null,
    splittable: true,
    tone: "pending",
    label: "En attente",
    status: null,
    myResponse: null,
    myAssignments: [],
    needsMyAnswer: false,
    answerable: true,
    ...rest,
  };
}

describe("horizon (Paris days)", () => {
  it("today, tomorrow, this week, later; a started request counts as today", () => {
    expect(horizonOf({ start: NOW - H, end: NOW + H }, NOW)).toBe("today");
    expect(horizonOf({ start: paris("2026-11-10", 23), end: paris("2026-11-10", 23) + H }, NOW)).toBe("today");
    // 00:30 in Paris on the 11th is already tomorrow
    expect(horizonOf({ start: Date.parse("2026-11-10T23:30:00Z"), end: Date.parse("2026-11-11T02:00:00Z") }, NOW)).toBe("tomorrow");
    expect(horizonOf({ start: paris("2026-11-16", 9), end: paris("2026-11-16", 10) }, NOW)).toBe("week");
    expect(horizonOf({ start: paris("2026-11-17", 9), end: paris("2026-11-17", 10) }, NOW)).toBe("later");
  });

  it("groups in display order and skips empty groups", () => {
    const items = [item({ start: paris("2026-11-20", 9) }), item({ start: paris("2026-11-11", 9) })];
    expect(groupByHorizon(items, NOW).map((g) => g.horizon)).toEqual(["tomorrow", "later"]);
  });
});

describe("lists", () => {
  it("sorts into to answer, already answered and my gardes (reconfirmation, then ongoing, then next)", () => {
    const todo = item({ start: paris("2026-11-12", 9), needsMyAnswer: true, source: "circle" });
    const said = item({ start: paris("2026-11-13", 9), myResponse: { status: "no", proposed: null } });
    const closed = item({ start: paris("2026-11-14", 9), myResponse: { status: "yes", proposed: null }, answerable: false });
    const assignment = (start: number, status: "confirmed" | "pending_reconfirmation") => ({
      id: `a-${start}`,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + 4 * H).toISOString(),
      status,
      previous_starts_at: null,
      previous_ends_at: null,
    });
    const next = item({ start: paris("2026-11-15", 9), myAssignments: [assignment(paris("2026-11-15", 9), "confirmed")] });
    const ongoing = item({ start: NOW - H, myAssignments: [assignment(NOW - H, "confirmed")] });
    const reconfirm = item({ start: paris("2026-11-18", 9), myAssignments: [assignment(paris("2026-11-18", 9), "pending_reconfirmation")] });
    const lists = splitScreenItems([next, said, reconfirm, todo, ongoing, closed], NOW);
    expect(lists.todo).toEqual([todo]);
    expect(lists.answered).toEqual([said]);
    expect(lists.guards.map((g) => g.key)).toEqual([reconfirm.key, ongoing.key, next.key]);
  });

  it("summarises answers for the owner", () => {
    expect(responsesSummary({ yes: 2, no: 1, pending: 3 })).toBe("2 oui · 1 non · 3 sans réponse");
    expect(responsesSummary({ yes: 0, no: 0, pending: 0 })).toBe("Personne à solliciter");
  });
});
