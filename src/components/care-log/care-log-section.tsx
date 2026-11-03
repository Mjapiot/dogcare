import { NotebookPen } from "lucide-react";
import { getActiveRoutines, getCareLog, getDogPassportPrivate } from "@/server/data";
import { careLogWindow, isCareLogOpen } from "@/domain/care-log";
import { routineChecklist, routineOccurrences, type Routine } from "@/domain/routines";
import { toInterval } from "@/domain/intervals";
import { toLocalDate } from "@/domain/time";
import type { CareLogEntryRow } from "@/lib/types";
import { formatPeriod } from "@/lib/format";
import { requestNow } from "@/server/clock";
import { CareLogComposer } from "./care-log-composer";
import { CareLogTimeline } from "./care-log-timeline";
import { RoutineChecklist } from "./routine-checklist";

type Assignment = { id: string; status: string; starts_at: string; ends_at: string };

/** Today's routine occurrences of a garde, with what its log says. */
function todayRoutines(routines: Routine[], a: Assignment, entries: CareLogEntryRow[], names: Record<string, string>, now: number) {
  const occurrences = routineOccurrences(routines, toInterval(a.starts_at, a.ends_at));
  const checks = entries
    .filter((e) => e.assignment_id === a.id && e.routine_id)
    .map((e) => ({ routine_id: e.routine_id ?? null, routine_at: e.routine_at ?? null, occurred_at: e.occurred_at, authorName: names[e.author_id] ?? "Le gardien", entryId: e.id }));
  return routineChecklist(occurrences, checks, now, toLocalDate(now));
}

/**
 * "Carnet de garde" of a request: quick buttons for my open gardes (with a
 * reminder of the passport's instructions), then the timeline. Rendered for
 * the helper and the dog's caretakers only.
 */
export async function CareLogSection({
  requestId,
  groupId,
  me,
  dog,
  myAssignments,
  iAmCaretaker,
  names,
  liveAssignments = [],
}: {
  requestId: string;
  groupId: string;
  me: string;
  dog: { id: string; name: string; meals: string | null; walks: string | null } | null;
  myAssignments: Assignment[];
  iAmCaretaker: boolean;
  /** Display names by user id (helpers of the request). */
  names: Record<string, string>;
  /** Live gardes of the request (the caretakers see their routines of the day). */
  liveAssignments?: Array<Assignment & { assigned_user_id: string }>;
}) {
  if (!iAmCaretaker && myAssignments.length === 0) return null;
  const now = requestNow();
  const open = myAssignments.filter((a) => isCareLogOpen(a, now));
  const [entries, priv, routines] = await Promise.all([
    getCareLog(requestId),
    open.length && dog ? getDogPassportPrivate(dog.id) : Promise.resolve(null),
    dog ? getActiveRoutines(dog.id) : Promise.resolve([]),
  ]);
  // the caretakers follow today's routines of the gardes in progress
  const watched = iAmCaretaker && open.length === 0 ? liveAssignments.filter((a) => a.status === "confirmed") : [];
  const watchedLists = watched.map((a) => ({ a, items: todayRoutines(routines, a, entries, names, now) })).filter((w) => w.items.length > 0);
  if (entries.length === 0 && open.length === 0 && watchedLists.length === 0) return null;

  const reminders = [
    { label: "Repas", text: dog?.meals },
    { label: "Promenades", text: dog?.walks },
    { label: "Traitements", text: priv?.access.health ? priv.health?.treatments : null },
  ].filter((r): r is { label: string; text: string } => Boolean(r.text?.trim()));

  return (
    <section id="carnet" className="flex scroll-mt-20 flex-col gap-3" aria-labelledby="care-log-title">
      <h2 id="care-log-title" className="flex items-center gap-2 px-1 text-[17px] font-semibold text-ink">
        <NotebookPen className="size-5" aria-hidden /> Carnet de garde
      </h2>
      {open.map((a) => (
        <div key={a.id} className="flex flex-col gap-3 rounded-[24px] bg-surface p-4">
          {open.length > 1 && <p className="text-[14px] font-medium text-ink-2">{formatPeriod(a.starts_at, a.ends_at)}</p>}
          {reminders.length > 0 && (
            <dl className="flex flex-col gap-1 rounded-2xl bg-surface-2 px-4 py-3 text-[14px]">
              {reminders.map((r) => (
                <div key={r.label}>
                  <dt className="inline font-semibold text-ink">{r.label} : </dt>
                  <dd className="inline whitespace-pre-line text-ink-2">{r.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {(() => {
            const items = todayRoutines(routines, a, entries, names, now);
            return items.length > 0 && <RoutineChecklist items={items} assignmentId={a.id} canCheck title="Routines du jour" />;
          })()}
          <CareLogComposer assignmentId={a.id} dogName={dog?.name ?? "le chien"} window={careLogWindow(a)} />
        </div>
      ))}
      {watchedLists.map(({ a, items }) => (
        <div key={a.id} className="rounded-[24px] bg-surface p-4">
          <RoutineChecklist items={items} assignmentId={a.id} canCheck={false} title={`Routines du jour · ${names[a.assigned_user_id] ?? "le gardien"}`} />
        </div>
      ))}
      <CareLogTimeline
        entries={entries.map((e) => ({ ...e, authorName: names[e.author_id] ?? "Le gardien" }))}
        me={me}
        editableAssignmentIds={open.map((a) => a.id)}
        reportGroupId={iAmCaretaker ? groupId : null}
        showAuthors={iAmCaretaker}
      />
    </section>
  );
}
