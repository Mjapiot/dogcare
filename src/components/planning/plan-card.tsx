"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Moon, RotateCcw, Sparkles, UserRound } from "lucide-react";
import { confirmPlan } from "@/server/actions/requests";
import {
  consecutiveNights,
  countHandoffs,
  nightAnchors,
  proposePlan,
  type PlanOffer,
  type PlanRules,
} from "@/domain/planner";
import { subtractIntervals, mergeIntervals, intersect, type Interval } from "@/domain/intervals";
import { formatPeriod } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RelaunchButton } from "@/components/domain/owner-actions";

/** One hue per helper on the timeline; names are always written next to it. */
const HUES = ["bg-[#7d9a7e]", "bg-[#c9a27e]", "bg-[#8f8bb8]", "bg-[#d08b74]", "bg-[#6f9fb0]", "bg-[#b59a5a]"];

type Piece = { userId: string | null; start: number; end: number; reason: string };

/**
 * "Proposition de planning": the app proposes how to split what is left of
 * the request among the volunteers; the owner adjusts it if needed, then
 * confirms every slice at once.
 */
export function PlanCard({
  requestId,
  dogName,
  period,
  taken,
  offers,
  rules,
  suggestions,
}: {
  requestId: string;
  dogName: string;
  period: Interval;
  taken: Interval[];
  offers: PlanOffer[];
  rules: PlanRules;
  /** Members who did not answer but declared themselves available, by hole start. */
  suggestions: Record<string, string[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const proposal = useMemo(() => proposePlan({ period, taken, offers, rules }), [period, taken, offers, rules]);
  const initial = useMemo<Piece[]>(
    () =>
      [...proposal.slices.map((s) => ({ userId: s.userId, start: s.start, end: s.end, reason: s.reason })), ...proposal.holes.map((h) => ({ userId: null, start: h.start, end: h.end, reason: h.reason }))].sort(
        (a, b) => a.start - b.start,
      ),
    [proposal],
  );
  const [pieces, setPieces] = useState<Piece[]>(initial);
  // the sheet keeps showing the piece it was opened for while it closes
  const [editing, setEditing] = useState<{ index: number; piece: Piece } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const adjusted = pieces !== initial;

  const names = useMemo(() => new Map(offers.map((o) => [o.userId, o.name])), [offers]);
  const hue = useMemo(() => new Map(offers.map((o, i) => [o.userId, HUES[i % HUES.length]])), [offers]);
  const available = useMemo(
    () =>
      new Map(
        offers.map((o) => {
          const inside = intersect(o.offer, period);
          return [o.userId, inside ? subtractIntervals(inside, mergeIntervals(o.busy)) : []];
        }),
      ),
    [offers, period],
  );

  const slices = pieces.filter((p): p is Piece & { userId: string } => p.userId !== null);
  const openMs = proposal.openMs;
  const coveredMs = slices.reduce((s, p) => s + (p.end - p.start), 0);
  const nights = consecutiveNights(slices, period);
  const overNights = Object.entries(nights).filter(([, n]) => n > rules.maxConsecutiveNights);
  const helpers = new Set(slices.map((s) => s.userId)).size;
  const handoffs = countHandoffs(slices);
  const anchors = nightAnchors(period);
  const nightsIn = (p: Interval) => anchors.filter((a) => a >= p.start && a < p.end).length;
  const total = period.end - period.start || 1;

  const reassign = (index: number, userId: string | null) => {
    setPieces((prev) => {
      const next = prev.map((p, i) => (i === index ? { ...p, userId, reason: userId ? "Choisi par vous" : "Laissé à couvrir" } : p));
      // contiguous pieces of the same person become one slice
      const merged: Piece[] = [];
      for (const p of next) {
        const last = merged.at(-1);
        if (last && last.userId === p.userId && last.end === p.start) {
          last.end = p.end;
          last.reason = "Ajusté par vous";
        } else merged.push({ ...p });
      }
      return merged;
    });
    setSheetOpen(false);
  };

  const confirm = () =>
    startTransition(async () => {
      const r = await confirmPlan(
        requestId,
        slices.map((s) => ({ userId: s.userId, start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
      );
      if (!r.ok) {
        toast.error(`${r.error} La proposition est recalculée.`);
        router.refresh();
        return;
      }
      hapticSuccess();
      toast.success(`Planning confirmé : ${r.data.count} garde${r.data.count > 1 ? "s" : ""}, chacun est prévenu`);
      router.refresh();
    });

  const editingPiece = editing?.piece ?? null;
  const choices = editingPiece
    ? offers.filter((o) => available.get(o.userId)?.some((a) => a.start <= editingPiece.start && editingPiece.end <= a.end))
    : [];

  return (
    <section className="shadow-soft flex flex-col gap-4 rounded-[28px] bg-surface p-4 ring-1 ring-white/70" aria-labelledby="plan-title">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage/15 text-ink">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="plan-title" className="text-[17px] font-semibold tracking-tight text-ink">
            Proposition de planning
          </h2>
          <p className="text-[14px] text-ink-3">
            Parmi les « Oui » reçus. Rien n&apos;est confirmé tant que vous ne validez pas.
          </p>
        </div>
      </div>

      {/* timeline of the whole request: slices, holes, gardes already confirmed */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/10" aria-hidden>
        {[...taken.map((t) => ({ userId: "__taken", start: t.start, end: t.end })), ...pieces]
          .sort((a, b) => a.start - b.start)
          .map((p) => (
            <div
              key={`${p.userId}-${p.start}`}
              className={cn(p.userId === "__taken" ? "bg-[var(--tone-covered-ink)]" : p.userId ? hue.get(p.userId) : "hatch bg-[var(--tone-uncovered)]")}
              style={{ width: `${((p.end - p.start) / total) * 100}%`, marginLeft: 0 }}
            />
          ))}
      </div>

      <p className="text-[14px] font-medium text-ink-2">
        {openMs > 0 ? `Couvre ${Math.round((coveredMs / openMs) * 100)} % de ce qui reste` : "Tout est déjà couvert"}
        {" · "}
        {helpers} gardien{helpers > 1 ? "s" : ""} · {handoffs} relais
      </p>

      <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
        {pieces.map((p, i) => (
          <li key={`${p.start}-${p.userId}`} className="flex items-start gap-3 px-4 py-3">
            {p.userId ? (
              <span className={cn("mt-1 size-3 shrink-0 rounded-full", hue.get(p.userId))} aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-uncovered-ink)]" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">
                {p.userId ? names.get(p.userId) : "À couvrir"}
                {p.userId && nightsIn(p) > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[13px] font-normal text-ink-3">
                    <Moon className="size-3.5" aria-hidden /> {nightsIn(p)} nuit{nightsIn(p) > 1 ? "s" : ""}
                  </span>
                )}
              </p>
              <p className="text-[14px] text-ink-2">{formatPeriod(p.start, p.end)}</p>
              <p className="text-[13px] text-ink-3">{p.reason}</p>
              {!p.userId && (suggestions[String(p.start)]?.length ?? 0) > 0 && (
                <p className="mt-1 text-[13px] text-ink-2">
                  Disponibles d&apos;après leurs dispos : {suggestions[String(p.start)].join(", ")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing({ index: i, piece: p });
                setSheetOpen(true);
              }}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[14px] font-medium text-ink underline underline-offset-2"
            >
              Changer
            </button>
          </li>
        ))}
      </ul>

      {overNights.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-[var(--tone-pending)] px-4 py-3 text-[14px] text-[var(--tone-pending-ink)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {overNights.map(([u, n]) => `${names.get(u)} : ${n} nuits d'affilée`).join(" · ")} (votre limite : {rules.maxConsecutiveNights}).
        </p>
      )}

      <div className="flex flex-col gap-2">
        <PillButton size="lg" loading={pending} disabled={slices.length === 0} onClick={confirm}>
          <CalendarCheck className="size-4" aria-hidden /> Confirmer ce planning
        </PillButton>
        {adjusted && (
          <PillButton variant="outline" onClick={() => setPieces(initial)}>
            <RotateCcw className="size-4" aria-hidden /> Revenir à la proposition
          </PillButton>
        )}
        {pieces.some((p) => !p.userId) && <RelaunchButton requestId={requestId} dogName={dogName} period={period} />}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Qui prend cette tranche ?</SheetTitle>
            <SheetDescription>{editingPiece ? formatPeriod(editingPiece.start, editingPiece.end) : ""}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-6">
            {choices.length === 0 && (
              <p className="text-[14px] text-ink-3">Aucun volontaire ne couvre toute cette tranche (selon leurs « Oui » et leurs autres gardes).</p>
            )}
            {choices.map((o) => (
              <PillButton
                key={o.userId}
                variant={editingPiece?.userId === o.userId ? "primary" : "soft"}
                onClick={() => editing && reassign(editing.index, o.userId)}
              >
                <UserRound className="size-4" aria-hidden /> {o.name}
              </PillButton>
            ))}
            <PillButton variant="outline" onClick={() => editing && reassign(editing.index, null)}>
              Laisser à couvrir
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
