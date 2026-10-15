"use client";

import { useEffect } from "react";

/** Registers the minimal service worker (production only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // The app works without a service worker; nothing to do.
    });
  }, []);
  return null;
}
