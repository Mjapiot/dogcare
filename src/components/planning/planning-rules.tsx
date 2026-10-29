"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarRange } from "lucide-react";
import { updatePlanningRules } from "@/server/actions/dogs";
import { Card, Field, Select } from "@/components/ui/kit";

const NIGHTS = [1, 2, 3, 4, 5, 7, 10, 14];
const HOURS = [1, 2, 3, 4, 6, 8, 12];

/** Owner rules followed by the planning engine for this dog. */
export function PlanningRules({ dogId, maxNights, minSliceHours }: { dogId: string; maxNights: number; minSliceHours: number }) {
  const [values, setValues] = useState({ maxNights, minSliceHours });
  const [, startTransition] = useTransition();

  const save = (next: typeof values) => {
    const previous = values;
    setValues(next);
    startTransition(async () => {
      const r = await updatePlanningRules(dogId, next);
      if (!r.ok) {
        setValues(previous);
        toast.error(r.error);
      } else toast.success("Réglage enregistré");
    });
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-beige text-ink">
          <CalendarRange className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Planning des gardes</h2>
          <p className="text-[14px] text-ink-3">Ce que respecte la proposition de planning quand plusieurs personnes se partagent une garde.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nuits d'affilée max" htmlFor="plan-nights" hint="par gardien">
          <Select id="plan-nights" value={values.maxNights} onChange={(e) => save({ ...values, maxNights: Number(e.target.value) })}>
            {NIGHTS.map((n) => (
              <option key={n} value={n}>
                {n} nuit{n > 1 ? "s" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tranche minimale" htmlFor="plan-slice" hint="évite les relais courts">
          <Select id="plan-slice" value={values.minSliceHours} onChange={(e) => save({ ...values, minSliceHours: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}
