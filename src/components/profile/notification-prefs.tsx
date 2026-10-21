"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveNotificationPreferences } from "@/server/actions/notifications";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferencesRow } from "@/lib/types";

const ITEMS: Array<{ key: keyof NotificationPreferencesRow; label: string; hint: string }> = [
  { key: "new_requests_enabled", label: "Nouvelles demandes", hint: "Quand un membre a besoin d'aide" },
  { key: "responses_enabled", label: "Propositions d'aide", hint: "Quand quelqu'un peut garder votre chien" },
  { key: "confirmations_enabled", label: "Confirmations et changements", hint: "Gardes confiées, horaires modifiés" },
  { key: "cancellations_enabled", label: "Annulations", hint: "Garde ou demande annulée" },
];

export function NotificationPrefs({ initial }: { initial: NotificationPreferencesRow }) {
  const [prefs, setPrefs] = useState(initial);
  const latest = useRef(initial);
  const [, startTransition] = useTransition();

  const toggle = (key: keyof NotificationPreferencesRow, value: boolean) => {
    // always save the most recent combination (quick successive toggles)
    latest.current = { ...latest.current, [key]: value };
    setPrefs(latest.current);
    const snapshot = latest.current;
    startTransition(async () => {
      const r = await saveNotificationPreferences(snapshot);
      if (!r.ok) {
        latest.current = { ...latest.current, [key]: !value };
        setPrefs(latest.current);
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line rounded-[24px] bg-surface">
        {ITEMS.map((item) => (
          <li key={item.key} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
            <label htmlFor={`pref-${item.key}`} className="flex flex-col">
              <span className="text-[15px] font-medium text-ink">{item.label}</span>
              <span className="text-[13px] text-ink-3">{item.hint}</span>
            </label>
            <Switch id={`pref-${item.key}`} checked={prefs[item.key]} onCheckedChange={(c) => toggle(item.key, c)} />
          </li>
        ))}
      </ul>
      <p className="px-1 text-[13px] text-ink-3">
        Choisissez ce qui vous est envoyé sur vos appareils. La cloche de l&apos;application affiche toujours tout,
        pour ne jamais manquer une garde qui vous concerne.
      </p>
    </div>
  );
}
