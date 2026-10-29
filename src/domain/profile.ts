/**
 * Profile: what I gave and received this year (Paris calendar year). Only
 * confirmed gardes that are over count. For me alone: no ranking.
 */
import { zonedInstant } from "./time";
import { toLocalDate } from "./time";

export type YearGarde = { assigned_user_id: string; ends_at: string; dog_id: string };

/** Start of the current year in Paris. */
export function yearStart(now: number): number {
  return zonedInstant(`${toLocalDate(now).slice(0, 4)}-01-01`, "00:00");
}

export function yearStats(gardes: readonly YearGarde[], me: string, myDogIds: readonly string[], now: number): { given: number; received: number } {
  const from = yearStart(now);
  const done = gardes.filter((g) => {
    const end = new Date(g.ends_at).getTime();
    return end >= from && end <= now;
  });
  return {
    given: done.filter((g) => g.assigned_user_id === me && !myDogIds.includes(g.dog_id)).length,
    received: done.filter((g) => g.assigned_user_id !== me && myDogIds.includes(g.dog_id)).length,
  };
}

/** "6 gardes assurées · 4 reçues pour vos chiens", or null when there is nothing yet. */
export function yearStatsLabel(stats: { given: number; received: number }): string | null {
  if (!stats.given && !stats.received) return null;
  const parts = [
    stats.given ? `${stats.given} garde${stats.given > 1 ? "s" : ""} assurée${stats.given > 1 ? "s" : ""}` : null,
    stats.received ? `${stats.received} reçue${stats.received > 1 ? "s" : ""} pour vos chiens` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
