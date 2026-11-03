import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, CheckCheck, CircleCheck, Clock, NotebookPen, UserCheck } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot, getLatestCareNews, getMyInvitedRequests, getMyPendingProposals } from "@/server/data";
import { CARE_LOG_LABELS } from "@/domain/care-log";
import { buildRequestViews, bucketByDay } from "@/domain/views";
import { buildInvitedView } from "@/domain/invited";
import { fromGroupView, fromInvitedView } from "@/domain/requests-screen";
import { groupProposals } from "@/domain/absence";
import { buildHomeTodo } from "@/domain/home";
import { STATUS_LABELS, TONE_LABELS } from "@/domain/status";
import { addDays, startOfWeek, todayLocal } from "@/domain/time";
import { formatDayShort, formatLocalDate, formatPeriod, formatTime } from "@/lib/format";
import { requestNow } from "@/server/clock";
import { PillLink } from "@/components/ui/kit";
import { BigDate, BigNumber, SegmentGauge, ToneCard, WeekStrip } from "@/components/ui/editorial";
import { Rise, Stagger } from "@/components/ui/motion";
import { STATUS_ICONS } from "@/components/domain/tone";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";
import { ProposalCard } from "@/components/planning/proposals";
import { InstallHint } from "@/components/pwa/install-hint";

export const metadata: Metadata = { title: "Accueil" };

/** Answers shown on the home screen; the others are one tap away ("Tout voir"). */
const MAX_ANSWERS = 3;

/**
 * "À faire maintenant": the date, this week, then one pastel card per thing
 * expected from me (reconfirm, a proposal, an answer, a "Oui" to confirm, a
 * hole in my dogs' needs), then the gardes happening now.
 */
