"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { saveDogEmergency, saveDogHealth, updateDogHabits, updateDogIdentity } from "@/server/actions/dogs";
import { Field, PillButton, Segmented, TextArea, TextInput } from "@/components/ui/kit";
import { MAX_EMERGENCY_CONTACTS, type EmergencyContact } from "@/domain/passport";
import type { ActionResult } from "@/lib/types";
import { useSectionEdit } from "./passport-section";

/** Shared submit logic: saves, refreshes the page and closes the editor. */
function useSave() {
  const router = useRouter();
  const { close } = useSectionEdit();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (run: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const r = await run();
      if (!r.ok) return setError(r.error);
      toast.success("Passeport mis à jour");
      close();
      router.refresh();
    });
  };
  return { save, error, pending, close };
}

function EditorActions({ pending, error, onCancel }: { pending: boolean; error: string | null; onCancel: () => void }) {
  return (
    <>
      {error && (
        <p className="rounded-2xl bg-[#f6dcd9] px-4 py-3 text-[14px] font-medium text-[#7a1b14]" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <PillButton variant="soft" onClick={onCancel} disabled={pending}>
          Annuler
        </PillButton>
        <PillButton type="submit" loading={pending}>
          Enregistrer
        </PillButton>
      </div>
    </>
  );
}

export type IdentityValues = {
  name: string;
  breed: string;
  birthDate: string;
  sex: "female" | "male" | "";
  sterilized: "yes" | "no" | "";
  weight: string;
  identification: string;
  distinctiveMarks: string;
};

export function IdentityEditor({ dogId, initial }: { dogId: string; initial: IdentityValues }) {
  const [v, setV] = useState(initial);
  const { save, error, pending, close } = useSave();
  const set = <K extends keyof IdentityValues>(k: K, value: IdentityValues[K]) => setV((p) => ({ ...p, [k]: value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => updateDogIdentity(dogId, v));
      }}
    >
      <Field label="Nom" htmlFor="pp-name">
        <TextInput id="pp-name" required maxLength={40} value={v.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Race" htmlFor="pp-breed">
          <TextInput id="pp-breed" maxLength={60} value={v.breed} onChange={(e) => set("breed", e.target.value)} />
        </Field>
        <Field label="Naissance" htmlFor="pp-birth">
          <TextInput id="pp-birth" type="date" value={v.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Sexe</span>
        <Segmented
          label="Sexe"
          value={v.sex}
          onChange={(x) => set("sex", x)}
          options={[
            { value: "female", label: "Femelle" },
            { value: "male", label: "Mâle" },
            { value: "", label: "Non précisé" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Stérilisé</span>
        <Segmented
          label="Stérilisé"
          value={v.sterilized}
          onChange={(x) => set("sterilized", x)}
          options={[
            { value: "yes", label: "Oui" },
            { value: "no", label: "Non" },
            { value: "", label: "Non précisé" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Poids (kg)" htmlFor="pp-weight">
          <TextInput
            id="pp-weight"
            inputMode="decimal"
            maxLength={5}
            value={v.weight}
            onChange={(e) => set("weight", e.target.value)}
            placeholder="12,5"
          />
        </Field>
        <Field label="N° d'identification" htmlFor="pp-id">
          <TextInput id="pp-id" maxLength={30} value={v.identification} onChange={(e) => set("identification", e.target.value)} placeholder="Puce" />
        </Field>
      </div>
      <Field label="Signes particuliers" htmlFor="pp-marks" hint="Ce qui permet de le reconnaître : tache, collier, oreille…">
        <TextArea id="pp-marks" maxLength={300} value={v.distinctiveMarks} onChange={(e) => set("distinctiveMarks", e.target.value)} />
      </Field>
      <EditorActions pending={pending} error={error} onCancel={close} />
    </form>
  );
}

export type HabitsValues = { meals: string; walks: string; sleep: string; behavior: string; careNotes: string };

export function HabitsEditor({ dogId, initial }: { dogId: string; initial: HabitsValues }) {
  const [v, setV] = useState(initial);
  const { save, error, pending, close } = useSave();
  const set = (k: keyof HabitsValues, value: string) => setV((p) => ({ ...p, [k]: value }));
  const fields: Array<[keyof HabitsValues, string, number, string]> = [
    ["meals", "Repas", 500, "Quantité, horaires, friandises autorisées…"],
    ["walks", "Promenades", 500, "Fréquence, durée, laisse, lieux…"],
    ["sleep", "Sommeil", 500, "Où il dort, ses habitudes du soir…"],
    ["behavior", "Comportement", 1000, "Avec les chiens, les chats, les enfants ; ses peurs…"],
    ["careNotes", "Autres consignes", 2000, "Tout ce qui est utile pendant une garde."],
  ];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => updateDogHabits(dogId, v));
      }}
    >
      {fields.map(([k, label, max, hint]) => (
        <Field key={k} label={label} htmlFor={`pp-${k}`} hint={hint}>
          <TextArea id={`pp-${k}`} maxLength={max} value={v[k]} onChange={(e) => set(k, e.target.value)} className="min-h-20" />
        </Field>
      ))}
      <EditorActions pending={pending} error={error} onCancel={close} />
    </form>
  );
}

export type HealthValues = {
  allergies: string;
  treatments: string;
  vetName: string;
  vetClinic: string;
  vetPhone: string;
  vetAddress: string;
  notes: string;
};

export function HealthEditor({ dogId, initial }: { dogId: string; initial: HealthValues }) {
  const [v, setV] = useState(initial);
  const { save, error, pending, close } = useSave();
  const set = (k: keyof HealthValues, value: string) => setV((p) => ({ ...p, [k]: value }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveDogHealth(dogId, v));
      }}
    >
      <Field label="Allergies" htmlFor="pp-allergies">
        <TextArea id="pp-allergies" maxLength={500} value={v.allergies} onChange={(e) => set("allergies", e.target.value)} className="min-h-20" />
      </Field>
      <Field label="Traitements en cours" htmlFor="pp-treatments" hint="Médicament, dose, horaires.">
        <TextArea id="pp-treatments" maxLength={1000} value={v.treatments} onChange={(e) => set("treatments", e.target.value)} className="min-h-20" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vétérinaire" htmlFor="pp-vet-name">
          <TextInput id="pp-vet-name" maxLength={80} value={v.vetName} onChange={(e) => set("vetName", e.target.value)} placeholder="Dr Martin" />
        </Field>
        <Field label="Cabinet" htmlFor="pp-vet-clinic">
          <TextInput id="pp-vet-clinic" maxLength={80} value={v.vetClinic} onChange={(e) => set("vetClinic", e.target.value)} />
        </Field>
      </div>
      <Field label="Téléphone du vétérinaire" htmlFor="pp-vet-phone">
        <TextInput
          id="pp-vet-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={30}
          value={v.vetPhone}
          onChange={(e) => set("vetPhone", e.target.value)}
        />
      </Field>
      <Field label="Adresse du vétérinaire" htmlFor="pp-vet-address">
        <TextInput id="pp-vet-address" maxLength={200} value={v.vetAddress} onChange={(e) => set("vetAddress", e.target.value)} />
      </Field>
      <Field label="Notes de santé" htmlFor="pp-health-notes" hint="Besoins particuliers, antécédents utiles pendant une garde.">
        <TextArea id="pp-health-notes" maxLength={1000} value={v.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-20" />
      </Field>
      <EditorActions pending={pending} error={error} onCancel={close} />
    </form>
  );
}

type ContactDraft = { name: string; relation: string; phone: string };

export function EmergencyEditor({
  dogId,
  initial,
}: {
  dogId: string;
  initial: { contacts: EmergencyContact[]; instructions: string };
}) {
  const [contacts, setContacts] = useState<ContactDraft[]>(
    initial.contacts.length
      ? initial.contacts.map((c) => ({ name: c.name, relation: c.relation ?? "", phone: c.phone }))
      : [{ name: "", relation: "", phone: "" }],
  );
  const [instructions, setInstructions] = useState(initial.instructions);
  const { save, error, pending, close } = useSave();
  const update = (i: number, k: keyof ContactDraft, value: string) =>
    setContacts((list) => list.map((c, j) => (j === i ? { ...c, [k]: value } : c)));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // a fully empty row is ignored rather than refused
        const filled = contacts.filter((c) => c.name.trim() || c.phone.trim() || c.relation.trim());
        save(() => saveDogEmergency(dogId, { contacts: filled, instructions }));
      }}
    >
      {contacts.map((c, i) => (
        <fieldset key={i} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-semibold text-ink">Contact {i + 1}</legend>
            <button
              type="button"
              onClick={() => setContacts((list) => list.filter((_, j) => j !== i))}
              className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5"
              aria-label={`Retirer le contact ${i + 1}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nom" htmlFor={`pp-c${i}-name`}>
              <TextInput id={`pp-c${i}-name`} maxLength={60} value={c.name} onChange={(e) => update(i, "name", e.target.value)} />
            </Field>
            <Field label="Lien" htmlFor={`pp-c${i}-rel`}>
              <TextInput
                id={`pp-c${i}-rel`}
                maxLength={40}
                value={c.relation}
                onChange={(e) => update(i, "relation", e.target.value)}
                placeholder="Voisine"
              />
            </Field>
          </div>
          <Field label="Téléphone" htmlFor={`pp-c${i}-phone`}>
            <TextInput
              id={`pp-c${i}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              value={c.phone}
              onChange={(e) => update(i, "phone", e.target.value)}
            />
          </Field>
        </fieldset>
      ))}
      {contacts.length < MAX_EMERGENCY_CONTACTS && (
        <PillButton variant="outline" size="sm" onClick={() => setContacts((l) => [...l, { name: "", relation: "", phone: "" }])}>
          <Plus className="size-4" aria-hidden /> Ajouter un contact
        </PillButton>
      )}
      <Field label="Consignes en cas d'urgence" htmlFor="pp-emergency-notes" hint="Que faire s'il se blesse, fugue ou tombe malade.">
        <TextArea id="pp-emergency-notes" maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <EditorActions pending={pending} error={error} onCancel={close} />
    </form>
  );
}
