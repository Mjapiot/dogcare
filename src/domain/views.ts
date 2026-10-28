/**
 * Assembles raw rows into the view models used by screens. Pure and
 * deterministic: every status shown in the UI comes from here.
 */
import {
  evaluatePeriodAvailability,
  type AvailabilityEntry,
  type AvailabilityRule,
  type PeriodAvailability,
} from "./availability";
import { computeCoverage, type CoverageResult } from "./coverage";
import { toInterval, type Interval } from "./intervals";
import {
  computeRequestStatus,
  dayTone,
  needsOrganizing,
  statusLabel,
  type ResponseStatus,
  type StatusResult,
  type StatusTone,
} from "./status";
import { dateRange, localDatesTouched, type LocalDate } from "./time";
import type {
  AvailabilityEntryRow,
  AvailabilityRuleRow,
  CareAssignmentRow,
  CareRequestRow,
  DogCaretakerRow,
  DogRow,
  GroupMemberRow,
  RequestInviteeRow,
  RequestResponseRow,
} from "@/lib/types";

export type MemberInfo = GroupMemberRow & { display_name: string };

export type GroupSnapshot = {
  me: string;
  members: MemberInfo[];
  dogs: DogRow[];
  caretakers: DogCaretakerRow[];
  requests: CareRequestRow[];
  responses: RequestResponseRow[];
  assignments: CareAssignmentRow[];
  availabilityEntries: AvailabilityEntryRow[];
  availabilityRules: AvailabilityRuleRow[];
  /** Circle people asked on requests, outside the group. */
  invitees?: RequestInviteeRow[];
};

export type HelperLine = {
  userId: string;
  name: string;
  response: ResponseStatus | null;
  proposed: Interval | null;
  note: string | null;
  availability: PeriodAvailability | "hidden";
  /** Live (non-cancelled) assignments of this member on the request. */
  assignments: CareAssignmentRow[];
  /** Set for circle people asked outside the group. */
  circleRole: RequestInviteeRow["role"] | null;
};

export type RequestView = {
  request: CareRequestRow;
  dog: DogRow | undefined;
  period: Interval;
  ownerNames: string[];
  iAmCaretaker: boolean;
  iAmEligible: boolean;
  myResponse: RequestResponseRow | null;
  myAssignments: CareAssignmentRow[];
  coverage: CoverageResult;
  status: StatusResult;
  label: string;
  /** Live assignments with the helper's name. */
  assignments: Array<CareAssignmentRow & { name: string }>;
  helpers: HelperLine[];
};

function nameOf(members: MemberInfo[], userId: string | null, invitees: readonly RequestInviteeRow[] = []): string {
  if (!userId) return "Ancien membre";
  const m = members.find((x) => x.user_id === userId);
  const i = m ? undefined : invitees.find((x) => x.user_id === userId);
  return (m?.display_name ?? i?.display_name)?.trim() || "Un membre";
}

