import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, HeartHandshake, IdCard } from "lucide-react";
import { getProfile, requireUserId } from "@/server/session";
import { getMyInvitedRequests, signDogPhotos } from "@/server/data";
import { buildInvitedView } from "@/domain/invited";
import { NECESSITY_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import { uuid } from "@/lib/validation";
import { formatDuration, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requestNow } from "@/server/clock";
import { TONE_CLASSES } from "@/components/domain/tone";
import { CoverageIndicator, DogAvatar, ToneBadge } from "@/components/domain/request-bits";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";
import { ReportButton } from "@/components/domain/report-button";

export const metadata: Metadata = { title: "Demande" };

/**
 * A request seen by a person of the dog's circle asked on it, outside the
 * group: the need, whether it is already covered, their answer and their
 * gardes. Never the group, its members or their answers.
 */
export default async function CircleRequestPage({ params }: PageProps<"/circle/requests/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect(`/onboarding?next=/circle/requests/${id}`);
  const [row] = await getMyInvitedRequests(id);
  if (!row) notFound();
  const view = buildInvitedView(row, requestNow());
  const photos = await signDogPhotos([{ id: row.dog_id, photo_path: row.dog_photo_path }]);
  const r = view.request;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-safe pb-safe">
      <div className="flex flex-col gap-5 pt-4 pb-10">
        <Link href="/circle" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
          <ArrowLeft className="size-4" aria-hidden /> Chiens confiés
        </Link>

        <section className={cn("flex flex-col gap-4 rounded-[32px] p-5", TONE_CLASSES[view.tone])}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium opacity-80">
                {REQUEST_TYPE_LABELS[r.request_type]} · {NECESSITY_LABELS[r.necessity]}
              </p>
              <h1 className="mt-1 text-[40px] font-semibold leading-[1] tracking-[-0.04em]">{r.dog_name}</h1>
              <p className="mt-1 text-[14px] opacity-80">Pour {r.owner_names.join(", ") || "un ancien membre"}</p>
            </div>
            <DogAvatar name={r.dog_name} photoUrl={photos[r.dog_id]} size={64} />
          </div>
          <div>
            <p className="text-[19px] font-semibold">{formatPeriod(view.period.start, view.period.end)}</p>
            <p className="text-[14px] opacity-80">Durée : {formatDuration(view.period.end - view.period.start)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={view.tone} label={view.label} className="bg-white/55" />
            {view.isPast && !view.cancelled && <span className="rounded-full bg-black/10 px-2.5 py-1 text-[13px] font-medium">Passée</span>}
          </div>
          {r.necessity !== "info" && !view.cancelled && <CoverageIndicator coverage={view.coverage} />}
        </section>

        {view.cancelled && (
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

        {!view.cancelled && r.my_assignments.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-[17px] font-semibold text-ink">Ma garde</h2>
            <AssignmentActions assignments={r.my_assignments} />
          </section>
        )}

        {!view.cancelled && r.my_assignments.length === 0 && r.necessity !== "info" && !view.isPast && (
          <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-4">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
              <HeartHandshake className="size-5" aria-hidden /> Pouvez-vous aider ?
            </h2>
            {view.coverage.state === "full" && !r.my_response && (
              <p className="text-[14px] text-ink-3">Toute la période est déjà couverte : vous pouvez tout de même proposer votre aide.</p>
            )}
            <ResponseButtons
              requestId={r.id}
              current={r.my_response?.response_status ?? null}
              period={view.period}
              splittable={r.splittable}
              proposed={
                r.my_response?.proposed_starts_at && r.my_response.proposed_ends_at
                  ? { start: Date.parse(r.my_response.proposed_starts_at), end: Date.parse(r.my_response.proposed_ends_at) }
                  : null
              }
            />
            <p className="text-[13px] text-ink-3">
              « Oui » est une proposition : la garde n&apos;est confiée que lorsqu&apos;un responsable la confirme.
            </p>
          </section>
        )}

        <Link
          href={`/circle/${r.dog_id}`}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink underline underline-offset-2"
        >
          <IdCard className="size-4" aria-hidden /> Voir le passeport de {r.dog_name}
        </Link>

        <ReportButton
          groupId={r.group_id}
          targetType="request"
          targetId={r.id}
          label="Signaler cette demande"
          description="Le signalement est transmis aux administrateurs du groupe et à l'équipe Dogcare, sans votre nom. Pour ne plus recevoir les demandes de ce chien, vous pouvez aussi quitter son cercle depuis son passeport."
        />
      </div>
    </main>
  );
}
