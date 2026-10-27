"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDog } from "@/server/actions/dogs";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export type DogFormValues = {
  name: string;
  breed: string;
  birthDate: string;
  careNotes: string;
};

/** New dog: the essentials only; the full passport is filled in on the dog's page. */
export function DogForm({
  initial,
  groups,
  defaultGroupIds,
  afterCreate,
}: {
  initial: DogFormValues;
  groups?: Array<{ id: string; name: string }>;
  defaultGroupIds?: string[];
  afterCreate?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroupIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof DogFormValues, value: string) => setV((p) => ({ ...p, [k]: value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createDog({ ...v, groupIds });
          if (!r.ok) return setError(r.error);
          toast.success(`${v.name} a été ajouté`);
          router.replace(afterCreate ?? `/dogs/${r.data.dogId}`);
        });
      }}
    >
      <Field label="Nom" htmlFor="dog-name">
        <TextInput id="dog-name" required maxLength={40} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Oscar" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Race (facultatif)" htmlFor="dog-breed">
          <TextInput id="dog-breed" maxLength={60} value={v.breed} onChange={(e) => set("breed", e.target.value)} placeholder="Beagle" />
        </Field>
        <Field label="Naissance (facultatif)" htmlFor="dog-birth">
          <TextInput id="dog-birth" type="date" value={v.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Infos pratiques de garde" htmlFor="dog-notes" hint="Promenades, entente avec les autres chiens, repas, consignes…">
        <TextArea id="dog-notes" maxLength={2000} value={v.careNotes} onChange={(e) => set("careNotes", e.target.value)} />
      </Field>
      <p className="text-[13px] text-ink-3">Santé, vétérinaire, contacts d&apos;urgence : à compléter ensuite dans son passeport.</p>

      {groups && groups.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-2">Visible dans</legend>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGroupIds((ids) => (on ? ids.filter((x) => x !== g.id) : [...ids, g.id]))}
                  className={cn("min-h-11 rounded-full px-4 text-[14px] font-medium", on ? "bg-ink text-surface" : "bg-surface text-ink-2")}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && (
        <p className="rounded-2xl bg-[#f6dcd9] px-4 py-3 text-[14px] font-medium text-[#7a1b14]" role="alert">
          {error}
        </p>
      )}
      <PillButton type="submit" size="lg" loading={pending} disabled={!v.name.trim()}>
        Ajouter ce chien
      </PillButton>
    </form>
  );
}
