/**
 * "Planifier une absence": from what the people around the dog declared, the
 * engine proposes who keeps the dog when; the owner sends each person their
 * part. Holes come with who else to ask (circle people: pros first). Pure.
 */
import type { Interval } from "./intervals";
import { availabilityOffers, type PlanPerson } from "./plan-inputs";
import { proposePlan, type Plan, type PlanRules } from "./planner";

export type CircleCandidate = {
  userId: string;
  name: string;
  role: "close" | "guest" | "pro";
  /** A guest's access dates (null for close people and pros). */
  startsAt: number | null;
  endsAt: number | null;
};

export type PersonProposal = { userId: string; name: string; place: "helper" | "owner"; slices: Interval[] };

export type AbsencePlan = {
  plan: Plan;
  /** One proposal per person, their slices in order. */
  proposals: PersonProposal[];
  /** For each hole (keyed by its start), circle people who could take it, pros first. */
  holeCandidates: Record<string, CircleCandidate[]>;
  /** People left out by the owner ("modifier la répartition"). */
  skipped: string[];
};

const NOBODY = "Personne n'a proposé ce créneau";

const ROLE_ORDER: Record<CircleCandidate["role"], number> = { pro: 0, close: 1, guest: 2 };

export function planAbsence(input: {
  period: Interval;
  people: readonly PlanPerson[];
  rules: PlanRules;
  candidates: readonly CircleCandidate[];
  skip?: readonly string[];
}): AbsencePlan {
  const skip = new Set(input.skip ?? []);
  const offers = availabilityOffers(input.period, input.people.filter((p) => !skip.has(p.userId)));
  const proposed = proposePlan({ period: input.period, taken: [], offers, rules: input.rules });
  // here nobody "proposed": the engine read what people declared
  const plan = {
    ...proposed,
    holes: proposed.holes.map((h) => (h.reason === NOBODY ? { ...h, reason: "Personne n'a déclaré de dispo sur ce créneau" } : h)),
  };

  const byUser = new Map<string, PersonProposal>();
  for (const s of plan.slices) {
    const p = byUser.get(s.userId) ?? { userId: s.userId, name: s.name, place: s.place ?? "helper", slices: [] };
    p.slices.push({ start: s.start, end: s.end });
    byUser.set(s.userId, p);
  }
  const proposals = [...byUser.values()].sort((a, b) => a.slices[0].start - b.slices[0].start);

  const holeCandidates: Record<string, CircleCandidate[]> = {};
  for (const hole of plan.holes) {
    const fit = input.candidates
      .filter((c) => c.role !== "guest" || (c.startsAt !== null && c.endsAt !== null && c.startsAt <= hole.start && hole.end <= c.endsAt))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "fr"));
    if (fit.length) holeCandidates[String(hole.start)] = fit;
  }

  return { plan, proposals, holeCandidates, skipped: input.people.filter((p) => skip.has(p.userId)).map((p) => p.userId) };
}
