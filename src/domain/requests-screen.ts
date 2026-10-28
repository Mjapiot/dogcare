/**
 * The "Demandes" screen: requests of my groups and of the circles I am in,
 * as one kind of item, sorted into "À répondre", "Déjà répondu" and "Mes
 * gardes", and grouped by how soon they start (Paris days). Pure.
 */
import type { InvitedView } from "./invited";
import { toInterval, type Interval } from "./intervals";
import type { NecessityLevel, RequestStatus, RequestType, StatusTone } from "./status";
import { addDays, todayLocal, toLocalDate } from "./time";
import { needsMyAnswer, type RequestView } from "./views";
import type { AssignmentStatus } from "@/lib/types";

export type MyAssignment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AssignmentStatus;
  previous_starts_at: string | null;
  previous_ends_at: string | null;
};

export type ScreenItem = {
  key: string;
  source: "group" | "circle";
  requestId: string;
  href: string;
  dogId: string;
  dogName: string;
  requestType: RequestType;
  necessity: NecessityLevel;
  period: Interval;
  ownerNames: string[];
  description: string | null;
  splittable: boolean;
  tone: StatusTone;
  label: string;
  /** Detailed status for group requests (icon), null for circle ones. */
  status: RequestStatus | null;
  myResponse: { status: "yes" | "no"; proposed: Interval | null } | null;
  myAssignments: MyAssignment[];
  needsMyAnswer: boolean;
  /** Still ahead and open: an answer can be given or changed. */
  answerable: boolean;
};

export function fromGroupView(v: RequestView, now: number): ScreenItem {
  const r = v.myResponse;
  return {
    key: `g-${v.request.id}`,
    source: "group",
    requestId: v.request.id,
    href: `/requests/${v.request.id}`,
    dogId: v.request.dog_id,
    dogName: v.dog?.name ?? "Chien",
    requestType: v.request.request_type,
    necessity: v.request.necessity,
    period: v.period,
    ownerNames: v.ownerNames,
    description: v.request.description,
    splittable: v.request.splittable,
    tone: v.status.tone,
    label: v.label,
    status: v.status.status,
    myResponse: r
      ? { status: r.response_status, proposed: r.proposed_starts_at && r.proposed_ends_at ? toInterval(r.proposed_starts_at, r.proposed_ends_at) : null }
      : null,
    myAssignments: v.myAssignments,
    needsMyAnswer: needsMyAnswer(v),
    answerable:
      v.request.lifecycle_status === "active" && v.request.necessity !== "info" && v.iAmEligible && v.period.end > now,
  };
}

export function fromInvitedView(v: InvitedView): ScreenItem {
  const r = v.request.my_response;
  return {
    key: `c-${v.request.id}`,
    source: "circle",
    requestId: v.request.id,
    href: `/circle/requests/${v.request.id}`,
    dogId: v.request.dog_id,
    dogName: v.request.dog_name,
    requestType: v.request.request_type,
    necessity: v.request.necessity,
    period: v.period,
    ownerNames: v.request.owner_names,
    description: v.request.description,
    splittable: v.request.splittable,
    tone: v.tone,
    label: v.label,
    status: null,
    myResponse: r
      ? { status: r.response_status, proposed: r.proposed_starts_at && r.proposed_ends_at ? toInterval(r.proposed_starts_at, r.proposed_ends_at) : null }
      : null,
    myAssignments: v.request.my_assignments,
    needsMyAnswer: v.needsMyAnswer,
    answerable: !v.cancelled && !v.isPast && v.request.necessity !== "info",
  };
}

export type ScreenLists = { todo: ScreenItem[]; answered: ScreenItem[]; guards: ScreenItem[] };

/** Splits items into the screen's lists, each sorted by start. */
export function splitScreenItems(items: readonly ScreenItem[], now: number): ScreenLists {
  const byStart = [...items].sort((a, b) => a.period.start - b.period.start);
  const guards = byStart
    .filter((i) => i.myAssignments.length > 0 && i.period.end > now)
    .sort((a, b) => guardRank(a, now) - guardRank(b, now) || a.period.start - b.period.start);
  return {
    todo: byStart.filter((i) => i.needsMyAnswer),
    answered: byStart.filter((i) => i.answerable && i.myResponse && i.myAssignments.length === 0),
    guards,
  };
}

/** Reconfirmations first, then the garde happening now, then the next ones. */
function guardRank(i: ScreenItem, now: number): number {
  if (i.myAssignments.some((a) => a.status === "pending_reconfirmation")) return 0;
  const ongoing = i.myAssignments.some(
    (a) => a.status === "confirmed" && new Date(a.starts_at).getTime() <= now && now < new Date(a.ends_at).getTime(),
  );
  return ongoing ? 1 : 2;
}

export type Horizon = "today" | "tomorrow" | "week" | "later";

export const HORIZON_LABELS: Record<Horizon, string> = {
  today: "Aujourd'hui",
  tomorrow: "Demain",
  week: "Cette semaine",
  later: "Plus tard",
};

/** When an item starts, in Paris days; one that already started counts as today. */
export function horizonOf(period: Interval, now: number): Horizon {
  const today = todayLocal(now);
  const day = period.start <= now ? today : toLocalDate(period.start);
  if (day <= today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  if (day <= addDays(today, 6)) return "week";
  return "later";
}

/** Consecutive groups in display order (items are expected sorted by start). */
export function groupByHorizon<T extends { period: Interval }>(items: readonly T[], now: number): Array<{ horizon: Horizon; items: T[] }> {
  const order: Horizon[] = ["today", "tomorrow", "week", "later"];
  return order
    .map((horizon) => ({ horizon, items: items.filter((i) => horizonOf(i.period, now) === horizon) }))
    .filter((g) => g.items.length > 0);
}

/** "2 oui · 1 non · 3 sans réponse" for the owner's cards. */
export function responsesSummary(counts: { yes: number; no: number; pending: number }): string {
  const parts = [
    counts.yes ? `${counts.yes} oui` : null,
    counts.no ? `${counts.no} non` : null,
    counts.pending ? `${counts.pending} sans réponse` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Personne à solliciter";
}
