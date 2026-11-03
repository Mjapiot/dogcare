import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot } from "@/server/data";
import { buildRequestViews } from "@/domain/views";
import { addDays, parseLocalDate, todayLocal, formatLocalDate as fmtDate, type LocalDate } from "@/domain/time";
import { availableNames, availableOn, needCards, toCalItem } from "@/domain/calendar";
import { needsOrganizing } from "@/domain/status";
import { localDate } from "@/lib/validation";
import { formatLocalDate, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requestNow } from "@/server/clock";
import { EmptyState, PillLink } from "@/components/ui/kit";
import { PillTabs } from "@/components/ui/editorial";
import { Rise, Stagger } from "@/components/ui/motion";
import { STATUS_ICONS, TONE_CLASSES } from "@/components/domain/tone";

export const metadata: Metadata = { title: "Agenda" };

const firstOfMonth = (date: LocalDate) => {
  const { year, month } = parseLocalDate(date);
  return fmtDate(year, month, 1);
};
const shiftMonth = (date: LocalDate, delta: number) => {
  const { year, month } = parseLocalDate(date);
  const m = month - 1 + delta;
  return fmtDate(year + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1, 1);
};
const monthShortLabel = (date: LocalDate) => formatLocalDate(date, { month: "short" }).replace(".", "").toUpperCase();

/**
 * Agenda, "Besoins": the group's needs of a month as big pastel cards, one per
 * need on its first day (the color is its status, always with its icon and
 * label), with who said they are available that day.
 */
export default async function AgendaPage({ searchParams }: PageProps<"/calendar">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const today = todayLocal(requestNow());
  const anchor = firstOfMonth(localDate.safeParse(params.start).data ?? today);
  const isThisMonth = anchor === firstOfMonth(today);
  // this month: from today on; another month: all of it
  const from = isThisMonth ? today : anchor;
  const to = addDays(shiftMonth(anchor, 1), -1);

  const snapshot = await getGroupSnapshot(group.id, userId, { from, to });
  const items = buildRequestViews(snapshot, requestNow())
    .filter((v) => v.request.lifecycle_status === "active")
    .map(toCalItem);
  const cards = needCards(items, from, to);

  // who declared themselves available (only availability shared with this group)
  const people = snapshot.members
    .filter((m) => m.share_availability || m.user_id === userId)
    .map((m) => ({
      userId: m.user_id,
      name: m.user_id === userId ? "Vous" : m.display_name || "Membre",
      entries: snapshot.availabilityEntries.filter((e) => e.user_id === m.user_id),
      rules: snapshot.availabilityRules.filter((r) => r.user_id === m.user_id),
    }));

  const monthLink = (delta: -1 | 1) => {
    const date = shiftMonth(anchor, delta);
    const Icon = delta < 0 ? ChevronLeft : ChevronRight;
    return (
      <Link
        href={`/calendar?start=${date}`}
        scroll={false}
        aria-label={`${delta < 0 ? "Mois précédent" : "Mois suivant"} : ${formatLocalDate(date, { month: "long", year: "numeric" })}`}
        className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
      >
        <Icon className="size-5" aria-hidden />
      </Link>
    );
  };

  return (
    <Stagger className="flex flex-col gap-5 pt-2">
      <Rise>
        <PillTabs
          label="Agenda"
          items={[
            { href: "/calendar", label: "Besoins", active: true },
            { href: "/availability", label: "Mes dispos", active: false },
          ]}
        />
      </Rise>
      <Rise>
        <h1 className="text-[40px] font-light leading-[1.02] tracking-[-0.035em] text-ink">
          Le <b className="font-semibold">planning</b> du groupe
        </h1>
      </Rise>

      <Rise>
        <nav aria-label="Mois" className="flex items-center justify-between rounded-full bg-surface p-1.5">
          {monthLink(-1)}
          <div className="flex items-baseline gap-4">
            <span className="text-[18px] text-ink-3" aria-hidden>
              {monthShortLabel(shiftMonth(anchor, -1))}
            </span>
            <span className="text-[26px] font-medium tracking-tight text-ink" aria-live="polite">
              <span aria-hidden>{monthShortLabel(anchor)}</span>
              <span className="sr-only">{formatLocalDate(anchor, { month: "long", year: "numeric" })}</span>
            </span>
            <span className="text-[18px] text-ink-3" aria-hidden>
              {monthShortLabel(shiftMonth(anchor, 1))}
            </span>
          </div>
          {monthLink(1)}
        </nav>
        {!isThisMonth && (
          <Link href="/calendar" scroll={false} className="mt-2 inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-ink underline underline-offset-4">
            Revenir à aujourd&apos;hui
          </Link>
        )}
      </Rise>

      {cards.length === 0 ? (
        <Rise>
          <EmptyState
            icon={CalendarPlus}
            title={isThisMonth ? "Aucun besoin d'ici la fin du mois" : "Aucun besoin ce mois-ci"}
            description="Quand un membre aura besoin d'aide pour son chien, sa demande apparaîtra ici."
            action={<PillLink href="/plan">Besoin d&apos;une garde</PillLink>}
          />
        </Rise>
      ) : (
        <ol className="flex flex-col gap-3">
          {cards.map(({ date, item }) => {
            const StatusIcon = STATUS_ICONS[item.status];
            const free = needsOrganizing(item.status) && !item.isPast ? availableNames(availableOn(date, people)) : [];
            return (
              <li key={item.id}>
                <Rise>
                  <Link
                    href={`/requests/${item.id}`}
                    className={cn("flex items-stretch gap-4 rounded-[28px] p-5 active:scale-[0.99]", TONE_CLASSES[item.tone], item.isPast && "opacity-60")}
                  >
                    <span className="flex min-w-[96px] flex-col">
                      <span className="text-[14px] first-letter:uppercase">{formatLocalDate(date, { weekday: "long" })}</span>
                      <span className="mt-1 text-[46px] font-light leading-[0.9] tracking-[-0.05em] tabular">{date.slice(8, 10)}</span>
                      <span className="text-[46px] font-light leading-[0.9] tracking-[-0.05em]">{monthShortLabel(date)}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 border-l-[1.5px] border-current pl-4">
                      <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-white/55 px-3 py-1.5 text-[13px] font-medium">
                        <StatusIcon className="size-3.5" aria-hidden /> {item.label}
                      </span>
                      <span>
                        <span className="block truncate text-[20px] font-medium tracking-tight">{item.dogName}</span>
                        <span className="block text-[13px]">{formatPeriod(item.start, item.end)}</span>
                        {item.helpers.length > 0 && <span className="block text-[13px]">Gardé par {item.helpers.join(", ")}</span>}
                        {free.length > 0 && (
                          <span className="mt-1 flex items-center gap-1 text-[13px]">
                            <Users className="size-3.5 shrink-0" aria-hidden /> Dispo ce jour : {free.join(", ")}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </Rise>
              </li>
            );
          })}
        </ol>
      )}
    </Stagger>
  );
}
