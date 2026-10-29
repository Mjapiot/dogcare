"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarSearch, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, parseLocalDate, formatLocalDate as fmtDate, type LocalDate } from "@/domain/time";
import type { CalFocus, CalItem, CalScope } from "@/domain/calendar";
import type { SlotKey } from "@/domain/config";
import { formatLocalDate } from "@/lib/format";
import { EmptyState, PillLink, Segmented, Select } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TONE_CLASSES, TONE_ICONS } from "@/components/domain/tone";
import { Agenda } from "./agenda";
import { MonthGrid } from "./month-grid";
import { DaySheet } from "./day-sheet";
import { Legend } from "./legend";

type Props = {
  view: "agenda" | "month";
  anchor: LocalDate;
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  items: CalItem[];
  summary: { uncovered: number; organize: number; confirmed: number };
  scope: CalScope;
  focus: CalFocus;
  filters: { dog: string | null; owner: string | null };
  dogs: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  available: Record<LocalDate, Record<SlotKey, string[]>>;
};

const SCOPES: Array<{ value: CalScope; label: string }> = [
  { value: "all", label: "Tout" },
  { value: "mine", label: "Mes chiens" },
  { value: "guards", label: "Mes gardes" },
];

const EASE = [0.32, 0.72, 0, 1] as const;

function shiftMonth(date: LocalDate, delta: number): LocalDate {
  const { year, month } = parseLocalDate(date);
  const m = month - 1 + delta;
  return fmtDate(year + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1, 1);
}

export function CalendarView({ view, anchor, from, to, today, items, summary, scope, focus, filters, dogs, owners, available }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<LocalDate | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // direction of the last move, for the slide animation
  const [direction, setDirection] = useState(0);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const span = view === "month" ? 0 : 28;
  const prevAnchor = view === "month" ? shiftMonth(anchor, -1) : addDays(anchor, -span);
  const nextAnchor = view === "month" ? shiftMonth(anchor, 1) : addDays(anchor, span);
  const go = (delta: -1 | 1) => {
    setDirection(delta);
    setParams({ start: delta < 0 ? prevAnchor : nextAnchor });
  };
  const showsToday = view === "month" ? anchor.slice(0, 7) === today.slice(0, 7) : from === today;
  const activeFilterCount = (filters.dog ? 1 : 0) + (filters.owner ? 1 : 0);
  const title =
    view === "month"
      ? formatLocalDate(anchor, { month: "long", year: "numeric" })
      : `${formatLocalDate(from, { day: "numeric", month: "short" })} – ${formatLocalDate(to, { day: "numeric", month: "short" })}`;

  const focusChips: Array<{ value: CalFocus; count: number; label: string; tone: "uncovered" | "pending" | "covered" }> = [
    { value: "uncovered", count: summary.uncovered, label: "sans solution", tone: "uncovered" },
    { value: "organize", count: summary.organize, label: "à organiser", tone: "pending" },
    { value: "confirmed", count: summary.confirmed, label: summary.confirmed > 1 ? "couverts" : "couvert", tone: "covered" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          className="glass flex size-11 shrink-0 items-center justify-center rounded-full"
          aria-label={view === "month" ? "Mois précédent" : "Quatre semaines précédentes"}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <p className="truncate text-[22px] font-semibold tracking-tight text-ink first-letter:uppercase" aria-live="polite">
            {title}
          </p>
          {!showsToday && (
            <button
              type="button"
              onClick={() => {
                setDirection(0);
                setParams({ start: null });
              }}
              className="min-h-6 text-[13px] font-medium text-ink-3 underline underline-offset-2"
            >
              Revenir à aujourd&apos;hui
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          className="glass flex size-11 shrink-0 items-center justify-center rounded-full"
          aria-label={view === "month" ? "Mois suivant" : "Quatre semaines suivantes"}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Segmented
          label="Affichage"
          value={view}
          onChange={(v) => {
            setDirection(0);
            setParams({ view: v === "agenda" ? null : v, start: null });
          }}
          options={[
            { value: "agenda", label: "Agenda" },
            { value: "month", label: "Mois" },
          ]}
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2"
          aria-label={`Filtres${activeFilterCount ? ` (${activeFilterCount} actif${activeFilterCount > 1 ? "s" : ""})` : ""}`}
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          {activeFilterCount > 0 && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-[#b3261e]" aria-hidden />}
        </button>
      </div>

      <div className="flex gap-2" role="group" aria-label="Afficher">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={scope === s.value}
            onClick={() => setParams({ scope: s.value })}
            className={cn(
              "min-h-11 flex-1 rounded-full px-2 text-[14px] font-medium transition-colors",
              scope === s.value ? "bg-ink text-surface" : "bg-surface text-ink-2",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* summary of the period: each count filters the calendar */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Résumé de la période">
        {focusChips.map((c) => {
          const Icon = TONE_ICONS[c.tone];
          const active = focus === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={active}
              onClick={() => setParams({ focus: active ? null : c.value })}
              className={cn(
                "flex min-h-14 flex-col items-start justify-center rounded-2xl px-3 py-2 text-left transition-shadow",
                c.count > 0 || active ? TONE_CLASSES[c.tone] : "glass text-ink-3",
                active && "ring-2 ring-ink",
              )}
            >
              <span className="flex items-center gap-1.5 text-[20px] font-semibold leading-none tabular">
                <Icon className="size-4" aria-hidden />
                {c.count}
              </span>
              <span className="mt-1 text-[12px] font-medium leading-tight">{c.label}</span>
            </button>
          );
        })}
      </div>
      {focus !== "all" && (
        <button
          type="button"
          onClick={() => setParams({ focus: null })}
          className="-mt-2 inline-flex min-h-11 items-center gap-1 self-start rounded-full px-2 text-[14px] font-medium text-ink-2"
        >
          <X className="size-4" aria-hidden /> Tout afficher
        </button>
      )}

      <div className="overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={`${view}-${from}`}
            custom={direction}
            initial={{ opacity: 0, x: direction * 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -48 }}
            transition={{ duration: 0.35, ease: EASE }}
            drag="x"
            dragSnapToOrigin
            dragElastic={0.15}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80) go(1);
              else if (info.offset.x > 80) go(-1);
            }}
            style={{ touchAction: "pan-y" }}
          >
            {view === "agenda" ? (
              <Agenda items={items} from={from} to={to} today={today} onSelectDay={setSelectedDate} />
            ) : (
              <MonthGrid items={items} from={from} to={to} anchor={anchor} today={today} onSelectDay={setSelectedDate} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length === 0 && (
        <EmptyState
          icon={CalendarSearch}
          title={focus === "all" && scope === "all" && !activeFilterCount ? "Rien de prévu sur cette période" : "Aucun besoin ne correspond à ce filtre"}
          description="Les besoins de garde de tous les chiens du groupe apparaissent ici."
          action={
            <PillLink href="/requests/new" size="md">
              <Plus className="size-4" aria-hidden /> Ajouter un besoin
            </PillLink>
          }
        />
      )}

      <Legend />

      <DaySheet
        date={selectedDate}
        items={items}
        available={selectedDate ? available[selectedDate] : undefined}
        onClose={() => setSelectedDate(null)}
      />

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
