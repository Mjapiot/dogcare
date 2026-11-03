import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, HeartHandshake, Info, PawPrint, Users } from "lucide-react";
import { getMyGroups, requireAppContext } from "@/server/session";
import {
  getAbsenceSiblings,
  getGroupSnapshot,
  getHelperPrefs,
  getMaxDogs,
  getMyPendingProposals,
  getOtherGardes,
  getRequestGroupId,
  getRequestProposals,
  signDogPhotos,
} from "@/server/data";
import { groupProposals } from "@/domain/absence";
import { cumulBusyRows } from "@/domain/cumul";
import { buildRequestViews } from "@/domain/views";
import { NECESSITY_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import { deName, formatDuration, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/components/domain/tone";
import { CoverageIndicator, DogAvatar, RequestStatusBadge } from "@/components/domain/request-bits";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";
import { HelperList } from "@/components/domain/helper-list";
import { OwnerActions } from "@/components/domain/owner-actions";
import { ReportButton } from "@/components/domain/report-button";
import { CareLogSection } from "@/components/care-log/care-log-section";
import { PlanCard } from "@/components/planning/plan-card";
import { ProposalCard, ProposalsSection } from "@/components/planning/proposals";
import { canPlan, holeSuggestions, planOffers, planRules, takenIntervals } from "@/domain/plan-inputs";
import { offerIntervals, proposePlan } from "@/domain/planner";
import { uuid } from "@/lib/validation";
import { requestNow } from "@/server/clock";

export const metadata: Metadata = { title: "Demande" };

export default async function RequestDetailPage({ params }: PageProps<"/requests/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  // a request may belong to another of my groups (e.g. opened from a notification)
  const groupId = await getRequestGroupId(id);
  if (!groupId) notFound();
  // asked as a person of the dog's circle, outside this group
  if (!(await getMyGroups()).some((g) => g.id === groupId)) redirect(`/circle/requests/${id}`);
  const snapshot = await getGroupSnapshot(groupId, userId, { requestIds: [id] });
  const view = buildRequestViews(snapshot, requestNow())[0];
  if (!view) notFound();
  const now = requestNow();
  const planning = canPlan(view, now);
  const yesIds = view.helpers.filter((h) => h.response === "yes").map((h) => h.userId);
  const [photos, gardes, maxDogs, prefs, proposals, mine, siblings] = await Promise.all([
    signDogPhotos(view.dog ? [view.dog] : []),
    planning ? getOtherGardes(yesIds, view.period, id) : Promise.resolve([]),
    planning ? getMaxDogs(yesIds) : Promise.resolve({}),
    planning && view.dog ? getHelperPrefs(view.dog.id) : Promise.resolve([]),
    view.iAmCaretaker ? getRequestProposals(id) : Promise.resolve([]),
    view.iAmCaretaker ? Promise.resolve([]) : getMyPendingProposals(userId),
    view.request.absence_id ? getAbsenceSiblings(view.request.absence_id, id) : Promise.resolve([]),
  ]);
  const myProposal = groupProposals(mine).find((g) => g.requestIds.includes(id));
  // another garde takes a helper only when they could not keep one more dog (src/domain/cumul.ts)
  const busy = cumulBusyRows(view.period, gardes, { count: 1, aloneOnly: view.dog?.alone_only ?? false }, maxDogs);
  // planning engine: same inputs on the server (suggestions for holes) and in the card
  const plan = planning
    ? (() => {
        const offers = planOffers(view, snapshot, busy, prefs, proposals.filter((p) => p.status === "accepted"));
        const rules = planRules(view.dog);
        const taken = takenIntervals(view);
        const holes = proposePlan({ period: view.period, taken, offers, rules }).holes;
        return { offers, rules, taken, suggestions: holeSuggestions(holes, view, snapshot) };
      })()
    : null;
  const r = view.request;
  const cancelled = r.lifecycle_status === "cancelled";
  const { counts } = view.status;

  const explanation = (() => {
    if (cancelled || r.necessity === "info") return null;
    const parts: string[] = [];
    if (counts.yes) parts.push(`${counts.yes} volontaire${counts.yes > 1 ? "s" : ""}`);
    if (counts.no) parts.push(`${counts.no} non`);
    if (counts.pending)
      parts.push(
        `${counts.pending} sans réponse${counts.pendingPotentiallyAvailable ? ` (dont ${counts.pendingPotentiallyAvailable} potentiellement disponible${counts.pendingPotentiallyAvailable > 1 ? "s" : ""})` : ""}`,
      );
    return parts.join(" · ") || "Aucun autre membre dans le groupe";
  })();

  return (
    <div className="flex flex-col gap-5 pt-2">
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
        <ArrowLeft className="size-4" aria-hidden /> Retour
      </Link>

      <section className={cn("flex flex-col gap-4 rounded-[32px] p-5", TONE_CLASSES[view.status.tone])}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-medium opacity-80">
              {REQUEST_TYPE_LABELS[r.request_type]} · {NECESSITY_LABELS[r.necessity]}
            </p>
            <h1 className="mt-1 text-[40px] font-semibold leading-[1] tracking-[-0.04em]">{view.dog?.name ?? "Chien"}</h1>
            <p className="mt-1 text-[14px] opacity-80">Pour {view.ownerNames.join(", ") || "un ancien membre"}</p>
          </div>
          <DogAvatar name={view.dog?.name ?? "Chien"} photoUrl={view.dog ? photos[view.dog.id] : null} size={64} />
        </div>
        <div>
          <p className="text-[19px] font-semibold">{formatPeriod(view.period.start, view.period.end)}</p>
          <p className="text-[14px] opacity-80">Durée : {formatDuration(view.period.end - view.period.start)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RequestStatusBadge view={view} className="bg-white/55" />
          {view.status.isPast && !cancelled && <span className="rounded-full bg-black/10 px-2.5 py-1 text-[13px] font-medium">Passée</span>}
        </div>
        {r.necessity !== "info" && !cancelled && <CoverageIndicator coverage={view.coverage} />}
        {explanation && (
          <p className="flex items-center gap-1.5 text-[14px] font-medium">
            <Users className="size-4" aria-hidden /> {explanation}
          </p>
        )}
      </section>

      {cancelled && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">
          Cette demande a été annulée{r.cancellation_reason ? ` : « ${r.cancellation_reason} »` : "."}
        </p>
      )}

      {/* what is expected from me first */}
      {myProposal && <ProposalCard proposal={myProposal} />}

      {!cancelled && view.iAmEligible && view.myAssignments.length === 0 && r.necessity !== "info" && !view.status.isPast && (
        <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-4">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
            <HeartHandshake className="size-5" aria-hidden /> Pouvez-vous aider ?
          </h2>
          <ResponseButtons
            requestId={r.id}
            current={view.myResponse?.response_status ?? null}
            period={view.period}
            splittable={r.splittable}
            proposed={
              view.myResponse?.proposed_starts_at && view.myResponse.proposed_ends_at
                ? { start: Date.parse(view.myResponse.proposed_starts_at), end: Date.parse(view.myResponse.proposed_ends_at) }
                : null
            }
          />
        </section>
      )}

      {!cancelled && view.myAssignments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[17px] font-semibold text-ink">Ma garde</h2>
          <AssignmentActions assignments={view.myAssignments} />
        </section>
      )}

      {plan && (
        <PlanCard
          key={`${r.revision}-${view.assignments.length}-${plan.offers.map((o) => `${o.userId}:${offerIntervals(o).map((i) => `${i.start}-${i.end}`).join("+")}`).join(",")}`}
          requestId={r.id}
          dogName={view.dog?.name ?? "mon chien"}
          period={view.period}
          taken={plan.taken}
          offers={plan.offers}
          rules={plan.rules}
          suggestions={plan.suggestions}
        />
      )}

      {siblings.length > 0 && (
        <section className="flex flex-col gap-1 rounded-[24px] bg-surface p-4" aria-labelledby="same-absence">
          <h2 id="same-absence" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <PawPrint className="size-4" aria-hidden /> Même absence
          </h2>
          <p className="text-[14px] text-ink-3">Une demande par chien, aux mêmes dates :</p>
          <ul className="flex flex-wrap gap-2 pt-1">
            {siblings.map((sib) => (
              <li key={sib.id}>
                <Link href={`/requests/${sib.id}`} className="inline-flex min-h-11 items-center rounded-full bg-surface-2 px-4 text-[15px] font-medium text-ink">
                  {sib.dogName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CareLogSection
        requestId={r.id}
        groupId={groupId}
        me={userId}
        dog={view.dog ? { id: view.dog.id, name: view.dog.name, meals: view.dog.meals, walks: view.dog.walks } : null}
        myAssignments={cancelled ? [] : view.myAssignments}
        iAmCaretaker={view.iAmCaretaker}
        names={Object.fromEntries(view.helpers.map((h) => [h.userId, h.name]))}
        liveAssignments={cancelled ? [] : view.assignments}
      />

      {view.iAmCaretaker && <ProposalsSection proposals={proposals} names={Object.fromEntries(view.helpers.map((h) => [h.userId, h.name]))} />}

      {r.necessity !== "info" && (
        <HelperList
          requestId={r.id}
          canConfirm={view.iAmCaretaker && !cancelled && !view.status.isPast}
          splittable={r.splittable}
          period={view.period}
          gaps={view.coverage.gaps}
          helpers={view.helpers.map((h) => ({
            userId: h.userId,
            name: h.name,
            response: h.response,
            proposed: h.proposed,
            note: h.note,
            availability: h.availability,
            circleRole: h.circleRole,
            assignments: h.assignments.map((a) => ({
              id: a.id,
              start: Date.parse(a.starts_at),
              end: Date.parse(a.ends_at),
              status: a.status,
            })),
          }))}
        />
      )}

      {(r.description || view.dog) && (
        <details className="group rounded-[24px] bg-surface p-4" open={!view.iAmCaretaker}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {view.dog ? `Précisions et passeport ${deName(view.dog.name)}` : "Précisions"}
            <ChevronDown className="size-5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            {r.description && (
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Précisions</h2>
                <p className="mt-1 whitespace-pre-line text-[15px] text-ink-2">{r.description}</p>
              </div>
            )}

            {view.dog && (
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <Info className="size-4" aria-hidden /> À savoir sur {view.dog.name}
                </h2>
                {view.dog.care_notes && <p className="mt-1 whitespace-pre-line text-[15px] text-ink-2">{view.dog.care_notes}</p>}
                <Link
                  href={`/dogs/${view.dog.id}`}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-ink underline underline-offset-2"
                >
                  Voir son passeport
                </Link>
              </div>
            )}
          </div>
        </details>
      )}
      {view.iAmCaretaker && !cancelled && (
        <OwnerActions
          requestId={r.id}
          dogName={view.dog?.name ?? "mon chien"}
          period={view.period}
          showRelaunch={view.status.counts.pending > 0 && !view.status.isPast}
        />
      )}

      {!view.iAmCaretaker && <ReportButton groupId={groupId} targetType="request" targetId={r.id} label="Signaler cette demande" />}
    </div>
  );
}
