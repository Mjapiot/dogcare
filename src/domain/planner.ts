/**
 * Planning engine: proposes how to split what is left of a request among the
 * people who said "Oui", for the owner to validate. Pure and deterministic.
 *
 * Rules, in order:
 * 1. only someone whose "Oui" (minus their other gardes) covers a slice gets it;
 * 2. no one gets more consecutive nights than the owner allows (hard rule);
 * 3. cover as much time as possible, with as few handoffs as possible
 *    (greedy "farthest reach", optimal for the number of slices);
 * 4. ties: the person with the least time so far, then who answered first;
 * 5. slices shorter than the minimum are absorbed by a neighbour when they can be.
 */
import { intersect, mergeIntervals, subtractIntervals, type Interval } from "./intervals";
import { addDays, toLocalDate, zonedInstant } from "./time";

export type PlanOffer = {
  userId: string;
  name: string;
  /** What their "Oui" covers (whole request or part of it). */
  offer: Interval;
  /** Their other live gardes at that time (conflicts). */
  busy: readonly Interval[];
  respondedAt: string;
};

export type PlanRules = { maxConsecutiveNights: number; minSliceMs: number };

export const DEFAULT_PLAN_RULES: PlanRules = { maxConsecutiveNights: 3, minSliceMs: 3 * 3_600_000 };

export type PlanSlice = { userId: string; name: string; start: number; end: number; reason: string };
export type PlanHole = { start: number; end: number; reason: string };

export type Plan = {
  slices: PlanSlice[];
  holes: PlanHole[];
  /** Time left to organise before the plan, and how much of it the plan covers. */
  openMs: number;
  coveredMs: number;
  /** Changes of person between contiguous slices. */
  handoffs: number;
  /** Longest run of consecutive nights per person in the plan. */
  nights: Record<string, number>;
};

/** A night is identified by 01:00 in Paris (02:00 does not exist when clocks go forward). */
export function nightAnchors(period: Interval): number[] {
  const anchors: number[] = [];
  let date = addDays(toLocalDate(period.start), -1);
  for (;;) {
    const anchor = zonedInstant(addDays(date, 1), "01:00");
    if (anchor >= period.end) return anchors;
    if (anchor >= period.start) anchors.push(anchor);
    date = addDays(date, 1);
  }
}

/** Handoff after a night: 10:00 the next morning (Paris). */
function morningAfter(anchor: number): number {
  return zonedInstant(toLocalDate(anchor), "10:00");
}

/** Handoff before a night: 20:00 the evening before (Paris). */
function eveningBefore(anchor: number): number {
  return zonedInstant(addDays(toLocalDate(anchor), -1), "20:00");
}

/** Longest run of consecutive nights held by each person. */
export function consecutiveNights(slices: readonly { userId: string; start: number; end: number }[], period: Interval): Record<string, number> {
  const anchors = nightAnchors(period);
  const best: Record<string, number> = {};
  let holder: string | null = null;
  let run = 0;
  for (const a of anchors) {
    const s = slices.find((x) => x.start <= a && a < x.end);
    const who = s?.userId ?? null;
    run = who && who === holder ? run + 1 : who ? 1 : 0;
    holder = who;
    if (who) best[who] = Math.max(best[who] ?? 0, run);
  }
  return best;
}

export function countHandoffs(slices: readonly { userId: string; start: number; end: number }[]): number {
  const sorted = [...slices].sort((a, b) => a.start - b.start);
  let n = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start === sorted[i - 1].end && sorted[i].userId !== sorted[i - 1].userId) n++;
  }
  return n;
}

type Candidate = { offer: PlanOffer; reach: number; capped: boolean };

