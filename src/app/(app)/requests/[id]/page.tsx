import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HeartHandshake, Info, Users } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot, getRequestGroupId, signDogPhotos } from "@/server/data";
import { buildRequestViews } from "@/domain/views";
import { NECESSITY_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import { formatDuration, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/components/domain/tone";
import { CoverageIndicator, DogAvatar, RequestStatusBadge } from "@/components/domain/request-bits";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";
import { HelperList } from "@/components/domain/helper-list";
import { OwnerActions } from "@/components/domain/owner-actions";
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
  const snapshot = await getGroupSnapshot(groupId, userId, { requestIds: [id] });
  const view = buildRequestViews(snapshot, requestNow())[0];
  if (!view) notFound();
  const photos = await signDogPhotos(view.dog ? [view.dog] : []);
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

      {r.description && (
        <section className="rounded-[24px] bg-surface p-4">
          <h2 className="text-[15px] font-semibold text-ink">Précisions</h2>
          <p className="mt-1 whitespace-pre-line text-[15px] text-ink-2">{r.description}</p>
        </section>
      )}

      {view.dog && (view.dog.care_notes || view.dog.special_needs) && (
        <section className="rounded-[24px] bg-surface p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Info className="size-4" aria-hidden /> À savoir sur {view.dog.name}
          </h2>
          {view.dog.care_notes && <p className="mt-1 whitespace-pre-line text-[15px] text-ink-2">{view.dog.care_notes}</p>}
          {view.dog.special_needs && <p className="mt-2 whitespace-pre-line text-[15px] text-ink-2">{view.dog.special_needs}</p>}
        </section>
      )}

      {!cancelled && view.myAssignments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[17px] font-semibold text-ink">Ma garde</h2>
          <AssignmentActions view={view} />
        </section>
      )}

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
            assignments: h.assignments.map((a) => ({
              id: a.id,
              start: Date.parse(a.starts_at),
              end: Date.parse(a.ends_at),
              status: a.status,
            })),
          }))}
        />
      )}

      {view.iAmCaretaker && !cancelled && (
        <OwnerActions
          requestId={r.id}
          dogName={view.dog?.name ?? "mon chien"}
          period={view.period}
          showRelaunch={view.status.counts.pending > 0 && !view.status.isPast}
        />
      )}
    </div>
  );
}