export default async function HomePage() {
  const { userId, group } = await requireAppContext();
  const now = requestNow();
  const today = todayLocal(now);
  const monday = startOfWeek(today);
  // a garde happening now may have started weeks ago
  const [snapshot, invited, proposals] = await Promise.all([
    getGroupSnapshot(group.id, userId, { from: addDays(today, -31), to: addDays(today, 27) }),
    getMyInvitedRequests(),
    getMyPendingProposals(userId).then(groupProposals),
  ]);
  const views = buildRequestViews(snapshot, now).filter((v) => v.request.lifecycle_status === "active");
  const items = [...views.map((v) => fromGroupView(v, now)), ...invited.map((r) => fromInvitedView(buildInvitedView(r, now)))];
  const todo = buildHomeTodo({ views, items, proposals, now });
  const news = await getLatestCareNews(todo.ongoing.map((o) => o.assignmentId));

  const week = bucketByDay(views, monday, addDays(monday, 6)).map((b) => ({
    date: b.date,
    tone: b.tone,
    href: `/calendar?start=${b.date}`,
    label: `${formatLocalDate(b.date, { weekday: "long", day: "numeric", month: "long" })}${b.items.length ? ` : ${TONE_LABELS[b.tone].toLowerCase()}` : ""}`,
  }));

  return (
    <Stagger className="flex flex-col gap-5 pt-2">
      <Rise>
        <BigDate
          date={today}
          aside={
            <>
              <p>
                <span className="block text-[28px] font-medium leading-none tracking-tight tabular">{todo.count}</span>
                <span className="text-[13px] text-ink-2">à faire</span>
              </p>
              <p>
                <span className="block text-[28px] font-medium leading-none tracking-tight tabular">{todo.ongoing.length}</span>
                <span className="text-[13px] text-ink-2">garde{todo.ongoing.length > 1 ? "s" : ""} en cours</span>
              </p>
            </>
          }
        />
      </Rise>

      <Rise>
        <WeekStrip
          days={week}
          today={today}
          action={
            <Link href="/calendar" className="inline-flex min-h-11 items-center text-[13px] text-ink-2">
              Voir l&apos;agenda
            </Link>
          }
        />
      </Rise>

      <Rise>
        <h1 className="px-1 text-[26px] tracking-[-0.02em] text-ink">
          À <b className="font-semibold">faire</b> maintenant
        </h1>
      </Rise>

      {todo.count === 0 && (
        <Rise>
          <div className="flex items-center gap-3 rounded-[30px] bg-surface p-5">
            <CheckCheck className="size-6 shrink-0 text-sage" aria-hidden />
            <p className="text-[16px] text-ink">
              <b className="font-semibold">Rien à faire pour l&apos;instant.</b> Les demandes et les propositions apparaîtront ici.
            </p>
          </div>
        </Rise>
      )}

      {todo.reconfirm.map((i) => (
        <Rise key={i.key}>
          <ToneCard tone="pending" icon={BellRing} tag="Horaires changés" title={`${i.dogName} : merci de reconfirmer`}>
            <p className="text-[15px]">{formatPeriod(i.period.start, i.period.end)}</p>
            <AssignmentActions assignments={i.myAssignments} />
          </ToneCard>
        </Rise>
      ))}

      {todo.proposals.map((p) => (
        <Rise key={p.id}>
          <ProposalCard proposal={p} />
        </Rise>
      ))}

      {todo.answer.slice(0, MAX_ANSWERS).map((i) => (
        <Rise key={i.key}>
          <ToneCard
            tone="pending"
            icon={Clock}
            tag={`À répondre · ${i.ownerNames.join(", ") || "un membre"}`}
            title={
              <Link href={i.href} className="underline-offset-4 hover:underline">
                {i.dogName} a besoin d&apos;aide
              </Link>
            }
          >
            <p className="text-[15px] font-medium">{formatPeriod(i.period.start, i.period.end)}</p>
            {i.description && <p className="line-clamp-2 text-[14px]">« {i.description} »</p>}
            <ResponseButtons requestId={i.requestId} current={null} period={i.period} splittable={i.splittable} size="sm" />
          </ToneCard>
        </Rise>
      ))}
      {todo.answer.length > MAX_ANSWERS && (
        <Rise>
          <PillLink href="/requests" variant="outline" className="w-full">
            Tout voir ({todo.answer.length} demandes à répondre)
          </PillLink>
        </Rise>
      )}

      {todo.confirm.map((v) => {
        const yes = v.helpers.filter((h) => h.response === "yes" && h.assignments.length === 0).map((h) => h.name);
        return (
          <Rise key={v.request.id}>
            <ToneCard tone="pending" icon={UserCheck} tag="À confirmer" title={`${yes.join(" et ") || "Quelqu'un"} peut garder ${v.dog?.name ?? "votre chien"}`}>
              <p className="text-[15px] font-medium">{formatPeriod(v.period.start, v.period.end)}</p>
              <PillLink href={`/requests/${v.request.id}`}>
                Voir et confirmer <ArrowRight className="size-4" aria-hidden />
              </PillLink>
            </ToneCard>
          </Rise>
        );
      })}

      {todo.holes.map((v) => {
        const Icon = STATUS_ICONS[v.status.status];
        return (
          <Rise key={v.request.id}>
            <ToneCard tone={v.status.tone} icon={Icon} tag={STATUS_LABELS[v.status.status]} title={v.dog?.name ?? "Votre chien"}>
              <p className="text-[15px] font-medium">{formatPeriod(v.period.start, v.period.end)}</p>
              {v.coverage.gaps.length > 0 && v.coverage.gaps.length < 4 && v.status.status !== "awaiting_responses" && (
                <p className="text-[14px]">
                  Reste à couvrir : {v.coverage.gaps.map((g) => formatPeriod(g.start, g.end)).join(" ; ")}
                </p>
              )}
              <div className="hatch h-3.5 rounded-full bg-white/35" aria-hidden />
              <PillLink href={`/requests/${v.request.id}`}>
                Trouver quelqu&apos;un <ArrowRight className="size-4" aria-hidden />
              </PillLink>
            </ToneCard>
          </Rise>
        );
      })}

      {todo.ongoing.map((o) => {
        const last = news[o.assignmentId];
        return (
          <Rise key={o.key}>
            <ToneCard
              tone="covered"
              icon={CircleCheck}
              tag="Garde en cours"
              title={o.role === "helper" ? `Vous gardez ${o.dogName}` : `${o.dogName} chez ${o.keeper}`}
              aside={<span className="pt-1.5 text-right text-[13px]">jusqu&apos;au {formatDayShort(o.end)}, {formatTime(o.end)}</span>}
            >
              {o.nights > 0 && (
                <>
                  <BigNumber value={`${o.nightsDone}`} unit={`/${o.nights} nuit${o.nights > 1 ? "s" : ""}`} />
                  <SegmentGauge total={o.nights} done={o.nightsDone} label={`${o.nightsDone} nuit${o.nightsDone > 1 ? "s" : ""} sur ${o.nights}`} />
                </>
              )}
              <div className="flex items-center gap-3">
                <PillLink href={`/requests/${o.requestId}#carnet`} variant="outline" className="flex-1 border-transparent bg-surface text-ink">
                  <NotebookPen className="size-4" aria-hidden /> Ouvrir le carnet
                </PillLink>
                <span className="text-right text-[13px] leading-tight">
                  {last ? (
                    <>
                      Dernière nouvelle
                      <br />
                      {CARE_LOG_LABELS[last.kind]}, {formatTime(last.occurred_at)}
                    </>
                  ) : (
                    "Pas encore de nouvelles"
                  )}
                </span>
              </div>
            </ToneCard>
          </Rise>
        );
      })}

      {todo.next && (
        <Rise>
          <Link href={todo.next.href} className="flex items-center gap-3 rounded-[30px] bg-surface p-5 active:scale-[0.99]">
            <CircleCheck className="size-6 shrink-0 text-sage" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink-2">Votre prochaine garde</span>
              <span className="block text-[17px] font-semibold text-ink">
                {todo.next.dogName} · {formatPeriod(todo.next.period.start, todo.next.period.end)}
              </span>
            </span>
            <ArrowRight className="size-5 text-ink-2" aria-hidden />
          </Link>
        </Rise>
      )}

      <Rise>
        <InstallHint />
      </Rise>
    </Stagger>
  );
}
