import { describe, expect, it } from "vitest";
import { cumulBusy, cumulBusyRows, maxDogsLabel } from "@/domain/cumul";

const period = { start: 0, end: 100 };
const g = (start: number, end: number, aloneOnly: boolean | null = false) => ({ start, end, aloneOnly });

describe("cumulBusy", () => {
  it("a person keeping one dog can take another up to their limit", () => {
    expect(cumulBusy(period, [g(10, 30)], { count: 1, aloneOnly: false }, 2)).toEqual([]);
    expect(cumulBusy(period, [g(10, 30)], { count: 1, aloneOnly: false }, 1)).toEqual([{ start: 10, end: 30 }]);
    // two dogs already kept between 20 and 30: a third one only with a limit of 3
    expect(cumulBusy(period, [g(10, 30), g(20, 40)], { count: 1, aloneOnly: false }, 2)).toEqual([{ start: 20, end: 30 }]);
    expect(cumulBusy(period, [g(10, 30), g(20, 40)], { count: 1, aloneOnly: false }, 3)).toEqual([]);
    expect(cumulBusy(period, [g(10, 30), g(20, 40)], { count: 1, aloneOnly: false }, null)).toEqual([]);
  });

  it("taking two dogs at once counts for two", () => {
    expect(cumulBusy(period, [g(10, 30)], { count: 2, aloneOnly: false }, 2)).toEqual([{ start: 10, end: 30 }]);
    // more dogs than the limit: never
    expect(cumulBusy(period, [], { count: 3, aloneOnly: false }, 2)).toEqual([period]);
  });

  it("a dog kept alone, taken or kept, conflicts with any garde; an unknown dog too", () => {
    expect(cumulBusy(period, [g(10, 30)], { count: 1, aloneOnly: true }, 5)).toEqual([{ start: 10, end: 30 }]);
    expect(cumulBusy(period, [g(10, 30, true)], { count: 1, aloneOnly: false }, 5)).toEqual([{ start: 10, end: 30 }]);
    expect(cumulBusy(period, [g(10, 30, null)], { count: 1, aloneOnly: false }, 5)).toEqual([{ start: 10, end: 30 }]);
    // outside the period: ignored
    expect(cumulBusy(period, [g(150, 200, true)], { count: 1, aloneOnly: true }, 1)).toEqual([]);
  });

  it("builds busy rows per person with their limit (default 2)", () => {
    const iso = (t: number) => new Date(t).toISOString();
    const rows = [
      { assigned_user_id: "emma", starts_at: iso(10), ends_at: iso(30), alone_only: false },
      { assigned_user_id: "lea", starts_at: iso(10), ends_at: iso(30), alone_only: false },
    ];
    expect(cumulBusyRows(period, rows, { count: 1, aloneOnly: false }, { lea: 1 }).map((r) => r.assigned_user_id)).toEqual(["lea"]);
    expect(maxDogsLabel(null)).toBe("Sans limite");
    expect(maxDogsLabel(1)).toBe("1 chien");
  });
});
