"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BriefcaseBusiness, CalendarRange, Home, Moon, Send, ShieldAlert, Split, UserMinus, UserPlus, Users } from "lucide-react";
import { planAbsence as sendAbsence } from "@/server/actions/proposals";
import { nightAnchors, type PlanHole, type PlanSlice } from "@/domain/planner";
import { joinNames } from "@/domain/absence-intent";
import { holePartFor, type AbsencePlan, type CircleCandidate } from "@/domain/absence";
import type { Interval } from "@/domain/intervals";
import { CIRCLE_KIND_LABELS } from "@/domain/circle";
import { formatPeriod } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/kit";
import { BigNumber, SegmentGauge } from "@/components/ui/editorial";
import { StepDots } from "./absence-form";

type Place = "helper" | "owner";
type Form = { dogIds: string[]; startDate: string; startTime: string; endDate: string; endTime: string };
type Dog = { id: string; name: string; aloneOnly: boolean; maxNights: number };

/** One hue per person on the timeline; names are always written next to it. */
const HUES = ["bg-[#7d9a7e]", "bg-[#c9a27e]", "bg-[#8f8bb8]", "bg-[#d08b74]", "bg-[#6f9fb0]", "bg-[#b59a5a]"];

const ROLE_ICON: Record<CircleCandidate["role"], typeof Users> = { pro: BriefcaseBusiness, close: Users, guest: UserPlus };

/**
 * The proposal for an absence: who keeps which dog when (and where), the
 * holes with the three ways out — ask someone else, change the split, a
 * pet-sitter — then "Envoyer les propositions" (each person gets their part).
 * Several dogs kept by the same person at the same time are shown together.
 */
