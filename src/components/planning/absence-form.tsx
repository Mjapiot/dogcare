"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Field, PillButton, Select, TextInput } from "@/components/ui/kit";

type Form = { dogId: string; startDate: string; startTime: string; endDate: string; endTime: string };

/** Which dog, from when to when: the proposal is computed by the page (URL parameters). */
export function AbsenceForm({ dogs, initial, error }: { dogs: Array<{ id: string; name: string }>; initial: Form; error: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, value: Form[K]) => setV((prev) => ({ ...prev, [k]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ dog: v.dogId, from: v.startDate, fromTime: v.startTime, to: v.endDate, toTime: v.endTime });
    startTransition(() => router.push(`/plan?${q}`, { scroll: false }));
  };

  return (
    <form id="absence-dates" onSubmit={submit} className="shadow-soft flex flex-col gap-4 rounded-[28px] bg-surface p-4 ring-1 ring-white/70">
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
      {error && (
        <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
      <PillButton type="submit" loading={pending} disabled={!v.dogId}>
        <Sparkles className="size-4" aria-hidden /> Proposer une répartition
      </PillButton>
    </form>
  );
}