export function buildRequestViews(snapshot: GroupSnapshot, now: number): RequestView[] {
  const { me, members, dogs, caretakers, requests, responses, assignments } = snapshot;

  const entriesByUser = groupBy(snapshot.availabilityEntries, (e) => e.user_id);
  const rulesByUser = groupBy(snapshot.availabilityRules, (r) => r.user_id);
  const shareByUser = new Map(members.map((m) => [m.user_id, m.share_availability || m.user_id === me]));

  return requests.map((request) => {
    const period = toInterval(request.starts_at, request.ends_at);
    const dogCaretakers = caretakers.filter((c) => c.dog_id === request.dog_id).map((c) => c.user_id);
    // members of the group, plus the circle people asked on this request
    const invitees = (snapshot.invitees ?? []).filter((i) => i.request_id === request.id);
    const memberIds = members.map((m) => m.user_id);
    const eligible = [...memberIds, ...invitees.map((i) => i.user_id).filter((id) => !memberIds.includes(id))].filter(
      (id) => !dogCaretakers.includes(id),
    );
    const reqResponses = responses.filter((r) => r.request_id === request.id);
    const liveAssignments = assignments.filter((a) => a.request_id === request.id && a.status !== "cancelled");
    const confirmed = liveAssignments.filter((a) => a.status === "confirmed").map((a) => toInterval(a.starts_at, a.ends_at));
    const coverage = computeCoverage(period, confirmed);

    const availability = new Map<string, PeriodAvailability>();
    for (const userId of eligible) {
      if (!shareByUser.get(userId)) continue;
      const entries: AvailabilityEntry[] = (entriesByUser.get(userId) ?? []).map((e) => ({
        date: e.date,
        slot: e.slot,
        status: e.status,
      }));
      const rules: AvailabilityRule[] = (rulesByUser.get(userId) ?? []).map((r) => ({
        weekday: r.weekday,
        slot: r.slot,
        status: r.status,
      }));
      availability.set(userId, evaluatePeriodAvailability(period, entries, rules).status);
    }

    const status = computeRequestStatus({
      period,
      necessity: request.necessity,
      lifecycle: request.lifecycle_status,
      coverage,
      eligibleUserIds: eligible,
      responses: reqResponses.map((r) => ({
        userId: r.user_id,
        status: r.response_status,
        proposed: r.proposed_starts_at && r.proposed_ends_at ? toInterval(r.proposed_starts_at, r.proposed_ends_at) : null,
      })),
      availability,
      now,
    });

    const helpers: HelperLine[] = eligible.map((userId) => {
      const r = reqResponses.find((x) => x.user_id === userId) ?? null;
      return {
        userId,
        name: nameOf(members, userId, invitees),
        response: r?.response_status ?? null,
        proposed: r?.proposed_starts_at && r.proposed_ends_at ? toInterval(r.proposed_starts_at, r.proposed_ends_at) : null,
        note: r?.note ?? null,
        availability: availability.get(userId) ?? "hidden",
        assignments: liveAssignments.filter((a) => a.assigned_user_id === userId),
        circleRole: memberIds.includes(userId) ? null : (invitees.find((i) => i.user_id === userId)?.role ?? null),
      };
    });
    helpers.sort((a, b) => helperRank(a) - helperRank(b) || a.name.localeCompare(b.name, "fr"));

    return {
      request,
      dog: dogs.find((d) => d.id === request.dog_id),
      period,
      ownerNames: dogCaretakers.map((id) => nameOf(members, id)),
      iAmCaretaker: dogCaretakers.includes(me),
      iAmEligible: eligible.includes(me),
      myResponse: reqResponses.find((r) => r.user_id === me) ?? null,
      myAssignments: liveAssignments.filter((a) => a.assigned_user_id === me),
      coverage,
      status,
      label: statusLabel(status.status, request.necessity),
      assignments: liveAssignments
        .map((a) => ({ ...a, name: nameOf(members, a.assigned_user_id, invitees) }))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      helpers,
    };
  });
}

function helperRank(h: HelperLine): number {
  if (h.assignments.length > 0) return 0;
  if (h.response === "yes") return 1;
  if (h.response === null && (h.availability === "available" || h.availability === "partial")) return 2;
  if (h.response === null) return 3;
  return 4;
}

export type DayBucket = { date: LocalDate; tone: StatusTone; items: RequestView[] };

/** One bucket per local day; a multi-day request appears on each day it touches. */
export function bucketByDay(views: RequestView[], from: LocalDate, to: LocalDate): DayBucket[] {
  const active = views.filter((v) => v.request.lifecycle_status === "active");
  return dateRange(from, to).map((date) => {
    const items = active
      .filter((v) => localDatesTouched(v.period).includes(date))
      .sort((a, b) => a.period.start - b.period.start);
    return { date, tone: dayTone(items.map((i) => i.status.tone)), items };
  });
}

export type DashboardCounts = {
  upcoming: number;
  confirmed: number;
  toConfirm: number;
  uncovered: number;
  partial: number;
  toOrganize: number;
  toAnswer: number;
};

/**
 * Requests waiting for MY answer: I may help, I have not answered, and the
 * request still needs someone (not covered, not past, not informational).
 * Single source for the nav badge, the dashboard and the "À répondre" list.
 */
export function needsMyAnswer(v: RequestView): boolean {
  return (
    v.request.lifecycle_status === "active" &&
    v.request.necessity !== "info" &&
    v.iAmEligible &&
    !v.myResponse &&
    !v.status.isPast &&
    needsOrganizing(v.status.status)
  );
}

export function dashboardCounts(views: RequestView[], now: number): DashboardCounts {
  const upcoming = views.filter(
    (v) => v.request.lifecycle_status === "active" && v.period.end > now && v.status.status !== "informational",
  );
  return {
    upcoming: upcoming.length,
    confirmed: upcoming.filter((v) => v.status.status === "confirmed").length,
    toConfirm: upcoming.filter((v) => v.status.status === "volunteer_found").length,
    uncovered: upcoming.filter((v) => v.status.tone === "uncovered").length,
    partial: upcoming.filter((v) => v.status.status === "partially_covered").length,
    toOrganize: upcoming.filter((v) => needsOrganizing(v.status.status)).length,
    toAnswer: upcoming.filter(needsMyAnswer).length,
  };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
