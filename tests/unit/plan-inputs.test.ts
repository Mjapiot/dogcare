import { describe, expect, it } from "vitest";
import { availabilityOffers, canPlan, holeSuggestions, planOffers, planRules, takenIntervals, type PlanPerson } from "@/domain/plan-inputs";
import { proposePlan } from "@/domain/planner";
import { buildRequestViews, type GroupSnapshot } from "@/domain/views";
import { zonedInstant } from "@/domain/time";

const at = (day: number, time: string) => zonedInstant(`2026-11-${String(day).padStart(2, "0")}`, time);
const iso = (t: number) => new Date(t).toISOString();
const NOW = at(1, "12:00");

function snapshot(over: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    me: "julie",
    members: ["julie", "emma", "lea", "max"].map((u) => ({
      group_id: "g",
      user_id: u,
      role: "member" as const,
      share_availability: true,
      joined_at: "",
      display_name: u[0].toUpperCase() + u.slice(1),
    })),
    dogs: [
      { id: "d", name: "Aston", plan_max_nights: 2, plan_min_slice_hours: 4 } as GroupSnapshot["dogs"][number],
    ],
    caretakers: [{ dog_id: "d", user_id: "julie", role: "owner" }],
    requests: [
      {
        id: "r",
        group_id: "g",
        dog_id: "d",
        created_by: "julie",
        request_type: "care",
        necessity: "required",
        starts_at: iso(at(9, "09:00")),
        ends_at: iso(at(11, "18:00")),
        description: null,
        splittable: true,
        lifecycle_status: "active",
        cancelled_at: null,
        cancellation_reason: null,
        revision: 1,
        absence_id: null,
        created_at: "",
        updated_at: "",
      },
    ],
    responses: [
      { id: "1", request_id: "r", user_id: "emma", response_status: "yes", proposed_starts_at: iso(at(9, "09:00")), proposed_ends_at: iso(at(10, "12:00")), note: null, responded_at: "2026-11-02T10:00:00Z" },
      { id: "2", request_id: "r", user_id: "lea", response_status: "no", proposed_starts_at: null, proposed_ends_at: null, note: null, responded_at: "2026-11-02T11:00:00Z" },
    ],
    assignments: [],
    // Max (no answer) declared himself available on the 11th
    availabilityEntries: (["morning", "afternoon", "evening"] as const).map((slot) => ({ user_id: "max", date: "2026-11-11", slot, status: "available" as const })),
    availabilityRules: [],
    ...over,
  };
}

describe("planning inputs", () => {
  it("only an open, shareable need of my dog with a 'Oui' can be planned", () => {
    const s = snapshot();
    const [v] = buildRequestViews(s, NOW);
    expect(canPlan(v, NOW)).toBe(true);
    expect(canPlan(buildRequestViews({ ...s, me: "emma" }, NOW)[0], NOW)).toBe(false);
    expect(canPlan(buildRequestViews({ ...s, requests: [{ ...s.requests[0], splittable: false }] }, NOW)[0], NOW)).toBe(false);
    expect(canPlan(buildRequestViews({ ...s, responses: [] }, NOW)[0], NOW)).toBe(false);
  });

  it("builds offers (minus other gardes), the dog's rules and what is taken", () => {
    const s = snapshot();
    const [v] = buildRequestViews(s, NOW);
    const offers = planOffers(v, s, [{ assigned_user_id: "emma", starts_at: iso(at(9, "12:00")), ends_at: iso(at(9, "13:00")) }]);
    expect(offers).toEqual([
      {
        userId: "emma",
        name: "Emma",
        offer: { start: at(9, "09:00"), end: at(10, "12:00") },
        busy: [{ start: at(9, "12:00"), end: at(9, "13:00") }],
        respondedAt: "2026-11-02T10:00:00Z",
        maxNights: null,
        place: "helper",
      },
    ]);
    // their garde preferences go with the offer
    const [withPref] = planOffers(v, s, [], [{ user_id: "emma", place: "owner", max_nights: 1 }]);
    expect(withPref).toMatchObject({ maxNights: 1, place: "owner" });
    // an accepted proposal limits the offer to its parts, at its place
    const part = { starts_at: iso(at(9, "18:00")), ends_at: iso(at(10, "09:00")) };
    const [fromProposal] = planOffers(v, s, [], [], [{ user_id: "emma", place: "helper", slices: [part] }]);
    expect(fromProposal).toMatchObject({ offer: [{ start: at(9, "18:00"), end: at(10, "09:00") }], place: "helper" });
    expect(planRules(v.dog)).toEqual({ maxConsecutiveNights: 2, minSliceMs: 4 * 3_600_000 });
    expect(planRules(undefined)).toEqual({ maxConsecutiveNights: 3, minSliceMs: 3 * 3_600_000 });
    expect(takenIntervals(v)).toEqual([]);
  });

  it("suggests members who did not answer but are available for a hole", () => {
    const s = snapshot();
    const [v] = buildRequestViews(s, NOW);
    const plan = proposePlan({ period: v.period, taken: [], offers: planOffers(v, s, []), rules: planRules(v.dog) });
    expect(plan.holes).toHaveLength(1);
    expect(holeSuggestions(plan.holes, v, s)).toEqual({ [String(plan.holes[0].start)]: ["Max"] });
  });
});

describe("availabilityOffers", () => {
  const z = (d: string, t: string) => zonedInstant(d, t);
  // Friday 13 → Monday 16 November 2026
  const holiday = { start: z("2026-11-13", "18:00"), end: z("2026-11-16", "09:00") };
  const person = (over: Partial<PlanPerson> = {}): PlanPerson => ({ userId: "u", name: "Emma", entries: [], rules: [], busy: [], ...over });

  it("turns declared availability into pieces of the period; a one-off entry beats a habit", () => {
    const [o] = availabilityOffers(holiday, [
      person({
        // every Saturday and Sunday, all day (ISO weekdays 6 and 7)
        rules: (["morning", "afternoon", "evening", "night"] as const).flatMap((slot) => [6, 7].map((weekday) => ({ weekday, slot, status: "available" as const }))),
        // ...except this Sunday afternoon
        entries: [{ date: "2026-11-15", slot: "afternoon", status: "unavailable" }],
      }),
    ]);
    // the Friday night slot (22:00 → 06:00) is not declared: starts Saturday 06:00
    expect(o.offer).toEqual([
      { start: z("2026-11-14", "06:00"), end: z("2026-11-15", "12:00") },
      { start: z("2026-11-15", "18:00"), end: z("2026-11-16", "06:00") },
    ]);
    expect(o).toMatchObject({ maxNights: null, place: "helper", respondedAt: "" });
  });

  it("keeps the person's preferences and leaves out who has nothing available", () => {
    const allNight = { date: "2026-11-13", slot: "night" as const, status: "available" as const };
    const offers = availabilityOffers(holiday, [
      person({ userId: "a", entries: [allNight], pref: { place: "owner", maxNights: 0 } }),
      person({ userId: "b" }),
      person({ userId: "c", entries: [{ ...allNight, status: "unavailable" }] }),
    ]);
    expect(offers.map((o) => [o.userId, o.place, o.maxNights])).toEqual([["a", "owner", 0]]);
    expect(offers[0].offer).toEqual([{ start: z("2026-11-13", "22:00"), end: z("2026-11-14", "06:00") }]);
  });
});
