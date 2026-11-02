"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { shareDogsWithGroup } from "@/server/actions/dogs";
import { DogAvatar } from "@/components/domain/request-bits";
import { PillButton } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";

export function ShareDogsForm({ groupId, dogs, next }: { groupId: string; dogs: Array<{ id: string; name: string; photoUrl: string | null }>; next: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string[]>(dogs.map((d) => d.id));

  const submit = () =>
    startTransition(async () => {
      if (chosen.length) {
        const r = await shareDogsWithGroup(groupId, chosen);
        if (!r.ok) return void toast.error(r.error);
        toast.success(chosen.length > 1 ? "Chiens partagés avec le groupe" : "Chien partagé avec le groupe");
      }
      router.replace(next);
    });

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line rounded-[24px] bg-surface">
        {dogs.map((d) => (
          <li key={d.id} className="flex min-h-16 items-center gap-3 px-4">
            <DogAvatar name={d.name} photoUrl={d.photoUrl} size={44} />
            <label htmlFor={`share-${d.id}`} className="flex-1 text-[16px] font-medium text-ink">
              {d.name}
            </label>
            <Switch
              id={`share-${d.id}`}
              checked={chosen.includes(d.id)}
              onCheckedChange={(c) => setChosen((prev) => (c ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
            />
          </li>
        ))}
      </ul>
      <PillButton size="lg" loading={pending} onClick={submit}>
        {chosen.length ? "Continuer" : "Continuer sans partager"}
      </PillButton>
    </div>
  );
}
