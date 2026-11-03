import { describe, expect, it } from "vitest";
import { buildHomeTodo } from "@/domain/home";
import type { ScreenItem } from "@/domain/requests-screen";
import type { RequestView } from "@/domain/views";
import { zonedInstant } from "@/domain/time";
import type { AssignmentStatus } from "@/lib/types";

const z = (d: number, t: string) => zonedInstant(`2026-11-${String(d).padStart(2, "0")}`, t);
const iso = (t: number) => new Date(t).toISOString();
const NOW = z(10, "12:00"); // Tuesday 10 November 2026

const item = (id: string, over: Partial<ScreenItem> = {}): ScreenItem =>
  ({
    key: `g-${id}`,
    source: "group",
    requestId: id,
    href: `/requests/${id}`,
    dogId: "d",
    dogName: "Rex",
    period: { start: z(13, "18:00"), end: z(15, "10:00") },
    myAssignments: [],
    needsMyAnswer: false,
    ...over,
  }) as ScreenItem;

const view = (id: string, status: string, over: Record<string, unknown> = {}): RequestView =>
  ({
    request: { id, lifecycle_status: "active", necessity: "required" },
    dog: { name: "Aston" },
    period: { start: z(14, "09:00"), end: z(16, "09:00") },
    iAmCaretaker: true,
    status: { status },
    assignments: [],
    ...over,
  }) as unknown as RequestView;

const assignment = (id: string, start: number, end: number, status: AssignmentStatus = "confirmed") => ({ id, starts_at: iso(start), ends_at: iso(end), status, previous_starts_at: null, previous_ends_at: null });

describe("buildHomeTodo", () => {
  it("lists what to do, most urgent kinds first, each soonest first, and counts it", () => {
    const t = buildHomeTodo({
      now: NOW,
      proposals: [{ id: "p", requestIds: ["asked"], parts: [] }],
      items: [
        item("later", { needsMyAnswer: true, period: { start: z(20, "09:00"), end: z(21, "09:00") } }),
        item("soon", { needsMyAnswer: true }),
        // already asked through a proposal: the proposal card is enough
        item("asked", { needsMyAnswer: true }),
        item("changed", { myAssignments: [assignment("a1", z(12, "09:00"), z(12, "18:00"), "pending_reconfirmation")] }),
      ],
      views: [
        view("hole", "uncovered"),
        view("yes", "volunteer_found"),
        view("covered", "confirmed"),
        view("past", "uncovered", { period: { start: z(1, "09:00"), end: z(2, "09:00") } }),
        view("info", "awaiting_responses", { request: { id: "info", lifecycle_status: "active", necessity: "info" } }),
        view("theirs", "uncovered", { iAmCaretaker: false }),
      ],
    });
    expect(t.reconfirm.map((i) => i.requestId)).toEqual(["changed"]);
    expect(t.answer.map((i) => i.requestId)).toEqual(["soon", "later"]);
    expect(t.confirm.map((v) => v.request.id)).toEqual(["yes"]);
    expect(t.holes.map((v) => v.request.id)).toEqual(["hole"]);
    expect(t.count).toBe(1 + 1 + 2 + 1 + 1);
  });

  it("shows the gardes happening now with their nights; otherwise my next garde within a week", () => {
    const ongoing = buildHomeTodo({
      now: NOW,
      proposals: [],
      items: [item("mine", { dogName: "Rex", myAssignments: [assignment("a", z(8, "18:00"), z(11, "10:00"))] })],
      views: [view("aston", "confirmed", { assignments: [{ ...assignment("b", z(9, "09:00"), z(12, "09:00")), name: "Emma" }] })],
    });
    // Rex: nights of the 9th, 10th and 11th (01:00 markers), two passed by Tuesday noon; Aston: 10th, 11th, 12th
    expect(ongoing.ongoing.map((o) => [o.dogName, o.keeper, o.role, o.nights, o.nightsDone])).toEqual([
      ["Rex", "vous", "helper", 3, 2],
      ["Aston", "Emma", "owner", 3, 1],
    ]);
    expect(ongoing.next).toBeNull();
    expect(ongoing.count).toBe(0);

    const upcoming = buildHomeTodo({
      now: NOW,
      proposals: [],
      views: [],
      items: [
        item("far", { myAssignments: [assignment("c", z(25, "09:00"), z(26, "09:00"))] }),
        item("near", { myAssignments: [assignment("d", z(13, "18:00"), z(15, "10:00"))] }),
      ],
    });
    expect(upcoming.next?.requestId).toBe("near");
  });
});
