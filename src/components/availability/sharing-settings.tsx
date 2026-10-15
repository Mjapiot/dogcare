"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { setShareAvailability } from "@/server/actions/groups";
import { Switch } from "@/components/ui/switch";

export function SharingSettings({ groups }: { groups: Array<{ id: string; name: string; share: boolean }> }) {
  const [state, setState] = useState(() => Object.fromEntries(groups.map((g) => [g.id, g.share])));
  const [, startTransition] = useTransition();
  return (
    <section aria-labelledby="sharing-title" className="flex flex-col gap-3">
      <div>
        <h2 id="sharing-title" className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <Eye className="size-5" aria-hidden /> Qui voit mes dispos ?
        </h2>
        <p className="mt-1 text-[14px] text-ink-3">
          Seuls les membres des groupes cochés voient vos disponibilités. Les motifs ne sont jamais demandés ni affichés.
        </p>
      </div>
      <ul className="flex flex-col gap-1 rounded-[28px] bg-surface p-2">
        {groups.map((g) => (
          <li key={g.id} className="flex min-h-13 items-center justify-between gap-3 rounded-2xl px-3">
            <label htmlFor={`share-${g.id}`} className="text-[15px] font-medium text-ink">
              {g.name}
            </label>
            <Switch
              id={`share-${g.id}`}
              checked={state[g.id]}
              onCheckedChange={(checked) => {
                setState((s) => ({ ...s, [g.id]: checked }));
                startTransition(async () => {
                  const r = await setShareAvailability(g.id, checked);
                  if (!r.ok) {
                    setState((s) => ({ ...s, [g.id]: !checked }));
                    toast.error(r.error);
                  }
                });
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
