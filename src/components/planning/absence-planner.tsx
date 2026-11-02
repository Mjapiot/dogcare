"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BriefcaseBusiness, CalendarRange, Home, Moon, Send, Sparkles, UserMinus, UserPlus, Users } from "lucide-react";
import { planAbsence as sendAbsence } from "@/server/actions/proposals";
import { nightAnchors } from "@/domain/planner";
import type { AbsencePlan, CircleCandidate } from "@/domain/absence";
import type { Interval } from "@/domain/intervals";
import { CIRCLE_KIND_LABELS } from "@/domain/circle";
import { formatPeriod } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/kit";

type Place = "helper" | "owner";
type Form = { dogId: string; startDate: string; startTime: string; endDate: string; endTime: string };

/** One hue per person on the timeline; names are always written next to it. */
const HUES = ["bg-[#7d9a7e]", "bg-[#c9a27e]", "bg-[#8f8bb8]", "bg-[#d08b74]", "bg-[#6f9fb0]", "bg-[#b59a5a]"];

const ROLE_ICON: Record<CircleCandidate["role"], typeof Users> = { pro: BriefcaseBusiness, close: Users, guest: UserPlus };

/**
 * The proposal for an absence: who keeps the dog when (and where), the holes
 * with the three ways out — ask someone else, change the split, a pet-sitter —
 * then "Envoyer les propositions" (each person gets their part).
 */
