import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Footprints, Home, Moon, PawPrint, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatPeriod, formatTime } from "@/lib/format";
import { REQUEST_TYPE_LABELS, type RequestType, type StatusTone } from "@/domain/status";
import type { CoverageResult } from "@/domain/coverage";
import type { RequestView } from "@/domain/views";
import { Avatar } from "@/components/ui/kit";
import { STATUS_ICONS, TONE_CLASSES, TONE_ICONS } from "./tone";

export const REQUEST_TYPE_ICONS = {
  alone_info: Home,
  visit: Footprints,
  care: Moon,
  partial_care: Timer,
} satisfies Record<RequestType, unknown>;

export function RequestStatusBadge({ view, className }: { view: RequestView; className?: string }) {
  const Icon = STATUS_ICONS[view.status.status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold",
        TONE_CLASSES[view.status.tone],
        "ring-1 ring-black/5",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {view.label}
    </span>
  );
}

export function ToneBadge({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold", TONE_CLASSES[tone], className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function DogAvatar({
  name,
  photoUrl,
  size = 40,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt={`Photo de ${name}`}
        width={size}
        height={size}
        unoptimized
        className={cn("shrink-0 rounded-full object-cover ring-2 ring-surface", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-surface ring-2 ring-surface", className)}
      style={{ width: size, height: size }}
    >
      <PawPrint style={{ width: size * 0.45, height: size * 0.45 }} />
    </span>
  );
}

/**
 * Horizontal bar of the requested period: filled = confirmed, hatched =
 * uncovered. Includes a text alternative.
 */
export function CoverageIndicator({ coverage, className }: { coverage: CoverageResult; className?: string }) {
  const total = coverage.totalMs || 1;
  const segments = [
    ...coverage.covered.map((i) => ({ ...i, kind: "covered" as const })),
    ...coverage.gaps.map((i) => ({ ...i, kind: "gap" as const })),
  ].sort((a, b) => a.start - b.start);
  const pct = Math.round((coverage.coveredMs / total) * 100);
  const text =
    coverage.state === "full"
      ? "Toute la période est couverte"
      : coverage.state === "none"
        ? "Aucun créneau confirmé"
        : `${pct} % couvert — reste ${coverage.gaps.map((g) => formatPeriod(g.start, g.end)).join(", ")}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/10" aria-hidden>
        {segments.map((s) => (
          <div
            key={`${s.kind}-${s.start}`}
            className={s.kind === "covered" ? "bg-[var(--tone-covered-ink)]" : "hatch bg-black/10"}
            style={{ width: `${((s.end - s.start) / total) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-[13px] opacity-80">{text}</p>
    </div>
  );
}

/** Big pastel card used on the Today screen and in lists. */
export function CareRequestCard({
  view,
  photoUrl,
  href,
  compact = false,
}: {
  view: RequestView;
  photoUrl?: string | null;
  href?: string;
  compact?: boolean;
}) {
  const TypeIcon = REQUEST_TYPE_ICONS[view.request.request_type];
  const dogName = view.dog?.name ?? "Chien";
  const helpers = view.assignments;
  const content = (
    <div className={cn("relative flex flex-col gap-4 rounded-[28px] p-5", TONE_CLASSES[view.status.tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium opacity-80">
            <TypeIcon className="size-3.5" aria-hidden />
            {REQUEST_TYPE_LABELS[view.request.request_type]}
            {view.request.necessity === "required" && " · indispensable"}
          </p>
          <h3 className={cn("mt-1 font-semibold leading-[1.05] tracking-[-0.02em]", compact ? "text-[22px]" : "text-[28px]")}>
            {dogName}
          </h3>
        </div>
        <div className="flex -space-x-2">
          <DogAvatar name={dogName} photoUrl={photoUrl} size={compact ? 36 : 44} />
          {helpers.slice(0, 2).map((h) => (
            <Avatar key={h.id} name={h.name} className={compact ? "size-9" : "size-11"} />
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[22px] font-medium leading-none tabular">{formatTime(view.period.start)}</p>
          <p className="mt-1 text-[12px] opacity-70">Début</p>
        </div>
        <span className="mb-4 rounded-full bg-black/75 px-3 py-1 text-[12px] font-medium text-white">
          {formatDuration(view.period.end - view.period.start)}
        </span>
        <div className="text-right">
          <p className="text-[22px] font-medium leading-none tabular">{formatTime(view.period.end)}</p>
          <p className="mt-1 text-[12px] opacity-70">Fin</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <RequestStatusBadge view={view} className="bg-white/55" />
        {helpers.length > 0 ? (
          <span className="truncate text-[13px] font-medium">
            {helpers.map((h) => h.name).join(", ")}
          </span>
        ) : view.status.counts.yes > 0 ? (
          <span className="text-[13px] font-medium">{view.status.counts.yes} volontaire{view.status.counts.yes > 1 ? "s" : ""}</span>
        ) : null}
      </div>
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block rounded-[28px] transition-transform active:scale-[0.99]" aria-label={`${dogName}, ${formatPeriod(view.period.start, view.period.end)}, ${view.label}`}>
      {content}
    </Link>
  );
}

/** Compact row used in day sheets and lists. */
export function RequestRow({ view, href }: { view: RequestView; href: string }) {
  const TypeIcon = REQUEST_TYPE_ICONS[view.request.request_type];
  const StatusIcon = STATUS_ICONS[view.status.status];
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl bg-surface p-3 pr-2 transition-colors hover:bg-surface-2"
    >
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", TONE_CLASSES[view.status.tone])}>
        <TypeIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">
          {view.dog?.name ?? "Chien"} · {REQUEST_TYPE_LABELS[view.request.request_type]}
        </span>
        <span className="block truncate text-[13px] text-ink-3">{formatPeriod(view.period.start, view.period.end)}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-ink-2">
          <StatusIcon className="size-3.5" aria-hidden />
          {view.label}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
