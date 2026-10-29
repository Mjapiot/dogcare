import type { Metadata } from "next";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot } from "@/server/data";
import { buildRequestViews } from "@/domain/views";
import { addDays, dateRange, parseLocalDate, startOfWeek, todayLocal, formatLocalDate as fmtDate } from "@/domain/time";
import { availableOn, calSummary, filterCalItems, toCalItem, type CalFocus, type CalScope } from "@/domain/calendar";
import { TopSwitch } from "@/components/calendar/top-switch";
import { CalendarView } from "@/components/calendar/calendar-view";
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

const AGENDA_DAYS = 28;

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const view = params.view === "month" ? "month" : "agenda";
  const scope: CalScope = params.scope === "mine" || params.scope === "guards" ? params.scope : "all";
  const focus: CalFocus = params.focus === "uncovered" || params.focus === "organize" || params.focus === "confirmed" ? params.focus : "all";
  const dog = typeof params.dog === "string" ? params.dog : null;
  const owner = typeof params.owner === "string" ? params.owner : null;
  const today = todayLocal();
  const anchor = typeof params.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.start) ? params.start : today;

  const from = view === "month" ? startOfWeek(firstOfMonth(anchor)) : anchor;
  const to = view === "month" ? addDays(startOfWeek(endOfMonth(anchor)), 6) : addDays(anchor, AGENDA_DAYS - 1);

  const snapshot = await getGroupSnapshot(group.id, userId, { from, to });
  const ownerDogIds = owner ? new Set(snapshot.caretakers.filter((c) => c.user_id === owner).map((c) => c.dog_id)) : null;
  const scoped = filterCalItems(
    buildRequestViews(snapshot, requestNow())
      .filter((v) => v.request.lifecycle_status === "active")
      .filter((v) => (!dog || v.request.dog_id === dog) && (!ownerDogIds || ownerDogIds.has(v.request.dog_id)))
      .map(toCalItem),
    scope,
    "all",
  );
  const items = filterCalItems(scoped, "all", focus);

  // who declared themselves available, day by day (only availability shared with this group)
  const people = snapshot.members
    .filter((m) => m.share_availability || m.user_id === userId)
    .map((m) => ({
      userId: m.user_id,
      name: m.user_id === userId ? "Vous" : m.display_name || "Membre",
      entries: snapshot.availabilityEntries.filter((e) => e.user_id === m.user_id),
      rules: snapshot.availabilityRules.filter((r) => r.user_id === m.user_id),
    }));
  const available = Object.fromEntries(dateRange(from, to).map((d) => [d, availableOn(d, people)]));

  const owners = snapshot.members
    .filter((m) => snapshot.caretakers.some((c) => c.user_id === m.user_id))
    .map((m) => ({ id: m.user_id, name: m.display_name || "Membre" }));

  return (
    <div className="flex flex-col gap-5 pt-2">
      <TopSwitch active="calendar" />
      <CalendarView
        view={view}
        anchor={view === "month" ? firstOfMonth(anchor) : from}
        from={from}
        to={to}
        today={today}
        items={items}
        summary={calSummary(scoped)}
        scope={scope}
        focus={focus}
        filters={{ dog, owner }}
        dogs={snapshot.dogs.filter((d) => !d.archived_at).map((d) => ({ id: d.id, name: d.name }))}
        owners={owners}
        available={available}
      />
    </div>
  );
}
