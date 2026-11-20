import { describe, expect, it } from "vitest";
import { eventSignature, planCalendarSync, type NativeEvent } from "@/lib/calendar-sync";

const ev = (key: string, over: Partial<NativeEvent> = {}): NativeEvent => ({
  key,
  title: `Garde · ${key}`,
  start: 1_000,
  end: 2_000,
  notes: "",
  url: `https://x/requests/${key}`,
  ...over,
});

describe("planCalendarSync", () => {
  it("creates new gardes, modifies changed ones, deletes those gone, leaves the rest", () => {
    const same = ev("same");
    const moved = ev("moved");
    const written = {
      same: { eventId: "e1", signature: eventSignature(same) },
      moved: { eventId: "e2", signature: eventSignature(moved) },
      cancelled: { eventId: "e3", signature: "old" },
    };
    const plan = planCalendarSync([same, { ...moved, end: 3_000 }, ev("new")], written);
    expect(plan.create.map((e) => e.key)).toEqual(["new"]);
    expect(plan.modify.map((e) => [e.key, e.eventId, e.end])).toEqual([["moved", "e2", 3_000]]);
    expect(plan.remove).toEqual([{ key: "cancelled", eventId: "e3" }]);
  });

  it("a title or notes change (to reconfirm, other helper name) is a modification", () => {
    const e = ev("a");
    const written = { a: { eventId: "e1", signature: eventSignature(e) } };
    expect(planCalendarSync([{ ...e, title: "À reconfirmer · Garde · a" }], written).modify).toHaveLength(1);
    expect(planCalendarSync([e], written)).toEqual({ create: [], modify: [], remove: [] });
  });
});
