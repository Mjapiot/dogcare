"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Info, Pencil, Sparkles, X } from "lucide-react";
import { understandAbsence } from "@/server/actions/assistant";
import { describeRule, encodeRules, joinNames, type AbsenceRule } from "@/domain/absence-intent";
import { nightAnchors } from "@/domain/planner";
import { zonedInstant } from "@/domain/time";
import { formatPeriod } from "@/lib/format";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";
import { BigNumber, SegmentGauge } from "@/components/ui/editorial";
import { cn } from "@/lib/utils";

type Form = { dogIds: string[]; startDate: string; startTime: string; endDate: string; endTime: string; description: string };

/** Soft colors of the dog cards (the name and the check say everything). */
const TONES = ["bg-beige", "bg-[var(--tone-covered)]", "bg-[var(--tone-info)]", "bg-[var(--tone-pending)]"];

/** "1 · 2 · 3": where I am in "Besoin d'une garde". */
export function StepDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`Étape ${step} sur 3`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={cn("h-2 rounded-full transition-all duration-300", n === step ? "w-7 bg-ink" : n < step ? "w-2 bg-ink" : "w-2 bg-ink/20")} />
      ))}
    </div>
  );
}

/**
 * "Besoin d'une garde", steps 1 and 2: for which dogs (or a sentence for the
 * assistant), then when. Step 3, the proposal, is computed by the page from
 * the URL. Once computed, the choices fold into a summary that can be edited.
 */
