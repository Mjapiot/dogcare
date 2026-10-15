import { APP_TIME_ZONE, type SlotKey } from "./config";
import { intersect, mergeIntervals, type Interval } from "./intervals";
import { isoWeekday, slotInstancesOverlapping, type LocalDate } from "./time";

/** What a member declared for a slot. Absence of declaration = "unknown". */
export type DeclaredStatus = "available" | "unavailable";
export type SlotStatus = DeclaredStatus | "unknown";

/** One-off declaration for a given date and slot (wins over rules). */
export type AvailabilityEntry = { date: LocalDate; slot: SlotKey; status: DeclaredStatus };

/** Weekly habit: e.g. "available every Wednesday afternoon". */
export type AvailabilityRule = { weekday: number; slot: SlotKey; status: DeclaredStatus };

export type SlotResolution = { status: SlotStatus; source: "entry" | "rule" | "none" };

/**
 * Resolves the effective status of one slot. A one-off entry always wins over
 * a weekly rule, so a rule can never silently override a manual change.
 */
export function resolveSlot(
  date: LocalDate,
  slot: SlotKey,
  entries: readonly AvailabilityEntry[],
  rules: readonly AvailabilityRule[],
): SlotResolution {
  const entry = entries.find((e) => e.date === date && e.slot === slot);
  if (entry) return { status: entry.status, source: "entry" };
  const weekday = isoWeekday(date);
  const rule = rules.find((r) => r.weekday === weekday && r.slot === slot);
  if (rule) return { status: rule.status, source: "rule" };
  return { status: "unknown", source: "none" };
}

/**
 * Availability of a member for a precise period:
 * - available: every slot touched by the period is declared available
 * - partial: some parts available, others not → "À vérifier"
 * - unavailable: every slot touched is declared unavailable
 * - unknown: nothing declared available, at least one part not declared
 */
export type PeriodAvailability = "available" | "partial" | "unavailable" | "unknown";

export type PeriodAvailabilityResult = {
  status: PeriodAvailability;
  availableParts: Interval[];
  unavailableParts: Interval[];
  unknownParts: Interval[];
};

export function evaluatePeriodAvailability(
  period: Interval,
  entries: readonly AvailabilityEntry[],
  rules: readonly AvailabilityRule[],
  timeZone = APP_TIME_ZONE,
): PeriodAvailabilityResult {
  const parts: Record<SlotStatus, Interval[]> = { available: [], unavailable: [], unknown: [] };
  for (const instance of slotInstancesOverlapping(period, timeZone)) {
    const clipped = intersect(instance.interval, period);
    if (!clipped) continue;
    const { status } = resolveSlot(instance.date, instance.slot, entries, rules);
    parts[status].push(clipped);
  }
  const availableParts = mergeIntervals(parts.available);
  const unavailableParts = mergeIntervals(parts.unavailable);
  const unknownParts = mergeIntervals(parts.unknown);

  let status: PeriodAvailability;
  if (availableParts.length > 0) {
    status = unavailableParts.length === 0 && unknownParts.length === 0 ? "available" : "partial";
  } else if (unknownParts.length === 0 && unavailableParts.length > 0) {
    status = "unavailable";
  } else {
    status = "unknown";
  }
  return { status, availableParts, unavailableParts, unknownParts };
}

export const PERIOD_AVAILABILITY_LABELS: Record<PeriodAvailability, string> = {
  available: "Potentiellement disponible",
  partial: "À vérifier",
  unavailable: "Indisponible",
  unknown: "Disponibilité inconnue",
};
