"use client";

import { useEffect, useState } from "react";
import { nativeCalendarEnabled, nativeCalendarSupported } from "@/lib/native-calendar";

/** "Mon calendrier" row state: the iPhone's own calendar in the app, the subscription on the web. */
export function CalendarStatus({ subscribed }: { subscribed: boolean }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the device once on mount
    setLabel(nativeCalendarSupported() ? (nativeCalendarEnabled() ? "Activé" : "Non") : subscribed ? "Abonné" : "Non");
  }, [subscribed]);
  return <span>{label ?? ""}</span>;
}