export function proposePlan(input: {
  period: Interval;
  /** Live assignments already on the request (never moved). */
  taken: readonly Interval[];
  offers: readonly PlanOffer[];
  rules?: PlanRules;
}): Plan {
  const rules = input.rules ?? DEFAULT_PLAN_RULES;
  const gaps = subtractIntervals(input.period, mergeIntervals(input.taken));
  const anchors = nightAnchors(input.period);
  const available = new Map(
    input.offers.map((o) => {
      const inside = intersect(o.offer, input.period);
      return [o.userId, inside ? subtractIntervals(inside, mergeIntervals(o.busy)) : []] as const;
    }),
  );
  const assignedMs = new Map<string, number>();
  // per person: index of the last night they hold and the current run
  const streak = new Map<string, { last: number; count: number }>();
  const slices: PlanSlice[] = [];
  const holes: PlanHole[] = [];

  const candidatesAt = (t: number, gapEnd: number): { eligible: Candidate[]; blockedByNights: string[] } => {
    const eligible: Candidate[] = [];
    const blockedByNights: string[] = [];
    for (const o of input.offers) {
      const piece = available.get(o.userId)!.find((i) => i.start <= t && t < i.end);
      if (!piece) continue;
      let reach = Math.min(piece.end, gapEnd);
      let capped = false;
      const inRange = anchors.map((a, idx) => ({ a, idx })).filter(({ a }) => a >= t && a < reach);
      if (inRange.length) {
        const s = streak.get(o.userId);
        const base = s && s.last === inRange[0].idx - 1 ? s.count : 0;
        const allowed = rules.maxConsecutiveNights - base;
        if (inRange.length > allowed) {
          capped = true;
          reach = allowed > 0 ? Math.min(reach, morningAfter(inRange[allowed - 1].a)) : Math.min(reach, eveningBefore(inRange[0].a));
        }
      }
      if (reach > t) eligible.push({ offer: o, reach, capped });
      else blockedByNights.push(o.name);
    }
    return { eligible, blockedByNights };
  };

  for (const gap of gaps) {
    let t = gap.start;
    while (t < gap.end) {
      const { eligible, blockedByNights } = candidatesAt(t, gap.end);
      if (eligible.length === 0) {
        // nobody here: the hole lasts until someone becomes available
        // ...or until the morning after the night someone had to skip (their run is then broken)
        const nextNight = anchors.find((a) => a >= t);
        const next = Math.min(
          gap.end,
          ...[...available.values()].flat().map((i) => i.start).filter((s) => s > t),
          ...(blockedByNights.length && nextNight !== undefined ? [morningAfter(nextNight)] : []),
        );
        const busyNames = input.offers
          .filter((o) => o.busy.some((b) => b.start <= t && t < b.end) && o.offer.start <= t && t < o.offer.end)
          .map((o) => o.name);
        const reason = blockedByNights.length
          ? `${blockedByNights.join(", ")} dépasserai${blockedByNights.length > 1 ? "ent" : "t"} ${rules.maxConsecutiveNights} nuit${rules.maxConsecutiveNights > 1 ? "s" : ""} d'affilée`
          : busyNames.length
            ? `${busyNames.join(", ")} ${busyNames.length > 1 ? "ont" : "a"} déjà une autre garde à ce moment-là`
            : "Personne n'a proposé ce créneau";
        holes.push({ start: t, end: next, reason });
        t = next;
        continue;
      }
      eligible.sort(
        (a, b) =>
          b.reach - a.reach ||
          (assignedMs.get(a.offer.userId) ?? 0) - (assignedMs.get(b.offer.userId) ?? 0) ||
          a.offer.respondedAt.localeCompare(b.offer.respondedAt) ||
          a.offer.userId.localeCompare(b.offer.userId),
      );
      const best = eligible[0];
      const reason =
        (eligible.length === 1 ? "Seule personne disponible à ce moment-là" : "Sa proposition va le plus loin : moins de relais") +
        (best.capped ? ` · limité à ${rules.maxConsecutiveNights} nuit${rules.maxConsecutiveNights > 1 ? "s" : ""} d'affilée` : "");
      const last = slices.at(-1);
      if (last && last.userId === best.offer.userId && last.end === t) last.end = best.reach;
      else slices.push({ userId: best.offer.userId, name: best.offer.name, start: t, end: best.reach, reason });
      assignedMs.set(best.offer.userId, (assignedMs.get(best.offer.userId) ?? 0) + (best.reach - t));
      anchors.forEach((a, idx) => {
        if (a < t || a >= best.reach) return;
        const s = streak.get(best.offer.userId);
        streak.set(best.offer.userId, { last: idx, count: s && s.last === idx - 1 ? s.count + 1 : 1 });
      });
      t = best.reach;
    }
  }

  const finalSlices = absorbShortSlices(slices, available, rules, input.period);
  const coveredMs = finalSlices.reduce((sum, s) => sum + (s.end - s.start), 0);
  return {
    slices: finalSlices,
    holes: mergeHoles(holes),
    openMs: gaps.reduce((sum, g) => sum + (g.end - g.start), 0),
    coveredMs,
    handoffs: countHandoffs(finalSlices),
    nights: consecutiveNights(finalSlices, input.period),
  };
}

/** A slice shorter than the minimum goes to a contiguous neighbour who can take it (nights rule kept). */
function absorbShortSlices(
  slices: PlanSlice[],
  available: Map<string, Interval[]>,
  rules: PlanRules,
  period: Interval,
): PlanSlice[] {
  let current = slices.map((s) => ({ ...s }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < current.length; i++) {
      const s = current[i];
      if (s.end - s.start >= rules.minSliceMs) continue;
      for (const j of [i - 1, i + 1]) {
        const n = current[j];
        if (!n || (j < i ? n.end !== s.start : n.start !== s.end)) continue;
        const canTake = available.get(n.userId)?.some((a) => a.start <= s.start && s.end <= a.end);
        if (!canTake) continue;
        const merged = current.filter((_, k) => k !== i).map((x) => (x === n ? { ...x, start: Math.min(x.start, s.start), end: Math.max(x.end, s.end) } : x));
        if ((consecutiveNights(merged, period)[n.userId] ?? 0) > rules.maxConsecutiveNights) continue;
        current = merged;
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return current;
}

function mergeHoles(holes: PlanHole[]): PlanHole[] {
  const out: PlanHole[] = [];
  for (const h of holes) {
    const last = out.at(-1);
    if (last && last.end === h.start && last.reason === h.reason) last.end = h.end;
    else out.push({ ...h });
  }
  return out;
}
