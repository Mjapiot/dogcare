/**
 * "Planifier une absence": from what the people around the dogs declared, the
 * engine proposes who keeps each dog when; the owner sends each person their
 * part. Several dogs are kept together when possible: first a plan for all of
 * them, then each dog alone for what is left. A dog kept alone is planned
 * apart, never with another dog at the same time. Holes come with who else to
 * ask (circle people: pros first). Pure.
 */
import { mergeIntervals, type Interval } from "./intervals";
import { availableIntervals, type AvailabilityEntry, type AvailabilityRule } from "./availability";
import { cumulBusy, type OtherGarde } from "./cumul";
import { consecutiveNights, countHandoffs, mergeContiguous, proposePlan, type Plan, type PlanOffer, type PlanRules, type PlanSlice } from "./planner";

export type CircleCandidate = {
  userId: string;
  name: string;
  role: "close" | "guest" | "pro";
  /** A guest's access dates (null for close people and pros). */
  startsAt: number | null;
  endsAt: number | null;
};

type Place = "helper" | "owner";

export type AbsenceDog = {
  id: string;
  name: string;
  /** Never kept with another dog at the same time. */
  aloneOnly: boolean;
  rules: PlanRules;
  /** The dog's circle people who could be asked for a hole. */
  candidates: readonly CircleCandidate[];
};

/** Someone around the dogs: what they declared, their other gardes, how they keep each dog. */
export type AbsencePerson = {
  userId: string;
  name: string;
  entries: readonly AvailabilityEntry[];
  rules: readonly AvailabilityRule[];
  gardes: readonly OtherGarde[];
  /** Dogs they keep at once (null = no limit). */
  maxDogs: number | null;
  /** They have a dog of their own: a dog kept alone only goes to them at its owner's. */
  ownsDog: boolean;
  /** Their preferences for each dog (place, nights). */
  prefs: Readonly<Record<string, { place: Place; maxNights: number | null } | undefined>>;
};

export type DogPlan = {
  dogId: string;
  name: string;
  plan: Plan;
  /** For each hole (keyed by its start), circle people who could take it, pros first. */
  holeCandidates: Record<string, CircleCandidate[]>;
};

export type PersonPart = { dogId: string; place: Place; slices: Interval[] };

export type PersonProposal = { userId: string; name: string; parts: PersonPart[] };

export type AbsencePlan = {
  dogs: DogPlan[];
  /** One proposal per person: their part for each dog, in order. */
  proposals: PersonProposal[];
  /** When the dogs that could be together are not with the same person. */
  separated: Interval[];
  /** People left out by the owner ("modifier la répartition"). */
  skipped: string[];
};

const ROLE_ORDER: Record<CircleCandidate["role"], number> = { pro: 0, close: 1, guest: 2 };

/** The strictest rules of several dogs. */
function jointRules(dogs: readonly AbsenceDog[]): PlanRules {
  return {
    maxConsecutiveNights: Math.min(...dogs.map((d) => d.rules.maxConsecutiveNights)),
    minSliceMs: Math.max(...dogs.map((d) => d.rules.minSliceMs)),
  };
}

function holeCandidatesFor(plan: Plan, candidates: readonly CircleCandidate[]): Record<string, CircleCandidate[]> {
  const out: Record<string, CircleCandidate[]> = {};
  for (const hole of plan.holes) {
    const fit = candidates
      .filter((c) => c.role !== "guest" || (c.startsAt !== null && c.endsAt !== null && c.startsAt <= hole.start && hole.end <= c.endsAt))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "fr"));
    if (fit.length) out[String(hole.start)] = fit;
  }
  return out;
}

const NOBODY = "Personne n'a proposé ce créneau";

