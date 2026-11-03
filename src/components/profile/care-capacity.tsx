"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PawPrint } from "lucide-react";
import { updateMaxDogs } from "@/server/actions/groups";
import { MAX_DOGS_CHOICES, maxDogsLabel } from "@/domain/cumul";
import { Select } from "@/components/ui/kit";

/** "Chiens gardés à la fois": the planning engine never proposes more to me at the same time. */
export function CareCapacity({ initial }: { initial: number | null }) {
  const [value, setValue] = useState(initial);
  const [, startTransition] = useTransition();
  const choices: Array<number | null> = MAX_DOGS_CHOICES.includes(initial as (typeof MAX_DOGS_CHOICES)[number]) ? [...MAX_DOGS_CHOICES] : [...MAX_DOGS_CHOICES, initial];

  const save = (next: number | null) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const r = await updateMaxDogs(next);
      if (!r.ok) {
        setValue(previous);
        toast.error(r.error);
      } else toast.success("Réglage enregistré");
    });
  };

  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sage/15 text-ink">
        <PawPrint className="size-[18px]" aria-hidden />
      </span>
      <label htmlFor="max-dogs" className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-ink">Chiens gardés à la fois</span>
        <span className="block text-[13px] text-ink-3">Le planning ne vous en propose jamais plus</span>
      </label>
      <Select id="max-dogs" value={value === null ? "none" : String(value)} onChange={(e) => save(e.target.value === "none" ? null : Number(e.target.value))} className="w-auto">
        {choices.map((c) => (
          <option key={c ?? "none"} value={c === null ? "none" : String(c)}>
            {maxDogsLabel(c)}
          </option>
        ))}
      </Select>
    </div>
  );
}
