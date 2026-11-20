"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { readPushState } from "@/lib/push-state";
import { nativeCalendarEnabled, nativeCalendarSupported } from "@/lib/native-calendar";

const DISMISSED = "dogcare.stayInformed.dismissed";

/**
 * Home: while notifications (on this device) or the calendar subscription are
 * not set, a discreet card leads to « Restez prévenu ». « Plus tard » hides it
 * on this device.
 */
export function StayInformedCard({ calendarOn }: { calendarOn: boolean }) {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED) === "1";
    } catch {
      // private browsing: show it
    }
    if (dismissed) return;
    readPushState()
      .catch(() => "off" as const)
      .then((push) => {
        if (cancelled) return;
        // in the iPhone app the calendar is written by the app; on the web, the subscription
        const calendar = nativeCalendarSupported() ? nativeCalendarEnabled() : calendarOn;
        const list = [...(push === "on" ? [] : ["les notifications"]), ...(calendar ? [] : ["vos gardes dans le Calendrier"])];
        setMissing(list);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarOn]);

  if (!missing?.length) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED, "1");
    } catch {
      // nothing to remember
    }
    setMissing([]);
  };

  return (
    <aside aria-label="Restez prévenu" className="flex items-start gap-3 rounded-[26px] bg-surface p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--tone-info)] text-[var(--tone-info-ink)]">
        <BellRing className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">Restez prévenu</p>
        <p className="text-[14px] text-ink-2">Activez {missing.join(" et ")}, en un geste.</p>
        <Link href="/onboarding/prevenu?from=home" className="mt-1 inline-flex min-h-11 items-center text-[15px] font-medium text-ink underline underline-offset-4">
          Régler maintenant
        </Link>
      </div>
      <button type="button" onClick={dismiss} aria-label="Plus tard" className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  );
}
