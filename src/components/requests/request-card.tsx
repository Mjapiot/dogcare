import Link from "next/link";
import { HeartHandshake, NotebookPen } from "lucide-react";
import { NECESSITY_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import type { ScreenItem } from "@/domain/requests-screen";
import { deName, formatDuration, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PillLink } from "@/components/ui/kit";
import { DogAvatar, REQUEST_TYPE_ICONS } from "@/components/domain/request-bits";
import { STATUS_ICONS, TONE_CLASSES, TONE_ICONS } from "@/components/domain/tone";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";

/**
 * A request on the "Demandes" screen (my groups or a circle I am in): the
 * need at a glance, then answering in one tap, or my garde's actions.
 */
export function RequestCard({
  item,
  photoUrl,
  mode,
  now,
}: {
  item: ScreenItem;
  photoUrl: string | null;
  mode: "answer" | "guard";
  now: number;
}) {
  const TypeIcon = REQUEST_TYPE_ICONS[item.requestType];
  const StatusIcon = item.status ? STATUS_ICONS[item.status] : TONE_ICONS[item.tone];
  const ongoing = item.myAssignments.some(
    (a) => a.status === "confirmed" && new Date(a.starts_at).getTime() <= now && now < new Date(a.ends_at).getTime(),
  );

  return (
    <article className="shadow-soft flex flex-col gap-3 rounded-[28px] bg-surface p-4 ring-1 ring-white/70">
      <Link href={item.href} className="flex gap-3">
        <DogAvatar name={item.dogName} photoUrl={photoUrl} size={52} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-[18px] font-semibold tracking-tight text-ink">{item.dogName}</span>
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", TONE_CLASSES[item.tone])}>
              <StatusIcon className="size-3.5" aria-hidden />
              {item.label}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
            <TypeIcon className="size-3.5" aria-hidden />
            {REQUEST_TYPE_LABELS[item.requestType]} · {NECESSITY_LABELS[item.necessity]}
          </span>
          <span className="text-[15px] font-medium text-ink">
            {formatPeriod(item.period.start, item.period.end)}
            <span className="font-normal text-ink-3"> · {formatDuration(item.period.end - item.period.start)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
            <span>Pour {item.ownerNames.join(", ") || "un ancien membre"}</span>
            {item.source === "circle" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 font-medium text-ink-2">
                <HeartHandshake className="size-3.5" aria-hidden /> Cercle {deName(item.dogName)}
              </span>
            )}
          </span>
          {item.description && <span className="line-clamp-2 text-[14px] text-ink-2">« {item.description} »</span>}
        </span>
      </Link>

      {mode === "guard" ? (
        <>
          <AssignmentActions assignments={item.myAssignments} />
          {ongoing && (
            <PillLink href={`${item.href}#carnet`} variant="soft" size="sm">
              <NotebookPen className="size-4" aria-hidden /> Ouvrir le carnet
            </PillLink>
          )}
        </>
      ) : (
        item.answerable && (
          <ResponseButtons
            requestId={item.requestId}
            current={item.myResponse?.status ?? null}
            period={item.period}
            splittable={item.splittable}
            proposed={item.myResponse?.proposed ?? null}
            size="sm"
          />
        )
      )}
    </article>
  );
}
