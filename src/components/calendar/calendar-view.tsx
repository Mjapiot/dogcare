"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, parseLocalDate, toLocalDate, formatLocalDate as fmtDate, type LocalDate } from "@/domain/time";
import { TONE_LABELS, REQUEST_TYPE_LABELS } from "@/domain/status";
import { formatLocalDate, formatPeriod, formatTime, monthShort, weekdayLabel } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, PillLink, Segmented, Select } from "@/components/ui/kit";
import { REQUEST_TYPE_ICONS } from "@/components/domain/request-bits";
import { STATUS_ICONS, TONE_CLASSES, TONE_ICONS } from "@/components/domain/tone";
import type { CalendarDay, StatusFilter } from "./types";
import { CalendarSearch } from "lucide-react";

type Props = {
  view: "2w" | "month";
  anchor: LocalDate;
  today: LocalDate;
  days: CalendarDay[];
  filters: { status: StatusFilter; dog: string | null; owner: string | null };
  dogs: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
};

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Tout" },
  { value: "organize", label: "À organiser" },
  { value: "uncovered", label: "Sans solution" },
  { value: "confirmed", label: "Couverts" },
  { value: "info", label: "Infos" },
];

function shiftMonth(date: LocalDate, delta: number): LocalDate {
  const { year, month } = parseLocalDate(date);
  const m = month - 1 + delta;
  return fmtDate(year + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1, 1);
}

export function CalendarView({ view, anchor, today, days, filters, dogs, owners }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // keep only the date: the sheet always shows the latest data for that day
  const [selectedDate, setSelectedDate] = useState<LocalDate | null>(null);
  const selected = selectedDate ? (days.find((d) => d.date === selectedDate) ?? null) : null;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const prevAnchor = view === "month" ? shiftMonth(anchor, -1) : addDays(anchor, -14);
  const nextAnchor = view === "month" ? shiftMonth(anchor, 1) : addDays(anchor, 14);
  const hasItems = days.some((d) => d.items.length > 0);
  // the link is only useful when today is not in the period on screen
  const showsToday =
    view === "month" ? anchor.slice(0, 7) === today.slice(0, 7) : days.some((d) => d.date === today);
  const activeFilterCount = (filters.dog ? 1 : 0) + (filters.owner ? 1 : 0);

  const title =
    view === "month"
      ? formatLocalDate(anchor, { month: "long", year: "numeric" })
      : `${formatLocalDate(days[0].date, { day: "numeric", month: "short" })} – ${formatLocalDate(days[days.length - 1].date, { day: "numeric", month: "short" })}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-full bg-surface px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => setParams({ start: prevAnchor })}
          className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
          aria-label={view === "month" ? "Mois précédent" : "Deux semaines précédentes"}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <div className="flex flex-col items-center">
          {view === "month" ? (
            <p className="flex items-baseline gap-4 text-ink" aria-live="polite">
              <span className="hidden text-[20px] font-medium text-ink-3/60 min-[380px]:inline">{monthShort(prevAnchor)}</span>
              <span className="text-[24px] font-semibold tracking-tight">{monthShort(anchor)}</span>
              <span className="hidden text-[20px] font-medium text-ink-3/60 min-[380px]:inline">{monthShort(nextAnchor)}</span>
              <span className="sr-only">{title}</span>
            </p>
          ) : (
            <p className="text-[17px] font-semibold capitalize text-ink" aria-live="polite">
              {title}
            </p>
          )}
          {!showsToday && (
            <button type="button" onClick={() => setParams({ start: null })} className="text-[12px] font-medium text-ink-3 underline-offset-2 hover:underline">
              Revenir à aujourd&apos;hui
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setParams({ start: nextAnchor })}
          className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
          aria-label={view === "month" ? "Mois suivant" : "Deux semaines suivantes"}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Segmented
          label="Période affichée"
          value={view}
          onChange={(v) => setParams({ view: v === "2w" ? null : v, start: null })}
          options={[
            { value: "2w", label: "2 semaines" },
            { value: "month", label: "Mois" },
          ]}
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="relative flex size-11 items-center justify-center rounded-full bg-surface-2"
          aria-label={`Filtres${activeFilterCount ? ` (${activeFilterCount} actif${activeFilterCount > 1 ? "s" : ""})` : ""}`}
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          {activeFilterCount > 0 && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-[#b3261e]" aria-hidden />}
        </button>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Filtrer par statut">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filters.status === c.value}
            onClick={() => setParams({ status: c.value })}
            className={cn(
              "min-h-11 shrink-0 rounded-full px-4 text-[14px] font-medium transition-colors",
              filters.status === c.value ? "bg-ink text-surface" : "bg-surface text-ink-2",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {view === "2w" ? (
        <TwoWeeks days={days} today={today} onSelect={(d) => setSelectedDate(d.date)} />
      ) : (
        <MonthGrid days={days} anchor={anchor} today={today} onSelect={(d) => setSelectedDate(d.date)} />
      )}

      {!hasItems && (
        <EmptyState
          icon={CalendarSearch}
          title={filters.status === "all" && !activeFilterCount ? "Rien de prévu sur cette période" : "Aucun besoin ne correspond aux filtres"}
          description="Les besoins de garde de tous les chiens du groupe apparaissent ici."
          action={
            <PillLink href="/requests/new" size="md">
              <Plus className="size-4" aria-hidden /> Ajouter un besoin
            </PillLink>
          }
        />
      )}

      <Legend />

      <DaySheet day={selected} onClose={() => setSelectedDate(null)} />

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Filtres</SheetTitle>
            <SheetDescription>Affinez le calendrier par chien ou par propriétaire.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
              Chien
              <Select value={filters.dog ?? ""} onChange={(e) => setParams({ dog: e.target.value || null })}>
                <option value="">Tous les chiens</option>
                {dogs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
              Propriétaire
              <Select value={filters.owner ?? ""} onChange={(e) => setParams({ owner: e.target.value || null })}>
                <option value="">Tous les propriétaires</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </label>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="min-h-11 rounded-full text-[15px] font-medium text-ink-2 underline-offset-2 hover:underline"
                onClick={() => setParams({ dog: null, owner: null })}
              >
                Effacer les filtres
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Time label of an item for one given day (multi-day items are split). */
function timeOnDay(item: { start: number; end: number }, date: LocalDate): string {
  const startsToday = toLocalDate(item.start) === date;
  const endsToday = toLocalDate(item.end - 1) === date;
  if (startsToday && endsToday) return `${formatTime(item.start)}–${formatTime(item.end)}`;
  if (startsToday) return `dès ${formatTime(item.start)}`;
  if (endsToday) return `jusqu'à ${formatTime(item.end)}`;
  return "toute la journée";
}