export function planAbsence(input: {
  period: Interval;
  dogs: readonly AbsenceDog[];
  people: readonly AbsencePerson[];
  skip?: readonly string[];
}): AbsencePlan {
  const { period } = input;
  const skip = new Set(input.skip ?? []);
  const people = input.people.filter((p) => !skip.has(p.userId));
  // parts already given in this absence: they count as gardes for the dogs planned next
  const given = new Map<string, OtherGarde[]>();
  const give = (slices: readonly PlanSlice[], aloneOnly: boolean) => {
    for (const s of slices) given.set(s.userId, [...(given.get(s.userId) ?? []), { start: s.start, end: s.end, aloneOnly }]);
  };

  const offersFor = (dogs: readonly AbsenceDog[]): PlanOffer[] =>
    people.flatMap((p) => {
      const aloneOnly = dogs.some((d) => d.aloneOnly);
      const prefs = dogs.map((d) => p.prefs[d.id]);
      // all at the owner's only when that is their preference for every dog
      const place: Place = prefs.every((x) => x?.place === "owner") ? "owner" : "helper";
      if (aloneOnly && p.ownsDog && place !== "owner") return [];
      const offer = availableIntervals(period, p.entries, p.rules);
      if (!offer.length) return [];
      const nights = prefs.map((x) => x?.maxNights).filter((n): n is number => n !== null && n !== undefined);
      return [
        {
          userId: p.userId,
          name: p.name,
          offer,
          busy: cumulBusy(period, [...p.gardes, ...(given.get(p.userId) ?? [])], { count: dogs.length, aloneOnly }, p.maxDogs),
          respondedAt: "",
          maxNights: nights.length ? Math.min(...nights) : null,
          place,
        },
      ];
    });

  const plans = new Map<string, Plan>();
  const together = input.dogs.filter((d) => !d.aloneOnly);
  if (together.length >= 2) {
    // all together first, then each dog for what is left
    const joint = proposePlan({ period, taken: [], offers: offersFor(together), rules: jointRules(together) });
    // each dog of the joint plan is one more dog kept by that person
    together.forEach(() => give(joint.slices, false));
    for (const dog of together) {
      const rest = proposePlan({ period, taken: joint.slices, offers: offersFor([dog]), rules: dog.rules });
      give(rest.slices, false);
      const slices = mergeContiguous([...joint.slices, ...rest.slices]);
      plans.set(dog.id, {
        slices,
        holes: rest.holes,
        openMs: joint.openMs,
        coveredMs: slices.reduce((sum, s) => sum + (s.end - s.start), 0),
        handoffs: countHandoffs(slices),
        nights: consecutiveNights(slices, period),
      });
    }
  } else {
    for (const dog of together) {
      const plan = proposePlan({ period, taken: [], offers: offersFor([dog]), rules: dog.rules });
      give(plan.slices, false);
      plans.set(dog.id, plan);
    }
  }
  // a dog kept alone last: nobody keeping another dog of this absence then
  for (const dog of input.dogs.filter((d) => d.aloneOnly)) {
    const plan = proposePlan({ period, taken: [], offers: offersFor([dog]), rules: dog.rules });
    give(plan.slices, true);
    plans.set(dog.id, plan);
  }

  const dogs: DogPlan[] = input.dogs.map((dog) => {
    const raw = plans.get(dog.id)!;
    // here nobody "proposed": the engine read what people declared
    const plan = { ...raw, holes: raw.holes.map((h) => (h.reason === NOBODY ? { ...h, reason: "Personne n'a déclaré de dispo sur ce créneau" } : h)) };
    return { dogId: dog.id, name: dog.name, plan, holeCandidates: holeCandidatesFor(plan, dog.candidates) };
  });

  const byUser = new Map<string, PersonProposal>();
  for (const d of dogs) {
    for (const s of d.plan.slices) {
      const p = byUser.get(s.userId) ?? { userId: s.userId, name: s.name, parts: [] };
      const part = p.parts.find((x) => x.dogId === d.dogId);
      if (part) part.slices.push({ start: s.start, end: s.end });
      else p.parts.push({ dogId: d.dogId, place: s.place ?? "helper", slices: [{ start: s.start, end: s.end }] });
      byUser.set(s.userId, p);
    }
  }
  const first = (p: PersonProposal) => Math.min(...p.parts.flatMap((x) => x.slices.map((s) => s.start)));
  const proposals = [...byUser.values()].sort((a, b) => first(a) - first(b));

  return {
    dogs,
    proposals,
    separated: separatedIntervals(dogs.filter((d) => together.some((t) => t.id === d.dogId))),
    skipped: input.people.filter((p) => skip.has(p.userId)).map((p) => p.userId),
  };
}

/** When dogs that could be together are not all with the same person (several dogs only). */
export function separatedIntervals(dogs: readonly Pick<DogPlan, "plan">[]): Interval[] {
  if (dogs.length < 2) return [];
  const cuts = [...new Set(dogs.flatMap((d) => [...d.plan.slices, ...d.plan.holes].flatMap((x) => [x.start, x.end])))].sort((a, b) => a - b);
  const holderAt = (d: Pick<DogPlan, "plan">, t: number) => d.plan.slices.find((s) => s.start <= t && t < s.end)?.userId ?? null;
  const out: Interval[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const holders = dogs.map((d) => holderAt(d, cuts[i]));
    // all with the same person, or all without anyone: not separated
    if (holders.some((h) => h !== holders[0]) && holders.some((h) => h !== null)) out.push({ start: cuts[i], end: cuts[i + 1] });
  }
  return mergeIntervals(out);
}

/**
 * The part of a hole a circle person is asked for: the whole hole, or, with
 * their own limit of consecutive nights (a rule of this absence), only what
 * fits it (the rest stays a hole).
 */
export function holePartFor(hole: Interval, person: { userId: string; name: string; maxNights: number | null }, rules: PlanRules): Interval[] {
  if (person.maxNights === null) return [hole];
  const plan = proposePlan({
    period: hole,
    taken: [],
    offers: [{ userId: person.userId, name: person.name, offer: hole, busy: [], respondedAt: "", maxNights: person.maxNights }],
    rules,
  });
  return plan.slices.map((s) => ({ start: s.start, end: s.end }));
}

type IncomingRow = {
  id: string;
  request_id: string;
  absenceId: string | null;
  dogName: string;
  place: Place;
  slices: ReadonlyArray<{ starts_at: string; ends_at: string }>;
  starts_at: string;
};

/** Proposals waiting for my answer: those of one absence of several dogs make one card (one answer). */
export type IncomingGroup = {
  /** The proposal answered (the database answers the others of the absence with it). */
  id: string;
  requestIds: string[];
  parts: Array<{ dogName: string; place: Place; slices: ReadonlyArray<{ starts_at: string; ends_at: string }> }>;
};

export function groupProposals(list: readonly IncomingRow[]): IncomingGroup[] {
  const groups = new Map<string, IncomingGroup>();
  for (const p of [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.dogName.localeCompare(b.dogName, "fr"))) {
    const key = p.absenceId ?? p.id;
    const g = groups.get(key) ?? { id: p.id, requestIds: [], parts: [] };
    g.requestIds.push(p.request_id);
    g.parts.push({ dogName: p.dogName, place: p.place, slices: p.slices });
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, parts: [...g.parts].sort((a, b) => a.dogName.localeCompare(b.dogName, "fr")) }));
}
