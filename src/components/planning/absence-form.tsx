"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, MessageSquareText, Sparkles, X } from "lucide-react";
import { understandAbsence } from "@/server/actions/assistant";
import { describeRule, encodeRules, type AbsenceRule } from "@/domain/absence-intent";
import { Field, PillButton, Select, TextArea, TextInput } from "@/components/ui/kit";

type Form = { dogId: string; startDate: string; startTime: string; endDate: string; endTime: string };

/**
 * Which dog, from when to when, and rules for this absence. The assistant
 * (when configured) fills it from a sentence; everything stays editable and
 * the proposal is computed by the page (URL parameters).
 */
export function AbsenceForm({
  groupId,
  dogs,
  initial,
  initialRules,
  error,
  assistant,
}: {
  groupId: string;
  dogs: Array<{ id: string; name: string }>;
  initial: Form;
  initialRules: AbsenceRule[];
  error: string | null;
  assistant: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [understanding, startUnderstanding] = useTransition();
  const [v, setV] = useState<Form>(initial);
  const [rules, setRules] = useState<AbsenceRule[]>(initialRules);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<{ assumptions: string[]; issues: string[] } | null>(null);
  const set = <K extends keyof Form>(k: K, value: Form[K]) => setV((prev) => ({ ...prev, [k]: value }));

  const understand = () =>
    startUnderstanding(async () => {
      const r = await understandAbsence(groupId, text);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const a = r.data;
      setV((prev) => ({
        dogId: a.dogId ?? prev.dogId,
        startDate: a.startDate ?? prev.startDate,
        startTime: a.startTime,
        endDate: a.endDate ?? prev.endDate,
        endTime: a.endTime,
      }));
      setRules(a.rules);
      setNotes({ assumptions: a.assumptions, issues: a.issues });
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ dog: v.dogId, from: v.startDate, fromTime: v.startTime, to: v.endDate, toTime: v.endTime });
    if (rules.length) q.set("rules", encodeRules(rules));
    startTransition(() => router.push(`/plan?${q}`, { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-3">
      {assistant && (
        <section className="shadow-soft flex flex-col gap-3 rounded-[28px] bg-surface p-4 ring-1 ring-white/70" aria-labelledby="assistant-title">
          <h2 id="assistant-title" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
            <MessageSquareText className="size-5" aria-hidden /> Décrivez votre absence
          </h2>
          <TextArea
            aria-labelledby="assistant-title"
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
        </section>
      )}

      <form id="absence-dates" onSubmit={submit} className="shadow-soft flex flex-col gap-4 rounded-[28px] bg-surface p-4 ring-1 ring-white/70">
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
        {dogs.length > 1 && (
          <Field label="Chien" htmlFor="absence-dog">
            <Select id="absence-dog" required value={v.dogId} onChange={(e) => set("dogId", e.target.value)}>
              <option value="" disabled>
                Choisir…
              </option>
              {dogs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-3">
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
          <Field label="Heure" htmlFor="absence-start-time">
            <TextInput id="absence-start-time" type="time" step={900} required value={v.startTime} onChange={(e) => set("startTime", e.target.value)} className="w-32" />
          </Field>
          <Field label="Je rentre le" htmlFor="absence-end-date">
            <TextInput id="absence-end-date" type="date" required min={v.startDate} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
          <Field label="Heure" htmlFor="absence-end-time">
            <TextInput id="absence-end-time" type="time" step={900} required value={v.endTime} onChange={(e) => set("endTime", e.target.value)} className="w-32" />
          </Field>
        </div>
        {rules.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-2">Pour cette absence seulement</p>
            <ul className="flex flex-col gap-1.5">
              {rules.map((r) => (
                <li key={r.userId} className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 pl-4">
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
        {error && (
          <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
            {error}
          </p>
        )}
        <PillButton type="submit" loading={pending} disabled={!v.dogId}>
          <Sparkles className="size-4" aria-hidden /> Proposer une répartition
        </PillButton>
      </form>
    </div>
  );
}