export function AbsencePlanner({
  groupId,
  dog,
  form,
  period,
  absence,
  names,
  placeOf,
  maxNights,
  hasPro,
}: {
  groupId: string;
  dog: { id: string; name: string };
  form: Form;
  period: Interval;
  absence: AbsencePlan;
  names: Record<string, string>;
  placeOf: Record<string, Place>;
  maxNights: number;
  hasPro: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // circle people asked for a hole, by hole start
  const [asked, setAsked] = useState<Record<string, string[]>>({});
  const { plan, proposals, holeCandidates, skipped } = absence;

  const hue = useMemo(() => new Map(proposals.map((p, i) => [p.userId, HUES[i % HUES.length]])), [proposals]);
  const anchors = useMemo(() => nightAnchors(period), [period]);
  const nightsIn = (i: Interval) => anchors.filter((a) => a >= i.start && a < i.end).length;
  const total = period.end - period.start || 1;
  const coverage = plan.openMs ? Math.round((plan.coveredMs / plan.openMs) * 100) : 0;

  const baseQuery = { dog: form.dogId, from: form.startDate, fromTime: form.startTime, to: form.endDate, toTime: form.endTime };
  const hrefSkipping = (ids: string[]) => {
    const q = new URLSearchParams(baseQuery);
    if (ids.length) q.set("skip", ids.join(","));
    return `/plan?${q}`;
  };

  const toggleAsk = (holeKey: string, userId: string) =>
    setAsked((prev) => {
      const list = prev[holeKey] ?? [];
      return { ...prev, [holeKey]: list.includes(userId) ? list.filter((u) => u !== userId) : [...list, userId] };
    });

  // everything that will be sent: the plan's parts, plus the holes asked to circle people
  const outgoing = useMemo(() => {
    const byUser = new Map<string, { userId: string; place: Place; slices: Interval[] }>();
    for (const p of proposals) byUser.set(p.userId, { userId: p.userId, place: p.place, slices: [...p.slices] });
    for (const h of plan.holes) {
      for (const userId of asked[String(h.start)] ?? []) {
        const entry = byUser.get(userId) ?? { userId, place: placeOf[userId] ?? "helper", slices: [] };
        entry.slices.push({ start: h.start, end: h.end });
        byUser.set(userId, entry);
      }
    }
    return [...byUser.values()].map((e) => ({ ...e, slices: e.slices.sort((a, b) => a.start - b.start) }));
  }, [proposals, plan.holes, asked, placeOf]);

  const send = () =>
    startTransition(async () => {
      const r = await sendAbsence({
        groupId,
        ...form,
        dogId: dog.id,
        proposals: outgoing.map((o) => ({
          userId: o.userId,
          place: o.place,
          slices: o.slices.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
        })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data.sendError) toast.error(`Demande publiée, mais les propositions n'ont pas pu partir : ${r.data.sendError}`);
      else {
        hapticSuccess();
        toast.success(outgoing.length ? `Propositions envoyées à ${outgoing.length} personne${outgoing.length > 1 ? "s" : ""}` : "Demande publiée");
      }
      router.push(`/requests/${r.data.requestId}`);
    });

  const pieces = [
    ...plan.slices.map((s) => ({ kind: "slice" as const, ...s })),
    ...plan.holes.map((h) => ({ kind: "hole" as const, ...h })),
  ].sort((a, b) => a.start - b.start);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="absence-plan">
      <div className="shadow-soft flex flex-col gap-4 rounded-[28px] bg-surface p-4 ring-1 ring-white/70">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage/15 text-ink">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="absence-plan" className="text-[17px] font-semibold tracking-tight text-ink">
              Proposition pour {dog.name}
            </h2>
            <p className="text-[14px] text-ink-3">{formatPeriod(period.start, period.end)}</p>
          </div>
        </div>

        <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/10" aria-hidden>
          {pieces.map((p) => (
            <div
              key={`${p.kind}-${p.start}`}
              className={cn(p.kind === "slice" ? hue.get(p.userId) : "hatch bg-[var(--tone-uncovered)]")}
              style={{ width: `${((p.end - p.start) / total) * 100}%` }}
            />
          ))}
        </div>

        <p className="text-[14px] font-medium text-ink-2">
          {plan.slices.length === 0
            ? "Personne n'a déclaré de dispo sur cette période"
            : `Couvre ${coverage} % de l'absence · ${proposals.length} personne${proposals.length > 1 ? "s" : ""} · ${plan.handoffs} relais`}
        </p>

        <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
          {pieces.map((p) =>
            p.kind === "slice" ? (
              <li key={`s-${p.start}`} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-1 size-3 shrink-0 rounded-full", hue.get(p.userId))} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">
                    {p.name}
                    {nightsIn(p) > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-[13px] font-normal text-ink-3">
                        <Moon className="size-3.5" aria-hidden /> {nightsIn(p)} nuit{nightsIn(p) > 1 ? "s" : ""}
                      </span>
                    )}
                  </p>
                  <p className="text-[14px] text-ink-2">{formatPeriod(p.start, p.end)}</p>
                  <p className="inline-flex items-center gap-1 text-[13px] text-ink-3">
                    <Home className="size-3.5" aria-hidden /> {p.place === "owner" ? "Chez moi" : `Chez ${p.name}`} · {p.reason}
                  </p>
                </div>
              </li>
            ) : (
              <li key={`h-${p.start}`} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-uncovered-ink)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">Sans solution pour l&apos;instant</p>
                    <p className="text-[14px] text-ink-2">{formatPeriod(p.start, p.end)}</p>
                    <p className="text-[13px] text-ink-3">{p.reason}</p>
                  </div>
                </div>
                <HoleOptions
                  candidates={holeCandidates[String(p.start)] ?? []}
                  asked={asked[String(p.start)] ?? []}
                  onToggle={(userId) => toggleAsk(String(p.start), userId)}
                  dogId={dog.id}
                  hasPro={hasPro}
                />
              </li>
            ),
          )}
        </ul>
        <p className="text-[13px] text-ink-3">
          D&apos;après les dispos partagées, les autres gardes de chacun et vos règles (au plus {maxNights} nuit{maxNights > 1 ? "s" : ""} d&apos;affilée
          par personne, sauf préférence propre).
        </p>
      </div>

      {/* "Modifier la répartition": leave someone out and recompute */}
      {(proposals.length > 0 || skipped.length > 0) && (
        <div className="flex flex-col gap-2 rounded-[24px] bg-surface/60 p-4 ring-1 ring-white/70">
          <h3 className="text-[15px] font-semibold text-ink">Modifier la répartition</h3>
          <div className="flex flex-wrap gap-2">
            {proposals.map((p) => (
              <Link
                key={p.userId}
                href={hrefSkipping([...skipped, p.userId])}
                scroll={false}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[14px] font-medium text-ink"
              >
                <UserMinus className="size-4" aria-hidden /> Sans {p.name}
              </Link>
            ))}
            {skipped.map((id) => (
              <Link
                key={id}
                href={hrefSkipping(skipped.filter((s) => s !== id))}
                scroll={false}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink/25 px-4 text-[14px] font-medium text-ink"
              >
                <UserPlus className="size-4" aria-hidden /> Remettre {names[id] ?? "cette personne"}
              </Link>
            ))}
            <a href="#absence-dates" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[14px] font-medium text-ink">
              <CalendarRange className="size-4" aria-hidden /> Changer les dates
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <PillButton size="lg" loading={pending} onClick={send}>
          <Send className="size-4" aria-hidden /> {outgoing.length ? "Envoyer les propositions" : "Publier la demande"}
        </PillButton>
        <p className="text-center text-[13px] text-ink-3">
          {outgoing.length
            ? "Chacun reçoit sa part et accepte ou refuse. Vous confirmez ensuite le planning : rien n'est confirmé avant."
            : "La demande est publiée dans le groupe, comme un besoin habituel."}
        </p>
      </div>
    </section>
  );
}

/** The three ways out of a hole: someone else of the circle, the split (above), a pet-sitter. */
function HoleOptions({
  candidates,
  asked,
  onToggle,
  dogId,
  hasPro,
}: {
  candidates: CircleCandidate[];
  asked: string[];
  onToggle: (userId: string) => void;
  dogId: string;
  hasPro: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 pl-7">
      {candidates.length > 0 ? (
        <>
          <p className="text-[13px] font-medium text-ink-2">Solliciter quelqu&apos;un du cercle de confiance :</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const Icon = ROLE_ICON[c.role];
              const on = asked.includes(c.userId);
              return (
                <button
                  key={c.userId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(c.userId)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors",
                    on ? "bg-ink text-surface" : "bg-surface text-ink ring-1 ring-line",
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {c.name}
                  <span className={cn("text-[12px]", on ? "text-surface/75" : "text-ink-3")}>{CIRCLE_KIND_LABELS[c.role]}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ink-3">Personne du cercle de confiance ne peut être sollicité sur ce créneau.</p>
      )}
      {!hasPro && (
        <p className="text-[13px] text-ink-3">
          <BriefcaseBusiness className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          Un pet-sitter ?{" "}
          <Link href={`/dogs/${dogId}`} className="font-medium text-ink underline underline-offset-2">
            Invitez-le dans le cercle comme « Professionnel »
          </Link>
          , il pourra recevoir une proposition.
        </p>
      )}
    </div>
  );
}
