import type { Metadata } from "next";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot } from "@/server/data";
import { buildRequestViews, bucketByDay, type RequestView } from "@/domain/views";
import { addDays, parseLocalDate, startOfWeek, todayLocal, formatLocalDate as fmtDate } from "@/domain/time";
import { needsOrganizing } from "@/domain/status";
import { TopSwitch } from "@/components/calendar/top-switch";
import { CalendarView } from "@/components/calendar/calendar-view";
import { toCalendarDays, type StatusFilter } from "@/components/calendar/types";
import { requestNow } from "@/server/clock";

export const metadata: Metadata = { title: "Calendrier" };


function firstOfMonth(date: string) {
  const { year, month } = parseLocalDate(date);
  return fmtDate(year, month, 1);
}

function endOfMonth(date: string) {
  const { year, month } = parseLocalDate(date);
  const next = month === 12 ? fmtDate(year + 1, 1, 1) : fmtDate(year, month + 1, 1);
  return addDays(next, -1);
}

function matches(v: RequestView, status: StatusFilter, dog: string | null, ownerDogIds: Set<string> | null) {
  if (dog && v.request.dog_id !== dog) return false;
  if (ownerDogIds && !ownerDogIds.has(v.request.dog_id)) return false;
  switch (status) {
    case "organize":
      return needsOrganizing(v.status.status) && !v.status.isPast;
    case "uncovered":
      return (v.status.tone === "uncovered" || v.status.tone === "partial") && !v.status.isPast;
    case "confirmed":
      return v.status.status === "confirmed";
    case "info":
      return v.status.status === "informational";
    default:
      return true;
  }
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const view = params.view === "month" ? "month" : "2w";
  const status = (["organize", "uncovered", "confirmed", "info"].includes(String(params.status)) ? params.status : "all") as StatusFilter;
  const dog = typeof params.dog === "string" ? params.dog : null;
  const owner = typeof params.owner === "string" ? params.owner : null;
  const today = todayLocal();
  const anchor = typeof params.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.start) ? params.start : today;

  const from = view === "month" ? startOfWeek(firstOfMonth(anchor)) : startOfWeek(anchor);
  const to = view === "month" ? addDays(startOfWeek(endOfMonth(anchor)), 6) : addDays(from, 13);

  const snapshot = await getGroupSnapshot(group.id, userId, { from, to });
  const ownerDogIds = owner
    ? new Set(snapshot.caretakers.filter((c) => c.user_id === owner).map((c) => c.dog_id))
    : null;
  const views = buildRequestViews(snapshot, requestNow()).filter((v) => matches(v, status, dog, ownerDogIds));
  const days = toCalendarDays(bucketByDay(views, from, to));

  const owners = snapshot.members
    .filter((m) => snapshot.caretakers.some((c) => c.user_id === m.user_id))
    .map((m) => ({ id: m.user_id, name: m.display_name || "Membre" }));

  return (
    <div className="flex flex-col gap-5 pt-2">
      <TopSwitch active="calendar" />
      <CalendarView
        view={view}
        anchor={view === "month" ? firstOfMonth(anchor) : from}
        today={today}
        days={days}
        filters={{ status, dog, owner }}
        dogs={snapshot.dogs.filter((d) => !d.archived_at).map((d) => ({ id: d.id, name: d.name }))}
        owners={owners}
      />
    </div>
  );
}
