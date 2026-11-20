"use client";

import { useEffect } from "react";
import { nativeCalendarEnabled, syncNativeCalendar } from "@/lib/native-calendar";

/** Sent by LiveUpdates after a live refresh. */
export const NATIVE_REFRESH_EVENT = "dogcare:refreshed";

/**
 * iPhone app: keeps the "Dogcare" calendar of the iPhone equal to my gardes
 * when the app opens, comes back to the front, or receives a live change.
 * Nothing on the web (the subscription covers it there).
 */
export function NativeCalendarSync() {
  useEffect(() => {
    if (!nativeCalendarEnabled()) return;
    let last = 0;
    const sync = (force = false) => {
      if (!force && Date.now() - last < 15_000) return;
      last = Date.now();
      void syncNativeCalendar();
    };
    sync(true);
    const onVisible = () => document.visibilityState === "visible" && sync();
    const onRefresh = () => sync(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NATIVE_REFRESH_EVENT, onRefresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NATIVE_REFRESH_EVENT, onRefresh);
    };
  }, []);
  return null;
}
