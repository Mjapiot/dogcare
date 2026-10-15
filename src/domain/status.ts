import type { PeriodAvailability } from "./availability";
import type { CoverageResult } from "./coverage";
import { overlaps, type Interval } from "./intervals";

export type RequestType = "alone_info" | "visit" | "care" | "partial_care";
export type NecessityLevel = "info" | "nice_to_have" | "required";
export type LifecycleStatus = "active" | "cancelled";
export type ResponseStatus = "yes" | "no";

/** Computed coverage status. Distinct from the stored lifecycle status. */
export type RequestStatus =
  | "informational"
  | "awaiting_responses"
  | "potential_helpers"
  | "volunteer_found"
  | "partially_covered"
  | "confirmed"
  | "uncovered"
  | "cancelled";

/** Visual tone used by the calendar. Never conveyed by color alone. */
export type StatusTone = "covered" | "pending" | "uncovered" | "partial" | "info" | "muted" | "none";

export type ResponseInput = {
  userId: string;
  status: ResponseStatus;
  /** Optional sub-period offered by the helper; null = the whole request. */
  proposed: Interval | null;
};

export type StatusInput = {
  period: Interval;
  necessity: NecessityLevel;
  lifecycle: LifecycleStatus;
  coverage: CoverageResult;
  /** Members allowed to help: group members minus the dog's caretakers. */
  eligibleUserIds: readonly string[];
  responses: readonly ResponseInput[];
  /** Declared availability of eligible members for the period. */
  availability: ReadonlyMap<string, PeriodAvailability>;
  now: number;
};

export type StatusResult = {
  status: RequestStatus;
  tone: StatusTone;
  isPast: boolean;
  counts: {
    eligible: number;
    yes: number;
    no: number;
    pending: number;
    /** Members who have not answered but declared some availability. */
    pendingPotentiallyAvailable: number;
  };
  /** Eligible members who said yes, whose offer overlaps an uncovered gap. */
  volunteersForGaps: string[];
};

export function computeRequestStatus(input: StatusInput): StatusResult {
  const eligible = new Set(input.eligibleUserIds);
  const responses = input.responses.filter((r) => eligible.has(r.userId));
  const answered = new Set(responses.map((r) => r.userId));
  const yes = responses.filter((r) => r.status === "yes");
  const no = responses.filter((r) => r.status === "no");
  const pendingIds = [...eligible].filter((id) => !answered.has(id));
  const pendingPotentiallyAvailable = pendingIds.filter((id) => {
    const a = input.availability.get(id);
    return a === "available" || a === "partial";
  }).length;

  const gaps = input.coverage.gaps;
  const volunteersForGaps = yes
    .filter((r) => gaps.some((g) => overlaps(r.proposed ?? input.period, g)))
    .map((r) => r.userId);

  const counts = {
    eligible: eligible.size,
    yes: yes.length,
    no: no.length,
    pending: pendingIds.length,
    pendingPotentiallyAvailable,
  };
  const isPast = input.now >= input.period.end;

  let status: RequestStatus;
  if (input.lifecycle === "cancelled") status = "cancelled";
  else if (input.necessity === "info") status = "informational";
  else if (input.coverage.state === "full") status = "confirmed";
  else if (input.coverage.state === "partial") status = "partially_covered";
  else if (volunteersForGaps.length > 0) status = "volunteer_found";
  // Only explicit refusals count: silence is never a "no".
  else if (pendingIds.length === 0) status = "uncovered";
  else if (pendingPotentiallyAvailable > 0) status = "potential_helpers";
  else status = "awaiting_responses";

  return { status, tone: statusTone(status, input.necessity), isPast, counts, volunteersForGaps };
}

export function statusTone(status: RequestStatus, necessity: NecessityLevel): StatusTone {
  switch (status) {
    case "confirmed":
      return "covered";
    case "informational":
      return "info";
    case "cancelled":
      return "none";
    case "uncovered":
      return necessity === "required" ? "uncovered" : "muted";
    case "partially_covered":
      return necessity === "required" ? "partial" : "pending";
    default:
      return "pending";
  }
}

const TONE_PRIORITY: StatusTone[] = ["uncovered", "partial", "pending", "covered", "info", "muted", "none"];

/** The most urgent tone of a day drives the color of its card. */
export function dayTone(tones: readonly StatusTone[]): StatusTone {
  for (const tone of TONE_PRIORITY) if (tones.includes(tone)) return tone;
  return "none";
}

/** Statuses that still need someone to act ("À organiser"). */
export function needsOrganizing(status: RequestStatus): boolean {
  return (
    status === "awaiting_responses" ||
    status === "potential_helpers" ||
    status === "volunteer_found" ||
    status === "partially_covered" ||
    status === "uncovered"
  );
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  informational: "Information",
  awaiting_responses: "En attente de réponses",
  potential_helpers: "Aides potentielles",
  volunteer_found: "Volontaire à confirmer",
  partially_covered: "Partiellement couvert",
  confirmed: "Couvert",
  uncovered: "Sans solution",
  cancelled: "Annulée",
};

export function statusLabel(status: RequestStatus, necessity: NecessityLevel): string {
  if (status === "uncovered" && necessity !== "required") return "Personne de disponible";
  return STATUS_LABELS[status];
}

export const TONE_LABELS: Record<StatusTone, string> = {
  covered: "Couvert",
  pending: "À organiser",
  uncovered: "Sans solution",
  partial: "Partiellement couvert",
  info: "Information",
  muted: "Sans réponse positive",
  none: "Aucun besoin",
};

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  alone_info: "Chien seul",
  visit: "Visite ou promenade",
  care: "Garde",
  partial_care: "Garde partielle",
};

export const NECESSITY_LABELS: Record<NecessityLevel, string> = {
  info: "Information",
  nice_to_have: "Souhaitable",
  required: "Indispensable",
};

export function defaultNecessity(type: RequestType): NecessityLevel {
  if (type === "alone_info") return "info";
  if (type === "visit") return "nice_to_have";
  return "required";
}
