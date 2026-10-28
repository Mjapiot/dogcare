import Link from "next/link";
import { Users } from "lucide-react";
import { NECESSITY_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import { responsesSummary } from "@/domain/requests-screen";
import type { RequestView } from "@/domain/views";
import { formatPeriod } from "@/lib/format";
import { CoverageIndicator, DogAvatar, REQUEST_TYPE_ICONS, RequestStatusBadge } from "@/components/domain/request-bits";
import { RelaunchButton } from "@/components/domain/owner-actions";

/** One of my requests: status, coverage and who answered, with a quick "Relancer". */
export function OwnerRequestCard({ view, photoUrl }: { view: RequestView; photoUrl: string | null }) {
  const TypeIcon = REQUEST_TYPE_ICONS[view.request.request_type];
  const info = view.request.necessity === "info";
  return (
    <article className="shadow-soft flex flex-col gap-3 rounded-[28px] bg-surface p-4 ring-1 ring-white/70">
      <Link href={`/requests/${view.request.id}`} className="flex gap-3">
        <DogAvatar name={view.dog?.name ?? "Chien"} photoUrl={photoUrl} size={52} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-[18px] font-semibold tracking-tight text-ink">{view.dog?.name ?? "Chien"}</span>
            <RequestStatusBadge view={view} className="shrink-0 text-[12px]" />
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
            <TypeIcon className="size-3.5" aria-hidden />
            {REQUEST_TYPE_LABELS[view.request.request_type]} · {NECESSITY_LABELS[view.request.necessity]}
          </span>
          <span className="text-[15px] font-medium text-ink">{formatPeriod(view.period.start, view.period.end)}</span>
          {!info && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <Users className="size-3.5" aria-hidden /> {responsesSummary(view.status.counts)}
            </span>
          )}
        </span>
      </Link>
      {!info && <CoverageIndicator coverage={view.coverage} className="text-ink-2" />}
      {!info && view.status.counts.pending > 0 && !view.status.isPast && view.coverage.state !== "full" && (
        <RelaunchButton requestId={view.request.id} dogName={view.dog?.name ?? "mon chien"} period={view.period} size="sm" />
      )}
    </article>
  );
}
