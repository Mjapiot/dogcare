"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveNotificationPreferences } from "@/server/actions/notifications";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferencesRow } from "@/lib/types";

type Item = { key: keyof NotificationPreferencesRow; label: string; hint: string };

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: "Demandes",
    items: [
      { key: "new_requests_enabled", label: "Nouvelles demandes", hint: "Quand un membre a besoin d'aide" },
      { key: "responses_enabled", label: "Propositions d'aide", hint: "Quand quelqu'un peut garder votre chien" },
    ],
  },
  {
    title: "Gardes",
    items: [
      { key: "confirmations_enabled", label: "Confirmations et changements", hint: "Gardes confiées, horaires modifiés" },
      { key: "cancellations_enabled", label: "Annulations", hint: "Garde ou demande annulée" },
      { key: "reminders_enabled", label: "Rappels de la veille", hint: "Gardes du lendemain, besoins pas encore couverts" },
    ],
  },
  {
    title: "Vos chiens et votre cercle",
    items: [
      { key: "care_log_enabled", label: "Carnet de garde", hint: "Prise en charge, récupération et photos de vos chiens" },
      { key: "circle_enabled", label: "Cercle de confiance", hint: "Accès donnés, modifiés ou terminés, arrivées et départs" },
    ],
  },
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
    <div className="flex flex-col gap-2 pb-4">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col">
          <h3 className="border-t border-line px-4 pt-3 pb-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{group.title}</h3>
          <ul className="flex flex-col divide-y divide-line">
            {group.items.map((item) => (
              <li key={item.key} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                <label htmlFor={`pref-${item.key}`} className="flex flex-col">
                  <span className="text-[15px] font-medium text-ink">{item.label}</span>
                  <span className="text-[13px] text-ink-3">{item.hint}</span>
                </label>
                <Switch id={`pref-${item.key}`} checked={prefs[item.key]} onCheckedChange={(c) => toggle(item.key, c)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="px-4 text-[13px] text-ink-3">
        Choisissez ce qui vous est envoyé sur vos appareils. La cloche de l&apos;application affiche toujours tout,
        pour ne jamais manquer une garde qui vous concerne.
      </p>
    </div>
  );
}
