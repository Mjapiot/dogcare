import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { agendaRows, type CalItem } from "@/domain/calendar";
import { REQUEST_TYPE_LABELS } from "@/domain/status";
import type { LocalDate } from "@/domain/time";
import { formatLocalDate, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { REQUEST_TYPE_ICONS } from "@/components/domain/request-bits";
import { STATUS_ICONS, TONE_CLASSES } from "@/components/domain/tone";

/** Agenda: one card per request on its first day; quiet days grouped in one line. */
export function Agenda({
  items,
  from,
  to,
  today,
  onSelectDay,
}: {
  items: CalItem[];
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  onSelectDay: (date: LocalDate) => void;
}) {
  const rows = agendaRows(items, from, to);
  const dayLabel = (d: LocalDate) => formatLocalDate(d, { weekday: "short", day: "numeric", month: "short" });
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((row) =>
        row.kind === "quiet" ? (
          <li key={`q-${row.from}`}>
            <button
              type="button"
              onClick={() => onSelectDay(row.from)}
              className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-2 text-left text-[14px] text-ink-3"
            >
              <span className="font-medium text-ink-2">{row.from === row.to ? dayLabel(row.from) : `${dayLabel(row.from)} → ${dayLabel(row.to)}`}</span>
              <span className="min-w-0 flex-1 truncate">
                {row.continuing.length ? `· en cours : ${row.continuing.map((i) => i.dogName).join(", ")}` : "· rien de prévu"}
              </span>
              <Plus className="size-4 shrink-0" aria-hidden />
            </button>
          </li>
        ) : (
          <li key={row.date} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onSelectDay(row.date)}
              className="flex min-h-11 items-center gap-2 self-start px-1 text-[15px] font-semibold text-ink first-letter:uppercase"
            >
              {formatLocalDate(row.date, { weekday: "long", day: "numeric", month: "long" })}
              {row.date === today && <span className="rounded-full bg-ink px-2 py-0.5 text-[12px] font-semibold normal-case text-surface">Aujourd&apos;hui</span>}
            </button>
            {row.items.map((item) => (
              <AgendaCard key={item.id} item={item} />
            ))}
            {row.continuing.length > 0 && (
              <p className="px-1 text-[13px] text-ink-3">En cours ce jour : {row.continuing.map((i) => i.dogName).join(", ")}</p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

function AgendaCard({ item }: { item: CalItem }) {
  const TypeIcon = REQUEST_TYPE_ICONS[item.type];
  const StatusIcon = STATUS_ICONS[item.status];
  const info = item.status === "informational";
  return (
    <Link
      href={`/requests/${item.id}`}
      className={cn("shadow-soft flex items-center gap-3 rounded-[24px] bg-surface p-3 ring-1 ring-white/70", item.isPast && "opacity-60")}
    >
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", TONE_CLASSES[item.tone])}>
        <TypeIcon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[16px] font-semibold text-ink">
          {item.dogName} <span className="font-normal text-ink-3">· {REQUEST_TYPE_LABELS[item.type]}</span>
        </span>
        <span className="text-[14px] text-ink-2">{formatPeriod(item.start, item.end)}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", TONE_CLASSES[item.tone])}>
            <StatusIcon className="size-3.5" aria-hidden />
            {item.label}
          </span>
          {item.helpers.length > 0 && <span className="text-ink-3">Gardé par {item.helpers.join(", ")}</span>}
        </span>
        {!info && item.covered > 0 && item.covered < 1 && (
          <span className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-black/10" aria-label={`${Math.round(item.covered * 100)} % couvert`}>
            <span className="bg-[var(--tone-covered-ink)]" style={{ width: `${item.covered * 100}%` }} />
          </span>
        )}
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
