import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, CalendarPlus, CircleAlert, CircleCheck, CircleDashed, Clock, Inbox, PawPrint, UserCheck } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot, signDogPhotos } from "@/server/data";
import { buildRequestViews, dashboardCounts } from "@/domain/views";
import { addDays, todayLocal } from "@/domain/time";
import { needsOrganizing } from "@/domain/status";
import { monthShort, weekdayLabel, formatPeriod } from "@/lib/format";
import { CareRequestCard } from "@/components/domain/request-bits";
import { TONE_CLASSES } from "@/components/domain/tone";
import { TopSwitch } from "@/components/calendar/top-switch";
import { EmptyState, PillLink } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { InstallHint } from "@/components/pwa/install-hint";
import { requestNow } from "@/server/clock";

export const metadata: Metadata = { title: "Aujourd'hui" };

export default async function TodayPage() {
  const { userId, group } = await requireAppContext();
  const now = requestNow();
  const today = todayLocal(now);
  const snapshot = await getGroupSnapshot(group.id, userId, { from: today, to: addDays(today, 27) });
  const views = buildRequestViews(snapshot, now);
  const counts = dashboardCounts(views, now);
  const photos = await signDogPhotos(snapshot.dogs);

  const upcoming = views
    .filter((v) => v.request.lifecycle_status === "active" && v.period.end > now)
    .sort((a, b) => a.period.start - b.period.start);
  const reconfirm = views.filter((v) => v.myAssignments.some((a) => a.status === "pending_reconfirmation"));
  const myGuards = upcoming.filter((v) => v.myAssignments.some((a) => a.status === "confirmed"));
  const [dd, mm] = [today.slice(8, 10), today.slice(5, 7)];

  const tiles = [
    { label: "Sans solution", value: counts.uncovered, icon: CircleAlert, tone: "uncovered", href: "/calendar?status=uncovered" },
    { label: "Partielles", value: counts.partial, icon: CircleDashed, tone: "partial", href: "/calendar?status=organize" },
    { label: "À confirmer", value: counts.toConfirm, icon: UserCheck, tone: "pending", href: "/calendar?status=organize" },
    { label: "Confirmées", value: counts.confirmed, icon: CircleCheck, tone: "covered", href: "/calendar?status=confirmed" },
  ] as const;

  return (
    <div className="flex flex-col gap-6 pt-2">
      <TopSwitch active="today" />

      <section aria-label="Date du jour" className="flex items-stretch justify-between gap-4 px-1">
        <div>
          <p className="text-[17px] text-ink-2">{weekdayLabel(today)}</p>
          <p className="mt-1 text-[76px] font-medium leading-[0.86] tracking-[-0.06em] text-ink tabular">
            {dd}.{mm}
          </p>
          <p className="text-[76px] font-medium leading-[0.92] tracking-[-0.06em] text-ink">{monthShort(today)}</p>
        </div>
        <div className="flex flex-col justify-center gap-4 border-l border-ink/70 pl-4">
          <div>
            <p className="text-[26px] font-medium leading-none tabular">{counts.toOrganize}</p>
            <p className="mt-1 text-[13px] text-ink-2">à organiser</p>
          </div>
          <div>
            <p className="text-[26px] font-medium leading-none tabular">{counts.upcoming}</p>
            <p className="mt-1 text-[13px] text-ink-2">besoins à venir</p>
          </div>
        </div>
      </section>

      <section aria-label="Tableau de bord" className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3 transition-transform active:scale-[0.98]",
              t.value > 0 ? TONE_CLASSES[t.tone] : "bg-surface text-ink-2",
            )}
          >
            <t.icon className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[22px] font-semibold leading-none tabular">{t.value}</span>
              <span className="block truncate text-[13px] font-medium">{t.label}</span>
            </span>
          </Link>
        ))}
      </section>

      {reconfirm.length > 0 && (
        <Link
          href={`/requests/${reconfirm[0].request.id}`}
          className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-surface"
        >
          <BellRing className="size-5 shrink-0" aria-hidden />
          <span className="flex-1 text-[15px] font-medium">
            Les horaires d&apos;une garde ont changé : merci de reconfirmer ({reconfirm[0].dog?.name}).
          </span>
          <ArrowRight className="size-5" aria-hidden />
        </Link>
      )}

      {counts.toAnswer > 0 && (
        <Link href="/requests" className="flex items-center gap-3 rounded-2xl bg-surface p-4">
          <Inbox className="size-5 shrink-0 text-ink" aria-hidden />
          <span className="flex-1 text-[15px] font-medium text-ink">
            {counts.toAnswer} demande{counts.toAnswer > 1 ? "s attendent" : " attend"} votre réponse
          </span>
          <ArrowRight className="size-5 text-ink-2" aria-hidden />
        </Link>
      )}

      <section className="-mx-4 flex flex-col gap-3 rounded-t-[32px] bg-surface px-3 pt-5 pb-6">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-[17px] font-semibold text-ink">Prochains besoins</h2>
          <PillLink href="/requests" variant="soft" size="sm">
            Mes réponses
          </PillLink>
        </div>

        {myGuards.length > 0 && (
          <div className="mx-1 flex items-center gap-2 rounded-2xl bg-[var(--tone-covered)] px-4 py-3 text-[14px] font-medium text-[var(--tone-covered-ink)]">
            <PawPrint className="size-4" aria-hidden />
            Prochaine garde pour vous : {myGuards[0].dog?.name} · {formatPeriod(myGuards[0].period.start, myGuards[0].period.end)}
          </div>
        )}

        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="Aucun besoin dans les 4 prochaines semaines"
            description="Quand un membre aura besoin d'aide pour son chien, sa demande apparaîtra ici."
            action={
              <PillLink href="/requests/new" size="md">
                Ajouter un besoin
              </PillLink>
            }
            className="bg-surface-2"
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {upcoming.slice(0, 8).map((v) => (
              <li key={v.request.id}>
                <CareRequestCard view={v} photoUrl={v.dog ? photos[v.dog.id] : null} href={`/requests/${v.request.id}`} />
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > 8 && (
          <PillLink href="/calendar" variant="outline" className="mx-2">
            Voir tout le calendrier
          </PillLink>
        )}
        {upcoming.some((v) => needsOrganizing(v.status.status)) && (
          <p className="flex items-center gap-1.5 px-3 text-[13px] text-ink-3">
            <Clock className="size-3.5" aria-hidden />
            Une demande sans réponse n&apos;est jamais considérée comme refusée.
          </p>
        )}
        <InstallHint />
      </section>
    </div>
  );
}
