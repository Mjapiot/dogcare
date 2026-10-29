/**
 * Builds the planning engine's inputs from a request view, and who to ask
 * for the holes it leaves. Pure.
 */
import { evaluatePeriodAvailability } from "./availability";
import { toInterval, type Interval } from "./intervals";
import { DEFAULT_PLAN_RULES, type PlanHole, type PlanOffer, type PlanRules } from "./planner";
import type { GroupSnapshot, RequestView } from "./views";

/** Planning makes sense for an open, shareable need with holes and at least one "Oui". */
export function canPlan(view: RequestView, now: number): boolean {
  return (
    view.iAmCaretaker &&
    view.request.lifecycle_status === "active" &&
    view.request.necessity !== "info" &&
    view.request.splittable &&
    view.period.end > now &&
    view.coverage.state !== "full" &&
    view.helpers.some((h) => h.response === "yes")
  );
}

/** The "Oui" of the request, each minus the person's other gardes at that time. */
export function planOffers(
  view: RequestView,
  snapshot: Pick<GroupSnapshot, "responses">,
  busy: ReadonlyArray<{ assigned_user_id: string; starts_at: string; ends_at: string }>,
): PlanOffer[] {
  return view.helpers
    .filter((h) => h.response === "yes")
    .map((h) => ({
      userId: h.userId,
      name: h.name,
      offer: h.proposed ?? view.period,
      busy: busy.filter((b) => b.assigned_user_id === h.userId).map((b) => toInterval(b.starts_at, b.ends_at)),
      respondedAt: snapshot.responses.find((r) => r.request_id === view.request.id && r.user_id === h.userId)?.responded_at ?? "",
    }));
}

export function planRules(dog: { plan_max_nights?: number; plan_min_slice_hours?: number } | undefined): PlanRules {
  return {
    maxConsecutiveNights: dog?.plan_max_nights ?? DEFAULT_PLAN_RULES.maxConsecutiveNights,
    minSliceMs: (dog?.plan_min_slice_hours ?? DEFAULT_PLAN_RULES.minSliceMs / 3_600_000) * 3_600_000,
  };
}

/** Live assignments already on the request (never moved by the plan). */
export function takenIntervals(view: RequestView): Interval[] {
  return view.assignments.map((a) => toInterval(a.starts_at, a.ends_at));
}

/**
 * For each hole (keyed by its start), the members who have not answered but
 * whose shared availability says they could be there (fully or partly).
 */
export function holeSuggestions(holes: readonly PlanHole[], view: RequestView, snapshot: GroupSnapshot): Record<string, string[]> {
  const pending = view.helpers.filter((h) => h.response === null && h.availability !== "hidden" && h.assignments.length === 0);
  const out: Record<string, string[]> = {};
  for (const hole of holes) {
    const names = pending
      .filter((h) => {
        const entries = snapshot.availabilityEntries.filter((e) => e.user_id === h.userId);
        const rules = snapshot.availabilityRules.filter((r) => r.user_id === h.userId);
        const status = evaluatePeriodAvailability(hole, entries, rules).status;
        return status === "available" || status === "partial";
      })
      .map((h) => h.name);
    if (names.length) out[String(hole.start)] = names;
  }
  return out;
}
