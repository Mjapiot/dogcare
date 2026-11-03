/**
 * Keeping several dogs at once: a person who already keeps a dog can take
 * another one, unless one of them must be kept alone, or they would keep more
 * dogs than their own limit. Pure.
 */
import { intersect, mergeIntervals, toInterval, type Interval } from "./intervals";

/** A person's limit when they did not say otherwise. */
export const DEFAULT_MAX_DOGS = 2;

/** Choices offered in the profile (null = no limit). */
export const MAX_DOGS_CHOICES = [1, 2, 3, null] as const;

export function maxDogsLabel(max: number | null): string {
  return max === null ? "Sans limite" : `${max} chien${max > 1 ? "s" : ""}`;
}

/** Another garde of the person: its dog must be kept alone, or not, or we cannot see it (null). */
export type OtherGarde = Interval & { aloneOnly: boolean | null };

/**
 * When the person cannot take `take.count` more dogs during `period`:
 * - a dog kept alone (taken or already kept) conflicts with any other garde;
 * - a garde whose dog we cannot see counts as a conflict (by caution);
 * - otherwise, where they would keep more dogs than their limit.
 */
export function cumulBusy(
  period: Interval,
  gardes: readonly OtherGarde[],
  take: { count: number; aloneOnly: boolean },
  maxDogs: number | null,
): Interval[] {
  const inside = gardes.flatMap((g) => {
    const i = intersect(g, period);
    return i ? [{ ...i, aloneOnly: g.aloneOnly }] : [];
  });
  const limit = maxDogs ?? Number.POSITIVE_INFINITY;
  if (take.count > limit) return [period];
  if (take.aloneOnly) return mergeIntervals(inside);

  const conflicts: Interval[] = inside.filter((g) => g.aloneOnly !== false);
  // the others add up: busy wherever they and the dogs taken exceed the limit
  const shared = inside.filter((g) => g.aloneOnly === false);
  const cuts = [...new Set(shared.flatMap((g) => [g.start, g.end]))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const piece = { start: cuts[i], end: cuts[i + 1] };
    const kept = shared.filter((g) => g.start <= piece.start && piece.end <= g.end).length;
    if (kept + take.count > limit) conflicts.push(piece);
  }
  return mergeIntervals(conflicts);
}

/** The rows the planning engine reads as "busy", from each person's other gardes. */
export function cumulBusyRows(
  period: Interval,
  gardes: ReadonlyArray<{ assigned_user_id: string; starts_at: string; ends_at: string; alone_only: boolean | null }>,
  take: { count: number; aloneOnly: boolean },
  maxDogs: Readonly<Record<string, number | null | undefined>>,
): Array<{ assigned_user_id: string; starts_at: string; ends_at: string }> {
  const users = [...new Set(gardes.map((g) => g.assigned_user_id))];
  return users.flatMap((userId) => {
    const own = gardes.filter((g) => g.assigned_user_id === userId).map((g) => ({ ...toInterval(g.starts_at, g.ends_at), aloneOnly: g.alone_only }));
    const max = maxDogs[userId] === undefined ? DEFAULT_MAX_DOGS : maxDogs[userId]!;
    return cumulBusy(period, own, take, max).map((i) => ({
      assigned_user_id: userId,
      starts_at: new Date(i.start).toISOString(),
      ends_at: new Date(i.end).toISOString(),
    }));
  });
}
