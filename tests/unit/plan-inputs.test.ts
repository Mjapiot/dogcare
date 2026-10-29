import { describe, expect, it } from "vitest";
import { canPlan, holeSuggestions, planOffers, planRules, takenIntervals } from "@/domain/plan-inputs";
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
      },
    ]);
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