function TwoWeeks({ days, today, onSelect }: { days: CalendarDay[]; today: LocalDate; onSelect: (d: CalendarDay) => void }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {days.map((day) => {
        const past = day.date < today;
        const isToday = day.date === today;
        const empty = day.items.length === 0;
        const ToneIcon = TONE_ICONS[day.tone];
        if (empty) {
          return (
            <li key={day.date}>
              <button
                type="button"
                onClick={() => onSelect(day)}
                className={cn(
                  "flex min-h-13 w-full items-center gap-3 rounded-[20px] bg-surface/70 px-4 text-left text-ink transition-transform active:scale-[0.99]",
                  past && "opacity-60",
                  isToday && "ring-2 ring-ink ring-offset-2 ring-offset-canvas",
                )}
                aria-label={`${weekdayLabel(day.date)} ${formatLocalDate(day.date, { day: "numeric", month: "long" })}${isToday ? ", aujourd'hui" : ""} : aucun besoin`}
              >
                <span className="w-[92px] shrink-0 text-[15px] font-medium">
                  {weekdayLabel(day.date, "short").replace(".", "")} <span className="tabular">{Number(day.date.slice(8, 10))}</span>
                </span>
                <span className="flex flex-1 items-center gap-1.5 text-[14px] text-ink-3">
                  <Plus className="size-4" aria-hidden /> Aucun besoin
                </span>
              </button>
            </li>
          );
        }
        return (
          <li key={day.date}>
            <button
              type="button"
              onClick={() => onSelect(day)}
              className={cn(
                "flex w-full items-stretch gap-4 rounded-[28px] p-4 text-left transition-transform active:scale-[0.99]",
                TONE_CLASSES[day.tone],
                past && "opacity-60",
                isToday && "ring-2 ring-ink ring-offset-2 ring-offset-canvas",
              )}
              aria-label={`${weekdayLabel(day.date)} ${formatLocalDate(day.date, { day: "numeric", month: "long" })}${isToday ? ", aujourd'hui" : ""} : ${
                empty ? "aucun besoin" : `${day.items.length} besoin${day.items.length > 1 ? "s" : ""}, ${TONE_LABELS[day.tone]}`
              }`}
            >
              <div className="w-[92px] shrink-0">
                <p className="text-[14px] font-medium opacity-80">{weekdayLabel(day.date)}</p>
                <p className="text-[44px] font-medium leading-[0.95] tracking-[-0.04em] tabular">{day.date.slice(8, 10)}</p>
                <p className="text-[30px] font-medium leading-[0.95] tracking-[-0.04em]">{monthShort(day.date)}</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 border-l border-current/25 pl-3">
                {empty ? (
                  <p className="flex items-center gap-1.5 text-[14px] text-ink-3">
                    <Plus className="size-4" aria-hidden /> Aucun besoin
                  </p>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <ToneIcon className="size-4" aria-hidden />
                      {TONE_LABELS[day.tone]}
                    </p>
                    {day.items.slice(0, 3).map((item) => {
                      const TypeIcon = REQUEST_TYPE_ICONS[item.type];
                      return (
                        <span key={item.id} className="flex min-w-0 items-center gap-1.5 rounded-xl bg-black/[0.07] px-2.5 py-1.5 text-[13px] font-medium">
                          <TypeIcon className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">
                            {item.dogName} · {timeOnDay(item, day.date)}
                          </span>
                        </span>
                      );
                    })}
                    {day.items.length > 3 && <span className="text-[13px] font-medium opacity-80">+ {day.items.length - 3} autre{day.items.length > 4 ? "s" : ""}</span>}
                  </>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function MonthGrid({
  days,
  anchor,
  today,
  onSelect,
}: {
  days: CalendarDay[];
  anchor: LocalDate;
  today: LocalDate;
  onSelect: (d: CalendarDay) => void;
}) {
  const month = anchor.slice(0, 7);
  const weekdays = ["L", "M", "M", "J", "V", "S", "D"];
  const weeks = useMemo(() => {
    const out: CalendarDay[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);
  return (
    <div className="rounded-[28px] bg-surface p-3">
      <div className="grid grid-cols-7 pb-2 text-center text-[12px] font-semibold text-ink-3" aria-hidden>
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div role="grid" aria-label="Mois" className="flex flex-col gap-1">
        {weeks.map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day) => {
              const inMonth = day.date.startsWith(month);
              const empty = day.items.length === 0;
              const Icon = TONE_ICONS[day.tone];
              return (
                <button
                  role="gridcell"
                  type="button"
                  key={day.date}
                  onClick={() => onSelect(day)}
                  className={cn(
                    "flex aspect-square min-h-11 flex-col items-center justify-center gap-0.5 rounded-2xl text-[15px] font-medium tabular transition-transform active:scale-95",
                    empty ? "text-ink" : TONE_CLASSES[day.tone],
                    !inMonth && "opacity-35",
                    day.date === today && "ring-2 ring-ink",
                  )}
                  aria-label={`${formatLocalDate(day.date, { weekday: "long", day: "numeric", month: "long" })}${
                    empty ? ", aucun besoin" : `, ${day.items.length} besoin${day.items.length > 1 ? "s" : ""}, ${TONE_LABELS[day.tone]}`
                  }`}
                >
                  {Number(day.date.slice(8, 10))}
                  {!empty && <Icon className="size-3.5" aria-hidden />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  const tones = ["covered", "pending", "uncovered", "partial", "info"] as const;
  return (
    <details className="rounded-2xl bg-surface px-4 py-3 text-[14px]">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink-2">Que signifient les couleurs ?</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {tones.map((t) => {
          const Icon = TONE_ICONS[t];
          return (
            <li key={t} className="flex items-center gap-2">
              <span className={cn("flex size-7 items-center justify-center rounded-lg", TONE_CLASSES[t])}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-ink-2">
                <strong className="font-semibold text-ink">{TONE_LABELS[t]}</strong>
                {t === "covered" && " — toute la période a un gardien confirmé"}
                {t === "pending" && " — en attente de réponses ou de confirmation"}
                {t === "uncovered" && " — indispensable et tout le monde a répondu non"}
                {t === "partial" && " — une partie du besoin reste sans gardien"}
                {t === "info" && " — le chien sera seul, pour information"}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function DaySheet({ day, onClose }: { day: CalendarDay | null; onClose: () => void }) {
  return (
    <Sheet open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-[28px] border-0 pb-safe">
        {day && (
          <>
            <SheetHeader>
              <SheetTitle className="text-2xl font-semibold capitalize tracking-tight">
                {formatLocalDate(day.date, { weekday: "long", day: "numeric", month: "long" })}
              </SheetTitle>
              <SheetDescription>
                {day.items.length === 0 ? "Aucun besoin ce jour-là." : `${day.items.length} besoin${day.items.length > 1 ? "s" : ""}`}
              </SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col gap-2 overflow-y-auto px-4">
              {day.items.map((item) => {
                const TypeIcon = REQUEST_TYPE_ICONS[item.type];
                const StatusIcon = STATUS_ICONS[item.status];
                return (
                  <li key={item.id}>
                    <Link
                      href={`/requests/${item.id}`}
                      className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3"
                      onClick={onClose}
                    >
                      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", TONE_CLASSES[item.tone])}>
                        <TypeIcon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink">
                          {item.dogName} · {REQUEST_TYPE_LABELS[item.type]}
                        </span>
                        <span className="block truncate text-[13px] text-ink-3">{formatPeriod(item.start, item.end)}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-ink-2">
                          <StatusIcon className="size-3.5" aria-hidden />
                          {item.label}
                          {item.helpers.length > 0 && ` · ${item.helpers.join(", ")}`}
                        </span>
                      </span>
                      <ChevronRight className="size-5 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="p-4">
              <PillLink href={`/requests/new?date=${day.date}`} className="w-full" onClick={onClose}>
                <Plus className="size-4" aria-hidden /> Ajouter un besoin ce jour
              </PillLink>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
