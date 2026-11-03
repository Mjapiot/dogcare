/**
 * The home screen, "À faire maintenant": what is expected from me, most
 * urgent first, then the gardes happening now. Built from the same views as
 * the other screens (requests of my group, of the circles I am in, my
 * proposals), so the counts agree everywhere. Pure.
 */
import type { IncomingGroup } from "./absence";
import { nightAnchors } from "./planner";
import type { ScreenItem } from "./requests-screen";
import { needsOrganizing } from "./status";
import type { RequestView } from "./views";

export type OngoingGarde = {
  key: string;
  requestId: string;
  dogName: string;
  /** Who keeps the dog (me as the helper: "vous"). */
  keeper: string;
  role: "owner" | "helper";
  assignmentId: string;
  start: number;
  end: number;
  /** Nights of this garde and how many have passed (01:00 Paris markers). */
  nights: number;
  nightsDone: number;
};

export type HomeTodo = {
  /** My gardes whose hours changed: reconfirm first. */
  reconfirm: ScreenItem[];
  /** Proposals waiting for my answer (one per absence). */
  proposals: IncomingGroup[];
  /** Requests waiting for my answer, soonest first (not those already asked by a proposal). */
  answer: ScreenItem[];
  /** My dogs: a "Oui" waiting for my confirmation. */
  confirm: RequestView[];
  /** My dogs: still to organise (holes), soonest first. */
  holes: RequestView[];
  /** Gardes happening now: mine as helper, my dogs' as owner. */
  ongoing: OngoingGarde[];
  /** My next confirmed garde within a week (when nothing is happening now). */
  next: ScreenItem | null;
  /** Things to do (everything but the gardes). */
  count: number;
};

const WEEK_MS = 7 * 24 * 3_600_000;

function nightsOf(start: number, end: number, now: number): { nights: number; nightsDone: number } {
  const anchors = nightAnchors({ start, end });
  return { nights: anchors.length, nightsDone: anchors.filter((a) => a <= now).length };
}

export function buildHomeTodo(input: {
  views: readonly RequestView[];
  items: readonly ScreenItem[];
  proposals: readonly IncomingGroup[];
  now: number;
}): HomeTodo {
  const { now } = input;
  const byStart = <T extends { period: { start: number } }>(list: T[]) => list.sort((a, b) => a.period.start - b.period.start);
  const asked = new Set(input.proposals.flatMap((p) => p.requestIds));
  const live = (start: string, end: string) => Date.parse(start) <= now && now < Date.parse(end);

  const reconfirm = byStart(input.items.filter((i) => i.myAssignments.some((a) => a.status === "pending_reconfirmation")));
  const answer = byStart(input.items.filter((i) => i.needsMyAnswer && !asked.has(i.requestId)));

  const mine = input.views.filter(
    (v) => v.iAmCaretaker && v.request.lifecycle_status === "active" && v.request.necessity !== "info" && v.period.end > now,
  );
  const confirm = byStart(mine.filter((v) => v.status.status === "volunteer_found"));
  const holes = byStart(mine.filter((v) => needsOrganizing(v.status.status) && v.status.status !== "volunteer_found"));

  const ongoing: OngoingGarde[] = [
    ...input.items.flatMap((i) =>
      i.myAssignments
        .filter((a) => a.status === "confirmed" && live(a.starts_at, a.ends_at))
        .map((a) => {
          const start = Date.parse(a.starts_at);
          const end = Date.parse(a.ends_at);
          return { key: `h-${a.id}`, requestId: i.requestId, dogName: i.dogName, keeper: "vous", role: "helper" as const, assignmentId: a.id, start, end, ...nightsOf(start, end, now) };
        }),
    ),
    ...mine.flatMap((v) =>
      v.assignments
        .filter((a) => a.status === "confirmed" && live(a.starts_at, a.ends_at))
        .map((a) => {
          const start = Date.parse(a.starts_at);
          const end = Date.parse(a.ends_at);
          return { key: `o-${a.id}`, requestId: v.request.id, dogName: v.dog?.name ?? "Votre chien", keeper: a.name, role: "owner" as const, assignmentId: a.id, start, end, ...nightsOf(start, end, now) };
        }),
    ),
  ].sort((a, b) => a.end - b.end);

  const next =
    ongoing.length > 0
      ? null
      : (byStart(
          input.items.filter((i) =>
            i.myAssignments.some((a) => a.status === "confirmed" && Date.parse(a.starts_at) > now && Date.parse(a.starts_at) - now <= WEEK_MS),
          ),
        )[0] ?? null);

  return {
    reconfirm,
    proposals: [...input.proposals],
    answer,
    confirm,
    holes,
    ongoing,
    next,
    count: reconfirm.length + input.proposals.length + answer.length + confirm.length + holes.length,
  };
}