export function AbsenceForm({
  groupId,
  dogs,
  initial,
  initialRules,
  error,
  assistant,
  submitted,
}: {
  groupId: string;
  dogs: Array<{ id: string; name: string }>;
  initial: Form;
  initialRules: AbsenceRule[];
  error: string | null;
  assistant: boolean;
  /** The proposal is shown below: start folded. */
  submitted: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [understanding, startUnderstanding] = useTransition();
  const [v, setV] = useState<Form>(initial);
  const [rules, setRules] = useState<AbsenceRule[]>(initialRules);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<{ assumptions: string[]; issues: string[] } | null>(null);
  // one dog and no assistant: nothing to choose at step 1
  const [step, setStep] = useState<"dogs" | "when" | "folded">(submitted && !error ? "folded" : dogs.length > 1 || assistant ? "dogs" : "when");
  const set = <K extends keyof Form>(k: K, value: Form[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const names = joinNames(dogs.filter((d) => v.dogIds.includes(d.id)).map((d) => d.name));

  const period = useMemo(() => {
    try {
      const start = zonedInstant(v.startDate, v.startTime);
      const end = zonedInstant(v.endDate, v.endTime);
      return end > start ? { start, end } : null;
    } catch {
      return null;
    }
  }, [v.startDate, v.startTime, v.endDate, v.endTime]);
  const nights = period ? nightAnchors(period).length : 0;

  const understand = () =>
    startUnderstanding(async () => {
      const r = await understandAbsence(groupId, text);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const a = r.data;
      setV((prev) => ({
        ...prev,
        dogIds: a.dogIds.length ? a.dogIds : prev.dogIds,
        startDate: a.startDate ?? prev.startDate,
        startTime: a.startTime,
        endDate: a.endDate ?? prev.endDate,
        endTime: a.endTime,
      }));
      setRules(a.rules);
      setNotes({ assumptions: a.assumptions, issues: a.issues });
      setStep("when");
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ dog: v.dogIds.join(","), from: v.startDate, fromTime: v.startTime, to: v.endDate, toTime: v.endTime });
    if (rules.length) q.set("rules", encodeRules(rules));
    if (v.description.trim()) q.set("desc", v.description.trim().slice(0, 1000));
    startTransition(() => router.push(`/plan?${q}`, { scroll: false }));
  };

  if (step === "folded") {
    return (
      <section aria-label="Votre besoin" className="flex items-center gap-3 rounded-[26px] bg-surface p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-ink">{names}</p>
          <p className="text-[14px] text-ink-2">{period ? formatPeriod(period.start, period.end) : ""}</p>
        </div>
        <button
          type="button"
          onClick={() => setStep("when")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[14px] font-medium text-ink"
        >
          <Pencil className="size-4" aria-hidden /> Modifier
        </button>
      </section>
    );
  }

  if (step === "dogs") {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="step-dogs">
        <StepDots step={1} />
        <h2 id="step-dogs" className="text-[40px] font-light leading-[1.02] tracking-[-0.035em] text-ink">
          Pour <b className="font-semibold">qui</b> ?
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {dogs.map((d, i) => {
            const on = v.dogIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => set("dogIds", on ? v.dogIds.filter((id) => id !== d.id) : dogs.filter((x) => x.id === d.id || v.dogIds.includes(x.id)).map((x) => x.id))}
                className={cn(
                  "flex min-h-30 flex-col justify-between rounded-[28px] p-4 text-left transition-colors active:scale-[0.98]",
                  on ? cn(TONES[i % TONES.length], "text-ink") : "bg-surface text-ink-3",
                )}
              >
                <span className={cn("flex size-8 items-center justify-center rounded-full", on ? "bg-ink text-surface" : "ring-[1.5px] ring-line ring-inset")}>
                  {on && <Check className="size-4" strokeWidth={2.6} aria-hidden />}
                </span>
                <span className="truncate text-[24px] font-semibold tracking-tight">{d.name}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[14px] text-ink-2">
          {v.dogIds.length > 1 ? "Gardés ensemble quand c'est possible." : v.dogIds.length ? "" : "Choisissez au moins un chien."}
        </p>

        {assistant && (
          <div className="flex flex-col gap-3 rounded-[26px] bg-surface p-4">
            <label htmlFor="assistant-text" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Sparkles className="size-[18px]" aria-hidden /> Ou dites-le en une phrase
            </label>
            <TextArea
              id="assistant-text"
              rows={3}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Je pars vendredi 18 h, retour lundi matin. Pas plus de 2 nuits chez mes parents, Léa jamais la nuit."
              className="py-3"
            />
            <PillButton variant="soft" loading={understanding} disabled={text.trim().length < 5} onClick={understand}>
              <Sparkles className="size-4" aria-hidden /> Comprendre
            </PillButton>
            <p className="flex items-start gap-1.5 text-[13px] text-ink-3">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Ce texte est envoyé à Google (Gemini) pour être compris, puis oublié par l&apos;app. N&apos;y mettez pas d&apos;adresse.
            </p>
          </div>
        )}

        <PillButton size="lg" disabled={v.dogIds.length === 0} onClick={() => setStep("when")}>
          Continuer
        </PillButton>
      </section>
    );
  }

  return (
    <form id="absence-dates" onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="step-when">
      <div className="flex items-center justify-between">
        <StepDots step={2} />
        {(dogs.length > 1 || assistant) && (
          <button type="button" onClick={() => setStep("dogs")} className="inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-ink-2">
            <ArrowLeft className="size-4" aria-hidden /> {names || "Chiens"}
          </button>
        )}
      </div>
      <h2 id="step-when" className="text-[40px] font-light leading-[1.02] tracking-[-0.035em] text-ink">
        <b className="font-semibold">Quand</b> ?
      </h2>

      {notes && (notes.assumptions.length > 0 || notes.issues.length > 0) && (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-[15px] font-semibold text-ink">J&apos;ai compris ceci — vérifiez :</p>
          {notes.issues.map((i) => (
            <p key={i} className="rounded-2xl bg-[var(--tone-pending)] px-3 py-2 text-[14px] text-[var(--tone-pending-ink)]">
              {i}
            </p>
          ))}
          {notes.assumptions.map((a) => (
            <p key={a} className="text-[14px] text-ink-2">
              Supposé : {a}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-2 rounded-[26px] bg-surface p-4">
          <Field label="Je pars le" htmlFor="absence-start-date">
            <TextInput
              id="absence-start-date"
              type="date"
              required
              value={v.startDate}
              onChange={(e) => {
                const startDate = e.target.value;
                setV((prev) => ({ ...prev, startDate, endDate: prev.endDate < startDate ? startDate : prev.endDate }));
              }}
            />
          </Field>
          <Field label="à" htmlFor="absence-start-time">
            <TextInput id="absence-start-time" type="time" step={900} required value={v.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-2 rounded-[26px] bg-surface p-4">
          <Field label="Je rentre le" htmlFor="absence-end-date">
            <TextInput id="absence-end-date" type="date" required min={v.startDate} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
          <Field label="à" htmlFor="absence-end-time">
            <TextInput id="absence-end-time" type="time" step={900} required value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="rounded-[30px] bg-beige p-5 text-ink">
        {period ? (
          <>
            <BigNumber value={nights} unit={nights > 1 ? " nuits" : nights === 1 ? " nuit" : " nuit, en journée"} />
            {nights > 0 && <SegmentGauge className="mt-3" total={nights} done={nights} label={`${nights} nuit${nights > 1 ? "s" : ""}`} />}
            <p className="mt-3 text-[14px] text-ink-2">{formatPeriod(period.start, period.end)}</p>
          </>
        ) : (
          <p className="text-[15px] font-medium text-[#9b1c14]">Le retour doit être après le départ.</p>
        )}
      </div>

      {rules.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink-2">Pour cette absence seulement</p>
          <ul className="flex flex-col gap-1.5">
            {rules.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2 rounded-2xl bg-surface pl-4">
                <span className="text-[14px] text-ink">{describeRule(r)}</span>
                <button
                  type="button"
                  onClick={() => setRules((prev) => prev.filter((x) => x.userId !== r.userId))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2"
                  aria-label={`Retirer la règle pour ${r.name}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Précisions (facultatif)" htmlFor="absence-description" hint="Habitudes, clés, horaires de repas…">
        <TextArea id="absence-description" maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      {error && (
        <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
      <PillButton type="submit" size="lg" loading={pending} disabled={v.dogIds.length === 0 || !period}>
        Voir qui peut {v.dogIds.length > 1 ? "les" : "le"} garder
      </PillButton>
    </form>
  );
}