export function AbsencePlanner({
  groupId,
  dogs,
  form,
  period,
  absence,
  names,
  placeOf,
  nightsOf = {},
  hasPro,
  rulesParam,
}: {
  groupId: string;
  dogs: Dog[];
  form: Form;
  period: Interval;
  absence: AbsencePlan;
  names: Record<string, string>;
  /** Where each person keeps each dog (by dog, then person). */
  placeOf: Record<string, Record<string, Place>>;
  /** Limits of consecutive nights said for this absence (circle people asked for a hole). */
  nightsOf?: Record<string, number | null>;
  hasPro: boolean;
  /** Rules for this absence, kept when the split is changed. */
  rulesParam?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // circle people asked for a hole, by hole key
  const [asked, setAsked] = useState<Record<string, string[]>>({});
  const { proposals, separated, skipped } = absence;
  const several = dogs.length > 1;
  const dogName = useMemo(() => new Map(dogs.map((d) => [d.id, d.name])), [dogs]);
  const namesOf = (ids: readonly string[]) => joinNames(ids.map((id) => dogName.get(id) ?? ""));
  const maxNights = Math.min(...dogs.map((d) => d.maxNights));

  const hue = useMemo(() => new Map(proposals.map((p, i) => [p.userId, HUES[i % HUES.length]])), [proposals]);
  const anchors = useMemo(() => nightAnchors(period), [period]);
  const nightsIn = (i: Interval) => anchors.filter((a) => a >= i.start && a < i.end).length;
  const total = period.end - period.start || 1;
  const openMs = absence.dogs.reduce((sum, d) => sum + d.plan.openMs, 0);
  const coveredMs = absence.dogs.reduce((sum, d) => sum + d.plan.coveredMs, 0);
  const coverage = openMs ? Math.round((coveredMs / openMs) * 100) : 0;
  const handoffs = absence.dogs.reduce((sum, d) => sum + d.plan.handoffs, 0);

  // the same person with several dogs at the same time: one line; the same hole for several dogs: one line
  const rows = useMemo(() => {
    const slices = new Map<string, PlanSlice & { kind: "slice"; dogIds: string[] }>();
    const holes = new Map<string, PlanHole & { kind: "hole"; key: string; dogIds: string[]; candidates: Map<string, CircleCandidate & { dogIds: string[] }> }>();
    for (const d of absence.dogs) {
      for (const s of d.plan.slices) {
        const key = `${s.userId}-${s.start}-${s.end}`;
        const row = slices.get(key) ?? { ...s, kind: "slice" as const, dogIds: [] as string[] };
        row.dogIds.push(d.dogId);
        slices.set(key, row);
      }
      for (const h of d.plan.holes) {
        const key = `${h.start}-${h.end}`;
        const row = holes.get(key) ?? { ...h, kind: "hole" as const, key, dogIds: [] as string[], candidates: new Map<string, CircleCandidate & { dogIds: string[] }>() };
        row.dogIds.push(d.dogId);
        for (const c of d.holeCandidates[String(h.start)] ?? []) {
          const cand = row.candidates.get(c.userId) ?? { ...c, dogIds: [] as string[] };
          cand.dogIds.push(d.dogId);
          row.candidates.set(c.userId, cand);
        }
        holes.set(key, row);
      }
    }
    return [...slices.values(), ...holes.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  }, [absence.dogs]);

  const baseQuery = { dog: form.dogIds.join(","), from: form.startDate, fromTime: form.startTime, to: form.endDate, toTime: form.endTime };
  const hrefSkipping = (ids: string[]) => {
    const q = new URLSearchParams(baseQuery);
    if (ids.length) q.set("skip", ids.join(","));
    if (rulesParam) q.set("rules", rulesParam);
    return `/plan?${q}`;
  };

  const toggleAsk = (holeKey: string, userId: string) =>
    setAsked((prev) => {
      const list = prev[holeKey] ?? [];
      return { ...prev, [holeKey]: list.includes(userId) ? list.filter((u) => u !== userId) : [...list, userId] };
    });

  // everything that will be sent: each person's part for each dog, plus the holes asked to circle people
  const outgoing = useMemo(() => {
    const parts = new Map<string, { userId: string; dogId: string; place: Place; slices: Interval[] }>();
    const partOf = (userId: string, dogId: string, place: Place) => {
      const key = `${userId}|${dogId}`;
      const part = parts.get(key) ?? { userId, dogId, place, slices: [] };
      parts.set(key, part);
      return part;
    };
    for (const p of proposals) for (const x of p.parts) partOf(p.userId, x.dogId, x.place).slices.push(...x.slices);
    for (const row of rows) {
      if (row.kind !== "hole") continue;
      for (const userId of asked[row.key] ?? []) {
        // asked for the dogs of this hole whose circle they belong to
        for (const dogId of row.candidates.get(userId)?.dogIds ?? []) {
          const dog = dogs.find((d) => d.id === dogId)!;
          // their own limit of nights, said for this absence, cuts the part they are asked for
          partOf(userId, dogId, placeOf[dogId]?.[userId] ?? "helper").slices.push(
            ...holePartFor(row, { userId, name: names[userId] ?? "", maxNights: nightsOf[userId] ?? null }, { maxConsecutiveNights: dog.maxNights, minSliceMs: 0 }),
          );
        }
      }
    }
    return [...parts.values()].map((e) => ({ ...e, slices: e.slices.sort((a, b) => a.start - b.start) }));
  }, [proposals, rows, asked, placeOf, nightsOf, names, dogs]);
  const people = new Set(outgoing.map((o) => o.userId)).size;

  const send = (withProposals = true) =>
    startTransition(async () => {
      const r = await sendAbsence({
        groupId,
        ...form,
        proposals: (withProposals ? outgoing : []).map((o) => ({
          dogId: o.dogId,
          userId: o.userId,
          place: o.place,
          slices: o.slices.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
        })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      hapticSuccess();
      toast.success(withProposals && people ? `Propositions envoyées à ${people} personne${people > 1 ? "s" : ""}` : several ? "Demandes publiées, le groupe est prévenu" : "Demande publiée, le groupe est prévenu");
      router.push(`/requests/${r.data.requestIds[0]}`);
    });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="absence-plan">
      <StepDots step={3} />
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="absence-plan" className="text-[40px] font-light leading-[1.02] tracking-[-0.035em] text-ink">
            On vous <b className="font-semibold">propose</b>
          </h2>
          <p className="mt-1 text-[14px] text-ink-2">
            Pour {namesOf(dogs.map((d) => d.id))} · {formatPeriod(period.start, period.end)}
          </p>
        </div>

        <div className={cn("rounded-[26px] p-5", coverage === 100 ? "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]" : "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]")}>
          <BigNumber value={coverage} unit={"\u202f% couvert"} />
          <SegmentGauge className="mt-3" total={10} done={Math.round(coverage / 10)} label={`${coverage}\u202f% de l'absence couverte`} />
          <p className="mt-3 text-[14px] font-medium">
            {proposals.length === 0
              ? "Personne n'a déclaré de dispo sur cette période"
              : `${proposals.length} personne${proposals.length > 1 ? "s" : ""} · ${handoffs} relais${several && separated.length === 0 ? " · gardés ensemble" : ""}`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5" aria-hidden>
          {absence.dogs.map((d) => (
            <div key={d.dogId} className="flex items-center gap-2">
              {several && <span className="w-14 shrink-0 truncate text-[12px] font-medium text-ink-3">{d.name}</span>}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/10">
                {[...d.plan.slices.map((x) => ({ ...x, hole: false })), ...d.plan.holes.map((x) => ({ ...x, userId: "", hole: true }))]
                  .sort((a, b) => a.start - b.start)
                  .map((x) => (
                    <div
                      key={`${x.hole}-${x.start}`}
                      className={cn(x.hole ? "hatch bg-[var(--tone-uncovered)]" : hue.get(x.userId))}
                      style={{ width: `${((x.end - x.start) / total) * 100}%` }}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>


        {separated.length > 0 && (
          <div className="flex items-start gap-2 rounded-2xl bg-[var(--tone-pending)] px-3 py-2 text-[14px] text-[var(--tone-pending-ink)]" role="note">
            <Split className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Séparés {separated.length === 1 ? formatPeriod(separated[0].start, separated[0].end) : `sur ${separated.length} créneaux`} : personne ne peut
              tous les garder à ce moment-là. Le détail est ci-dessous.
            </p>
          </div>
        )}
        {dogs.some((d) => d.aloneOnly) && several && (
          <p className="flex items-start gap-1.5 text-[13px] text-ink-3">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {namesOf(dogs.filter((d) => d.aloneOnly).map((d) => d.id))} {dogs.filter((d) => d.aloneOnly).length > 1 ? "doivent être gardés seuls" : "doit être gardé seul"} :
            jamais avec un autre chien.
          </p>
        )}

        <ul className="flex flex-col divide-y divide-line rounded-[26px] bg-surface">
          {rows.map((p) =>
            p.kind === "slice" ? (
              <li key={`s-${p.userId}-${p.start}-${p.end}`} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-1 size-3 shrink-0 rounded-full", hue.get(p.userId))} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">
                    {p.name}
                    {several && <span className="font-normal text-ink-2"> · {namesOf(p.dogIds)}</span>}
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
              <li key={`h-${p.key}`} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-uncovered-ink)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">
                      {several ? `${namesOf(p.dogIds)} : sans solution pour l'instant` : "Sans solution pour l'instant"}
                    </p>
                    <p className="text-[14px] text-ink-2">{formatPeriod(p.start, p.end)}</p>
                    <p className="text-[13px] text-ink-3">{p.reason}</p>
                  </div>
                </div>
                <HoleOptions
                  candidates={[...p.candidates.values()]}
                  asked={asked[p.key] ?? []}
                  onToggle={(userId) => toggleAsk(p.key, userId)}
                  dogId={p.dogIds[0]}
                  hasPro={hasPro}
                />
              </li>
            ),
          )}
        </ul>
        <p className="text-[13px] text-ink-3">
          D&apos;après les dispos partagées, les autres gardes de chacun et vos règles (au plus {maxNights} nuit{maxNights > 1 ? "s" : ""} d&apos;affilée
          par personne, sauf préférence propre{several ? " ; chacun garde au plus le nombre de chiens qu'il a choisi" : ""}).
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
        <PillButton size="lg" loading={pending} onClick={() => send()}>
          <Send className="size-4" aria-hidden /> {outgoing.length ? "Envoyer les propositions" : several ? "Publier les demandes" : "Publier la demande"}
        </PillButton>
        <p className="text-center text-[13px] text-ink-3">
          {outgoing.length
            ? "Chacun reçoit sa part et accepte ou refuse. Vous confirmez ensuite le planning : rien n'est confirmé avant."
            : several
              ? "Une demande par chien est publiée dans le groupe, comme un besoin habituel."
              : "La demande est publiée dans le groupe, comme un besoin habituel."}
        </p>
        {outgoing.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => send(false)}
            className="mx-auto min-h-11 text-[15px] font-medium text-ink underline underline-offset-4"
          >
            Publier sans proposer à quelqu&apos;un
          </button>
        )}
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
