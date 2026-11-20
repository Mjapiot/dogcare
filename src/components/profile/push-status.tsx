"use client";

import { useEffect, useState } from "react";
import { readPushState } from "@/lib/push-state";

const LABELS = { on: "Activées", off: "Désactivées", unavailable: "Indisponibles ici" } as const;

/**
 * This device's notification state, read only (no prompt, no registration):
 * "Activées", "Désactivées" or "Indisponibles ici".
 */
export function PushStatus() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readPushState()
      .then((s) => !cancelled && setLabel(LABELS[s]))
      .catch(() => !cancelled && setLabel(LABELS.off));
    return () => {
      cancelled = true;
    };
  }, []);
  return <span aria-live="polite">{label ?? ""}</span>;
}
